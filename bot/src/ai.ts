import type { ResourcePins } from "../../shared/resources";
import { books, chapter, dataJson } from "./data";
import { parseReference } from "./refs.mjs";
import { guardVerses } from "./verse-guard.mjs";
import { approvedFor, approvedSources } from "./approved-answers";
import { cacheKey, cachedAnswer, keepAnswer, linkTrace } from "./answer-cache";
import { runSearch } from "./search";
import type { Env, Exec } from "./env";
import { ANSWER_MODEL, answerCandidates, buildPrompt, citations, referencesIn, retrievalText, routeOf, dedupeMatches, EMBED_MODEL, RERANK_MODEL, splitFollowups, VOICE_MODEL, VOICES, type Passage, type Turn } from "./ai.mjs";
import { runAgent, type AgentEvent } from "./agent";
import { answerAppStudy, type AppStudyEvent } from "./app-study-answer";
import { APP_STUDY_RELEASE } from "./app-study-release";
import { alertClaudeFunds, claude, claudeUnavailable, hasClaude, unifiedBilling, viaGateway } from "./providers";
import { countryOf, MODELS, modelOf, type AskModel } from "../../shared/ask-models.mjs";
import { pid } from "./privacy.mjs";
import { clearPending, markPending, saveExchange, type SavedAction } from "./chats";
import { isAdmin } from "./edit";
import { creditsConfig, hold, ownerOfUser, prepare, settle, typicalMc, wallet, type Wallet } from "./credits";
import { estimateMc, MC_USD, mcOfUsd, viaUnifiedBilling } from "../../shared/credits.mjs";
import { freeSpend, makeSpend, type Spend } from "./spend";
import { reserveFreeBudget, settleFreeBudget, type FreeReservation } from "./free-budget";
import { researchOpen } from "./agent-open";
export { freeSpendToday, freePaused } from "./free-budget";

/**
 * The AI features, all through Workers AI and the Vectorize index of the teachings:
 * embeddings (bge-m3), retrieval of the closest passages, an answer grounded in them with
 * citations (llama 3.3 70b), search by meaning, and the reading voices (Deepgram Aura),
 * each verse generated once and kept in R2.
 */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 100) }, viaGateway(env)) as { data?: number[][] };
    out.push(...(res.data ?? []));
  }
  return out;
}

const passageOf = (m: { metadata?: Record<string, unknown>; score: number }): Passage & { score: number } => {
  const md = (m.metadata ?? {}) as Record<string, string | number>;
  return { kind: String(md.kind ?? ""), title: String(md.title ?? ""), url: String(md.url ?? ""), sub: String(md.sub ?? ""), video: md.video ? String(md.video) : undefined, t: md.t !== undefined ? Number(md.t) : undefined, date: md.date ? String(md.date) : undefined, text: String(md.text ?? ""), score: m.score };
};

/**
 * The passages for a question: the twenty closest in meaning from the index and the best
 * keyword matches from the library search, together, reranked by whether they answer it.
 */
export async function retrieve(env: Env, text: string, topK = 12, spend?: Spend): Promise<(Passage & { score: number })[]> {
  const [vectorRes, keywordRes] = await Promise.all([
    // Search by meaning falls back to the keyword search alone if Workers AI or Vectorize fails,
    // so a question is still answered (and Claude can still research) rather than failing whole.
    embed(env, [text]).then(([vector]) => (vector ? env.VEC.query(vector, { topK: 20, returnMetadata: "all" }) : { matches: [] as VectorizeMatches["matches"] }))
      .catch((e: Error) => { console.error(JSON.stringify({ event: "retrieve_vector_failed", message: e.message?.slice(0, 120) })); return { matches: [] as VectorizeMatches["matches"] }; }),
    runSearch(env.DB, text, undefined, 3, true).catch(() => null),
  ]);
  // A passage must say something: scraps of captions ("do", "yeah so") sit close to every question.
  const said = vectorRes.matches.filter((m) => String((m.metadata as Record<string, unknown> | undefined)?.text ?? "").split(/\s+/).length >= 20);
  const close = dedupeMatches(said).map(passageOf);
  const keyed: (Passage & { score: number })[] = keywordRes?.ok ? keywordRes.hits.filter((h) => h.text && h.text.split(/\s+/).length >= 20).map((h) => ({ kind: h.kind, title: h.title, url: h.url, sub: h.sub, text: h.text!.slice(0, 1400), score: 0.5 })) : [];
  const seen = new Set(close.map((p) => `${p.kind}|${p.url}|${p.sub ?? ""}`));
  const all = [...close, ...keyed.filter((p) => !seen.has(`${p.kind}|${p.url}|${p.sub ?? ""}`))];
  // What this search cost: the question embedded, one vector query, and what the reranker read.
  spend?.search({ query: text, contexts: all.length > 1 ? all.map((p) => `${p.title}\n${p.text}`.slice(0, 2000)) : [] });
  return withTeachers(env, await rerank(env, text, all, topK));
}

/**
 * Who taught each passage's class, from the published class notes (their recording and page), so
 * the answer can put the Bishops' and Deacons' teaching first and name a teacher only when the
 * notes do. A class with no note, or a note with no teacher, stays unnamed: never guessed.
 */
type NoteRow = { url?: string; videoId?: string | null; teacher?: string };
let teacherIndex: { at: number; byVideo: Map<string, string>; byUrl: Map<string, string> } | null = null;
async function teachers(env: Env) {
  if (teacherIndex && Date.now() - teacherIndex.at < 3_600_000) return teacherIndex;
  const rows = await dataJson<NoteRow[]>(env, "/api/notes/index.json").catch(() => null);
  if (!Array.isArray(rows)) return teacherIndex;
  const byVideo = new Map<string, string>(), byUrl = new Map<string, string>();
  for (const r of rows) {
    const teacher = typeof r.teacher === "string" ? r.teacher.trim().slice(0, 80) : "";
    if (!teacher) continue;
    if (r.videoId) byVideo.set(r.videoId, teacher);
    if (r.url) byUrl.set(r.url, teacher);
  }
  teacherIndex = { at: Date.now(), byVideo, byUrl };
  return teacherIndex;
}
export async function withTeachers<T extends Passage>(env: Env, passages: T[]): Promise<T[]> {
  const index = await teachers(env).catch(() => null);
  if (!index) return passages;
  return passages.map((p) => {
    const teacher = (p.video && index.byVideo.get(p.video)) || (p.url && index.byUrl.get(p.url.split(/[?#]/)[0])) || "";
    return teacher ? { ...p, teacher } : p;
  });
}

/**
 * The closest passages read against the question by a reranker, which orders them by whether
 * they answer it rather than by how near their words sit; the vector order stands when the
 * reranker is unavailable.
 */
async function rerank<T extends Passage>(env: Env, question: string, passages: T[], topK: number): Promise<T[]> {
  if (passages.length <= 1) return passages.slice(0, topK);
  try {
    // The published type leaves `query` out; the model takes it.
    const input = { query: question, contexts: passages.map((p) => ({ text: `${p.title}\n${p.text}`.slice(0, 2000) })), top_k: topK };
    const res = await (env.AI as unknown as { run(model: string, input: unknown, options?: unknown): Promise<unknown> }).run(RERANK_MODEL, input, viaGateway(env)) as { response?: { id?: number; score?: number }[] };
    const order = (res.response ?? []).filter((r) => typeof r.id === "number" && passages[r.id!]).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (!order.length) return passages.slice(0, topK);
    return order.slice(0, topK).map((r) => passages[r.id!]);
  } catch { return passages.slice(0, topK); }
}

export type Answer = { ok: true; q: string; answer: string; sources: (Passage & { n: number })[]; ms: number } | { ok: false; reason: string };
const ASK_LIMIT = 100;

/** A verse's reading voice: fifty new generations a day per person; the cache is free. */
const TTS_LIMIT = 50;

/**
 * A per-person daily quota, counted atomically inside D1: the increment is one UPSERT, so
 * concurrent requests cannot each read the same count and all slip under the cap the way a
 * KV read-modify-write can. One table for every capped thing; rows from earlier days are
 * swept hourly (sweepRateCounts), never on the request path.
 */
export async function takeQuota(env: Env, name: string, userId: number, limit: number): Promise<boolean> {
  // Counted under the person's pseudonymous ID, and swept the next day.
  const key = `${name}:${await pid(env, userId)}:${new Date().toISOString().slice(0, 10)}`;
  return takeQuotaKey(env, key, limit);
}

/** The same atomic counter under an explicit key (IP velocity limits): swept with the rest. */
export async function takeQuotaKey(env: Env, key: string, limit: number): Promise<boolean> {
  const res = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("INSERT INTO rate_counts (key, n) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET n = n + 1 RETURNING n").bind(key),
  ]);
  const n = Number((res[1].results?.[0] as { n?: unknown } | undefined)?.n ?? limit + 1);
  return n <= limit;
}

/**
 * Old quota rows are swept hourly, never on the request path: the sweep's leading-wildcard
 * LIKE cannot use the key index, so running it per request is a full table scan on every Ask.
 * Two days are kept so a UTC-midnight boundary never drops a live counter.
 */
export async function sweepRateCounts(env: Env, now = Date.now()): Promise<number> {
  const day = (n: number) => new Date(now - n * 86400000).toISOString().slice(0, 10);
  const res = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("DELETE FROM rate_counts WHERE key NOT LIKE ? AND key NOT LIKE ?").bind(`%:${day(0)}`, `%:${day(1)}`),
  ]);
  return Number((res[1] as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

/** A hundred answers a day per person. */
async function allowed(env: Env, userId: number): Promise<boolean> {
  return takeQuota(env, "ask", userId, ASK_LIMIT);
}

/**
 * Every Workers AI text model is free-tier eligible: Cloudflare gives the account 10,000 free
 * neurons a day shared across all of its models (then $0.011/1k neurons on Workers Paid), so
 * there is no separate "free lane" of models to pick from — the whole text menu is offered.
 * ASK_FREE_MODELS optionally narrows it (comma-separated model ids); ASK_FREE_MODEL names the
 * default free model, Llama 3.1 8B, the cheapest per answer. A reader picks any of them in the
 * app's model picker. Admission reserves its budget against the daily free-answer allowance;
 * this does not measure other account usage or guarantee a zero Cloudflare bill.
 */
const FREE_FORMATS = new Set(["plain", "chat"]);
export function freeModels(env: Env): Set<string> {
  const pinned = String(env.ASK_FREE_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pinned.length) return new Set(pinned);
  return new Set(MODELS.filter((m) => m.id.startsWith("@cf/") && FREE_FORMATS.has(m.format)).map((m) => m.id));
}

/**
 * The default free model: never charged, open to every reader, and offered whenever the balance
 * is too low for the model chosen. It answers from the retrieved passages in one call
 * (format "plain": no tool rounds); other free models may research up to ASK_FREE_MAX_ROUNDS.
 */
export const freeModel = (env: Env) => modelOf(env.ASK_FREE_MODEL || "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.1-8b-instruct-fp8");

/** Ask is paid from the reader's balance (credits.ts) when ASK_BILLING is "on"; otherwise each person has the abuse limit above. */
export const creditsOn = (env: Env) => env.ASK_BILLING === "on";

/**
 * One request's cost: who pays, what was held for it, and what it has cost so far. Before the
 * request starts, the most it may cost on this model is worked out and that much is held from the
 * balance. A request whose most is above ASK_CONFIRM_ABOVE_USD is held only up to a limit the
 * reader accepted (the app asks first). The free model and the admins are not charged: they get
 * a meter that measures the same budget and holds no reader balance. Non-admin free
 * answers reserve their cost separately from the owner's daily allowance.
 */
export type Meter = { owner: string; request: string; held: number; spend: Spend; model: AskModel; free: boolean; admin: boolean; maxRounds?: number; reservation?: FreeReservation };
type MeterStart = { ok: true; meter: Meter } | { ok: false; status: number; body: Record<string, unknown> };
export type MeterOpts = { resources?: ResourcePins; request?: string; maxMc?: number; caps?: Record<string, number> };

/**
 * The free tier answers at the owner's expense, so it is capped twice: fewer research rounds
 * (ASK_FREE_MAX_ROUNDS, 3) and a hard per-answer ceiling (ASK_FREE_MAX_USD, five cents).
 * Without the ceiling, one answer's budget is the paid per-request maximum.
 */
const freeMaxRounds = (env: Env) => Math.max(1, Math.floor(Number(env.ASK_FREE_MAX_ROUNDS ?? 3)));
const freeMaxUsd = (env: Env) => Math.max(0.001, Number(env.ASK_FREE_MAX_USD ?? 0.05));

export async function startMeter(env: Env, uid: number, model: AskModel, opts: MeterOpts = {}): Promise<MeterStart> {
  return startMeterFor(env, uid, model, opts, false);
}

/** Sponsored search is a server-only choice; request bodies cannot opt paid Ask into it. */
async function startMeterFor(env: Env, uid: number, model: AskModel, opts: MeterOpts, sponsoredSearch: boolean): Promise<MeterStart> {
  const cfg = creditsConfig(env);
  const owner = await ownerOfUser(env, uid);
  await prepare(env, owner, { uid });
  const viaCf = unifiedBilling(env);
  const fee = viaUnifiedBilling(model, viaCf) ? cfg.unifiedFee : 0;
  const est = estimateMc(model, cfg, { claudeViaCloudflare: viaCf });
  const request = opts.request && /^[a-z0-9-]{8,64}$/i.test(opts.request) ? opts.request : crypto.randomUUID();
  const free = freeModel(env);
  const freeSet = freeModels(env);
  const admin = isAdmin(env, uid);
  const isFree = sponsoredSearch || freeSet.has(model.id);
  if (isFree || admin) {
    const budgeted = isFree && (!admin || sponsoredSearch);
    const rounds = sponsoredSearch ? 1 : isFree && !admin ? freeMaxRounds(env) : 6;
    const estFree = budgeted ? estimateMc(model, cfg, { rounds }) : est;
    const budget = budgeted ? Math.min(estFree.maxMc * MC_USD, freeMaxUsd(env)) : est.maxMc * MC_USD;
    let reservation: FreeReservation | undefined;
    if (!admin || sponsoredSearch) {
      try {
        const held = await reserveFreeBudget(env, crypto.randomUUID(), budget);
        if (!held) return { ok: false, status: 429, body: { error: "free-paused" } };
        reservation = held;
      } catch {
        return { ok: false, status: 503, body: { error: "unavailable", message: "The free answer budget is unavailable. Please try again later." } };
      }
    }
    return { ok: true, meter: { owner, request, held: 0, spend: makeSpend({ fee, budgetUsd: budget, rates: cfg.research }), model, free: true, admin, reservation, maxRounds: isFree && !admin ? rounds : undefined } };
  }
  const typical = (await typicalMc(env, model.id).catch(() => null)) ?? est.typicalMc;
  const limit = opts.maxMc ?? opts.caps?.[model.id];
  const accepted = limit && limit > 0 ? Math.round(limit) : null;
  if (accepted === null && est.maxMc > cfg.confirmAboveMc) return { ok: false, status: 409, body: { error: "confirm", model: model.id, name: model.name, typical_mc: typical, max_mc: est.maxMc } };
  // Enough to begin: half a typical answer (at least a tenth of a cent); with less it would be cut off.
  const floor = Math.min(est.maxMc, Math.max(1000, Math.ceil(typical / 2)));
  // A limit below that is not a price anyone can answer for: it is asked again, never held as
  // nothing (a hold of 0 would charge 0 and leave the whole answer to the owner).
  if (accepted !== null && accepted < floor) return { ok: false, status: 409, body: { error: "confirm", model: model.id, name: model.name, typical_mc: typical, max_mc: est.maxMc } };
  const cap = Math.min(est.maxMc, accepted ?? est.maxMc);
  const minMc = Math.min(cap, floor);
  const h = await hold(env, owner, request, cap, minMc, model.id);
  // Not enough: the free model is offered, and a top-up.
  if (!h.ok && "reason" in h) return { ok: false, status: 409, body: { error: "request-used", message: "This request already started. Wait for its answer or send a new request." } };
  if (!h.ok) return { ok: false, status: 402, body: { error: "credits", model: model.id, name: model.name, available_mc: h.available_mc, need_mc: minMc, typical_mc: typical, free: { id: free.id, name: free.name, provider: free.provider } } };
  return { ok: true, meter: { owner, request, held: h.held_mc, spend: makeSpend({ fee, budgetUsd: h.held_mc * MC_USD, rates: cfg.research }), model, free: false, admin: isAdmin(env, uid) } };
}

/**
 * Settle a request: charged what it actually cost, at most what was held (the limit the reader
 * accepted); a failed, refused or empty answer is not charged at all. What it cost beyond the
 * charge is recorded as written off. Returns the charge and the new balance, or null when nothing
 * was settled (the free model, an admin).
 */
export async function finishMeter(env: Env, m: Meter, status: "ok" | "failed" | "refused" | "empty" | "backup", elapsedMs?: number): Promise<{ charged_mc: number; balance: Wallet } | null> {
  const cost = m.spend.total();
  const actual = mcOfUsd(cost);
  const charged = status === "ok" && !m.free ? Math.min(actual, m.held) : 0;
  const detail = { calls: m.spend.calls, searches: m.spend.searches, model_usd: Math.round(m.spend.modelUsd * 1e6) / 1e6, research_usd: Math.round(m.spend.researchUsd * 1e6) / 1e6 };
  console.log(JSON.stringify({ event: "ask_usage", model: m.model.id, status, cost_usd: Math.round(cost * 1e6) / 1e6, charged_mc: charged, held_mc: m.held, free: m.free, ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...detail }));
  // Failed/backup calls may have incurred unreported provider costs. Keep their full
  // reservation; a failed settlement leaves the reservation held, never reusable.
  if (m.reservation) await settleFreeBudget(env, m.reservation,
    status === "failed" || status === "backup" || m.spend.unreported ? Math.max(cost, m.spend.budgetUsd ?? 0) : cost);
  if (m.free) return null;
  const r = await settle(env, m.owner, m.request, { actualMc: charged, costUsd: cost, status, model: m.model.id, detail, absorbedMc: actual - charged }).catch((e: Error) => { console.error(JSON.stringify({ event: "credits_settle_failed", message: e.message?.slice(0, 160) })); return null; });
  return r ? { charged_mc: r.charged_mc, balance: await wallet(env, m.owner) } : null;
}

/**
 * Whether this person may ask now, and on what: with billing on, the balance decides for paid
 * models (startMeter) and the free model is open to all, within the daily cap against abuse
 * (admins aside); with billing off, the cap alone.
 */
async function begin(env: Env, uid: number, model: AskModel, opts: MeterOpts): Promise<{ ok: true; meter: Meter | null } | { ok: false; status: number; body: Record<string, unknown> }> {
  if (!creditsOn(env)) {
    if (!(await allowed(env, uid))) return { ok: false, status: 429, body: { error: "limit" } };
    // Disabling reader billing does not disable the free models' shared allowance.
    return freeModels(env).has(model.id) ? startMeter(env, uid, model, opts) : { ok: true, meter: null };
  }
  // Apply the reader quota before reserving the global budget: denied requests use none.
  if (freeModels(env).has(model.id) && !isAdmin(env, uid) && !(await allowed(env, uid))) return { ok: false, status: 429, body: { error: "limit" } };
  return startMeter(env, uid, model, opts);
}

/** A question answered in one piece (the bot and older clients). It cannot ask first, so it is held to ASK_CONFIRM_ABOVE_USD at most. */
export async function ask(env: Env, q: string, userId: number, ctx?: Exec, history: Turn[] = [], consent: string[] = [], resources?: ResourcePins): Promise<Answer> {
  const t0 = Date.now();
  const question = q.trim().slice(0, 400);
  if (question.length < 2) return { ok: false, reason: "too-short" };
  const model = modelOf(env.CLAUDE_MODEL || CLAUDE_DEFAULT);
  // The one-piece answer uses the setup's own model: agreed to, as in askStream.
  if (!consent.includes(model.provider)) return { ok: false, reason: "consent" };
  const r = await begin(env, userId, model, { maxMc: creditsConfig(env).confirmAboveMc });
  if (!r.ok) return { ok: false, reason: r.body.error === "free-paused" ? "free-paused" : r.status === 429 ? "limit" : r.status === 503 ? "unavailable" : "credits" };
  const meter = r.meter;
  const spend = meter?.spend ?? freeSpend();
  try {
    const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12, spend), 8);
    if (model.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY) {
      const { text, passages } = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k, spend), () => undefined, ctx, undefined, model, spend, resources);
      const answer = await checkedVerses(env, splitFollowups(text).answer);
      if (meter) await finishMeter(env, meter, answer.trim() ? "ok" : "empty");
      return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
    }
    if (meter) await finishMeter(env, meter, "backup");
    const passages = first;
    if (!passages.length) return { ok: true, q: question, answer: "The search did not find enough reliable material in the library to answer that question.", sources: [], ms: Date.now() - t0 };
    const { answer } = splitFollowups(await answerOnce(env, buildPrompt(question, passages, history)));
    return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
  } catch (e) {
    // An answer that failed is not charged: the hold goes back.
    if (meter) await finishMeter(env, meter, "failed");
    console.error(JSON.stringify({ event: "ask_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
}

export type SearchAnswer =
  | { ok: true; answer: string; followups?: string[]; sources: (Passage & { n: number; evidence?: string; thumb?: string })[]; model: string; provider: string; ms: number; ui?: string; teachingFound?: boolean }
  | { ok: false; reason: "too-short" | "too-long" | "model-unavailable" | "unavailable" | "empty" | "free-paused" | "consent" | "limit"; detail?: string };

/** Search defaults to hosted free-tier models; third-party billing requires an explicit opt-in. */
export function searchModel(env: Env): AskModel | null {
  const id = env.SEARCH_AI_MODEL?.trim() || freeModel(env).id;
  if (env.SEARCH_AI_FREE_ONLY !== "off" && !id.startsWith("@cf/")) return null;
  return MODELS.find((m) => m.id === id && FREE_FORMATS.has(m.format)
    && (m.id.startsWith("@cf/") || m.provider === "Google" && m.id.startsWith("google/"))) ?? null;
}

/**
 * One library-grounded call, funded by the owner's shared free-answer allowance. A configured
 * external provider requires consent before retrieval or metering. No reader balance is held,
 * and no tools or web searches are offered to the model. Admin searches share the daily limit.
 */
/**
 * How long a search answer may take, retrieval and model together. Past it the reader is told the
 * answer is unavailable, and the keyword results stand, rather than waiting on a stalled model.
 * Uncached answers take 30-50 s in production today (live-smoke's search-answer-latency), so this
 * only cuts off answers that would not come: 55 s. The release check waits 75 s for an answer, which
 * leaves room for the metering before and after.
 */
export const SEARCH_ANSWER_DEADLINE_MS = 55_000;
export class DeadlineError extends Error { constructor(ms: number) { super(`deadline of ${ms} ms passed`); this.name = "DeadlineError"; } }
/** The work's result, or a DeadlineError once `ms` have passed (the work itself is not cancelled). */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(ms)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export async function answerSearch(env: Env, q: string, uid: number, consent: string[] = [], deadlineMs = SEARCH_ANSWER_DEADLINE_MS): Promise<SearchAnswer> {
  const t0 = Date.now();
  const question = q.trim().slice(0, 200);
  if (question.length < 2) return { ok: false, reason: "too-short" };
  const model = searchModel(env);
  if (!model) return { ok: false, reason: "unavailable" };
  if (!model.id.startsWith("@cf/") && !consent.includes(model.provider)) return { ok: false, reason: "consent" };
  const started = await startMeterFor(env, uid, model, {}, true);
  if (!started.ok) return { ok: false, reason: started.body.error === "free-paused" ? "free-paused" : "unavailable" };
  return boundedAnswer(env, model, started.meter, question, question, [], deadlineMs, t0);
}

/**
 * Ask for a signed-in app reader, linked to Telegram or not: the free model only, one bounded
 * answer from the library with the sources it cited. No balance is read or held, nothing is
 * bought, and no conversation is saved on the server. The account is named only by a keyed hash
 * of its Firebase UID; it has the same daily cap as Ask, and every answer is funded from the
 * shared free allowance, so new accounts cannot spend beyond it.
 */
/** Native apps only expose the configured hosted free models until store entitlements exist. */
/**
 * Claude for every signed-in app reader (the owner's choice, 2026-10-31): Haiku answers by default
 * and Sonnet answers deep questions, paid from the owner's console. It is off unless
 * ASK_CLAUDE_FOR_READERS is "on", the ANTHROPIC_API_KEY secret (or Unified Billing) is set, and
 * ASK_CLAUDE_DAILY_USD_CAP is above zero. Its spending has its own daily cap, separate from the free
 * models' allowance, and each answer is held to ASK_CLAUDE_MAX_USD; when either runs out the free
 * model answers instead.
 */
const usdSetting = (value: string | undefined, fallback: number) => { const n = Number(value ?? fallback); return Number.isFinite(n) && n > 0 ? n : 0; };
const readerClaudeCap = (env: Env) => usdSetting(env.ASK_CLAUDE_DAILY_USD_CAP, 0);
const readerClaudeMaxUsd = (env: Env) => Math.min(usdSetting(env.ASK_CLAUDE_MAX_USD, 0.2), readerClaudeCap(env));
export const claudeForReaders = (env: Env) => env.ASK_CLAUDE_FOR_READERS === "on" && hasClaude(env) && readerClaudeCap(env) > 0;
function readerClaudes(env: Env): AskModel[] {
  // The lighter model first: it is the default answer; the everyday model takes the deep questions.
  const ids = [env.CLAUDE_MODEL_LIGHT || "claude-haiku-4-5", env.CLAUDE_MODEL || CLAUDE_DEFAULT].map((id) => modelOf(id).id);
  return [...new Set(ids)].map((id) => MODELS.find((m) => m.id === id && m.format === "anthropic")).filter((m): m is AskModel => !!m);
}

/**
 * The models the app offers: the approved free models, and for an admin's linked account Claude
 * (when it can be called), every day: the owner chose not to pause it on holy days.
 */
export function appAskModels(env: Env, adminId?: number, readers = false): AskModel[] {
  const allowed = freeModels(env);
  const free = MODELS.filter(m => allowed.has(m.id) && APP_STUDY_RELEASE.approvedModels.some(id => id === m.id) && m.id.startsWith("@cf/") && FREE_FORMATS.has(m.format));
  const claudeOk = !!adminId && isAdmin(env, adminId) && hasClaude(env);
  if (!claudeOk) return readers === true && claudeForReaders(env) ? [...readerClaudes(env), ...free] : free;
  // The everyday model first (the app's default), then the lighter one and the admin's own.
  const ids = [env.CLAUDE_MODEL || CLAUDE_DEFAULT, env.CLAUDE_MODEL_LIGHT, defaultModelId(env, adminId)].filter((id): id is string => !!id).map((id) => modelOf(id).id);
  const claudes = [...new Set(ids)].map((id) => MODELS.find((m) => m.id === id && m.format === "anthropic")).filter((m): m is AskModel => !!m);
  return [...claudes, ...free];
}

export async function answerApp(env: Env, q: string, account: string, history: Turn[] = [], consent: string[] = [], deadlineMs = SEARCH_ANSWER_DEADLINE_MS, options: { model?: string; emit?: (event: AppStudyEvent) => void; study?: boolean; traceId?: string } = {}): Promise<SearchAnswer> {
  const t0 = Date.now();
  const question = q.trim();
  if (question.length > 4000) return { ok: false, reason: "too-long" };
  if (question.length < 2) return { ok: false, reason: "too-short" };
  // An answer the owner approved for this very question: given at once, with no model and no cost.
  const approved = approvedFor(question, history);
  if (approved) return { ok: true, answer: approved.answer, sources: approvedSources(approved), followups: approved.followups ?? [], model: "approved", provider: "CyberJudah", ms: Date.now() - t0 };
  // With no choice, a deep question (routeOf) goes to the stronger free model when one is configured
  // (ASK_FREE_DEEP_MODEL) and approved; everything else to the fast default.
  const deep = !options.model && env.ASK_FREE_DEEP_MODEL && routeOf(question, history) === "deep" ? appAskModels(env).find(m => m.id === env.ASK_FREE_DEEP_MODEL) : undefined;
  const model = deep ?? appAskModels(env).find(m => m.id === (options.model || freeModel(env).id));
  if (!model) return { ok: false, reason: "model-unavailable" };
  // Nothing is sent to a provider the reader has not agreed to, as in askStream.
  if (!consent.includes(model.provider)) return { ok: false, reason: "consent" };
  // The same first question, already answered this week by this model and mode: given at once (answer-cache.ts).
  const mode = options.study ? "study" : "app";
  const key = await cacheKey(question, history, model.id, mode, APP_STUDY_RELEASE.version);
  const kept = await cachedAnswer<SearchAnswer & { ok: true }>(env, key);
  if (kept?.ok) { await linkTrace(env, key, options.traceId); return { ...kept, ms: Date.now() - t0 }; }
  if (!(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, ASK_LIMIT))) return { ok: false, reason: "limit" };
  const cfg = creditsConfig(env);
  const budget = Math.min(estimateMc(model, cfg, { rounds: options.study ? 2 : 1 }).maxMc * MC_USD, freeMaxUsd(env));
  let reservation: FreeReservation | null;
  try { reservation = await reserveFreeBudget(env, crypto.randomUUID(), budget); }
  catch { return { ok: false, reason: "unavailable" }; }
  if (!reservation) return { ok: false, reason: "free-paused" };
  // A free meter with no owner: finishMeter settles the reservation and never touches a balance.
  const meter: Meter = { owner: "", request: reservation.request, held: 0, spend: makeSpend({ budgetUsd: budget, rates: cfg.research }), model, free: true, admin: false, reservation, maxRounds: 1 };
  const result = await boundedAnswer(env, model, meter, question, retrievalText(question, history), history, deadlineMs, t0, options.emit, mode, options.traceId);
  // Only an answer that found and cited teaching is kept; "nothing found" is always asked again.
  if (result.ok && result.sources.length) await keepAnswer(env, key, result, options.traceId);
  return result;
}

/**
 * The app's Ask, answered the way cyberjudah.io/app and Telegram answer (askStream): the model
 * researches in rounds with the same tools (the classes, the KJV with the Apocrypha, people,
 * dictionaries), streaming its steps, then writes a cited answer. Free models run on the shared
 * free budget; an admin's linked account answers with Claude (CLAUDE_MODEL by default), at no charge to
 * anyone but the owner's console, except on the Sabbath, feasts and New Moons (no paid calls from
 * sunset to dark), when the free model answers instead.
 */
export async function answerAppAgent(env: Env, q: string, account: string, history: Turn[] = [], consent: string[] = [], options: { model?: string; emit?: (event: AgentEvent) => void; traceId?: string; adminId?: number } = {}): Promise<SearchAnswer> {
  const t0 = Date.now();
  const question = q.trim();
  if (question.length > 4000) return { ok: false, reason: "too-long" };
  if (question.length < 2) return { ok: false, reason: "too-short" };
  const approved = approvedFor(question, history);
  if (approved) return { ok: true, answer: approved.answer, sources: approvedSources(approved), followups: approved.followups ?? [], model: "approved", provider: "CyberJudah", ms: Date.now() - t0 };
  const models = appAskModels(env, options.adminId, true);
  const paid = models.filter((m) => m.format === "anthropic");
  const adminClaude = !!options.adminId && isAdmin(env, options.adminId) && paid.length > 0;
  const isDeep = !options.model && routeOf(question, history) === "deep";
  const deep = isDeep && !paid.length && env.ASK_FREE_DEEP_MODEL ? models.find(m => m.id === env.ASK_FREE_DEEP_MODEL) : undefined;
  // A reader's default with Claude on: Haiku (paid[0]), or Sonnet (paid[1]) for a deep question.
  const readerDefault = !adminClaude && paid.length ? (isDeep ? paid[1] ?? paid[0] : paid[0]) : undefined;
  const model = options.model ? models.find(m => m.id === options.model) : deep ?? readerDefault ?? paid[0] ?? models.find(m => m.id === freeModel(env).id);
  if (!model) return { ok: false, reason: "model-unavailable" };
  if (!consent.includes(model.provider)) return { ok: false, reason: "consent" };
  const key = await cacheKey(question, history, model.id, "agent", APP_STUDY_RELEASE.version);
  const kept = await cachedAnswer<SearchAnswer & { ok: true }>(env, key);
  if (kept?.ok) { await linkTrace(env, key, options.traceId); return { ...kept, ms: Date.now() - t0 }; }
  let meter: Meter;
  if (model.format === "anthropic" && adminClaude) {
    // An admin's linked account: the admin meter holds nothing and charges no one.
    const started = await startMeter(env, options.adminId!, model, {});
    if (!started.ok) return { ok: false, reason: "unavailable" };
    meter = { ...started.meter, maxRounds: 4 };
  } else if (model.format === "anthropic") {
    // A signed-in reader on Claude (claudeForReaders): the reader's daily limit, then the answer's
    // most is reserved against Claude's own daily cap. Past the cap the free model answers.
    if (!(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, ASK_LIMIT))) return { ok: false, reason: "limit" };
    const budget = readerClaudeMaxUsd(env);
    let reservation: FreeReservation | null = null;
    try { reservation = budget > 0 ? await reserveFreeBudget(env, crypto.randomUUID(), budget, Date.now(), { prefix: "claude:", capUsd: readerClaudeCap(env) }) : null; }
    catch { return { ok: false, reason: "unavailable" }; }
    if (!reservation) {
      // The quota was taken for this question; the free answer below takes one more, as the backup path does.
      return answerAppAgent(env, q, account, history, [...consent, freeModel(env).provider], { ...options, model: freeModel(env).id, adminId: undefined });
    }
    meter = { owner: "", request: reservation.request, held: 0, spend: makeSpend({ budgetUsd: budget, rates: creditsConfig(env).research }), model, free: true, admin: false, reservation, maxRounds: 4 };
  } else {
    if (!(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, ASK_LIMIT))) return { ok: false, reason: "limit" };
    const cfg = creditsConfig(env);
    const rounds = freeMaxRounds(env);
    const budget = Math.min(estimateMc(model, cfg, { rounds }).maxMc * MC_USD, freeMaxUsd(env));
    let reservation: FreeReservation | null;
    try { reservation = await reserveFreeBudget(env, crypto.randomUUID(), budget); }
    catch { return { ok: false, reason: "unavailable" }; }
    if (!reservation) return { ok: false, reason: "free-paused" };
    meter = { owner: "", request: reservation.request, held: 0, spend: makeSpend({ budgetUsd: budget, rates: cfg.research }), model, free: true, admin: false, reservation, maxRounds: rounds };
  }
  const spend = meter.spend;
  const emit = options.emit ?? (() => undefined);
  try {
    const [found, verses] = await Promise.all([retrieve(env, retrievalText(question, history), 12, spend), versesNamed(env, question)]);
    const first = [...verses, ...answerCandidates(question, found, 8 - Math.min(verses.length, 2))];
    let ran: Awaited<ReturnType<typeof runAgent>>;
    try {
      ran = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k, spend), emit, undefined, undefined, model, spend, undefined, meter.maxRounds);
    } catch (e) {
      if (model.format !== "anthropic" || !claudeUnavailable(e)) throw e;
      // Claude cannot answer now (out of money, overloaded, down): the free model answers instead.
      await alertClaudeFunds(env, e);
      await finishMeter(env, meter, "backup", Date.now() - t0);
      emit({ reset: true });
      return answerAppAgent(env, q, account, history, [...consent, freeModel(env).provider], { ...options, model: freeModel(env).id, adminId: undefined });
    }
    const { answer, followups } = splitFollowups(ran.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, ""));
    if (!answer.trim()) { await finishMeter(env, meter, "empty", Date.now() - t0); return { ok: false, reason: "empty" }; }
    await finishMeter(env, meter, "ok", Date.now() - t0);
    const result: SearchAnswer = { ok: true, answer, sources: sourcesOf(answer, ran.passages), followups, model: model.id, provider: model.provider, ms: Date.now() - t0 };
    if (result.ok && result.sources.length) await keepAnswer(env, key, result, options.traceId);
    return result;
  } catch (e) {
    await finishMeter(env, meter, "failed", Date.now() - t0).catch(() => null);
    console.error(JSON.stringify({ event: "app_agent_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 160) }));
    return { ok: false, reason: "unavailable", detail: `failed: ${(e as Error).message?.slice(0, 160) ?? ""}` };
  }
}

/**
 * One library-grounded answer under a free meter: the passages, one plain call to the model,
 * the sources it cited. Shared by search answers and the app's Ask.
 */
async function boundedAnswer(env: Env, model: AskModel, meter: Meter, question: string, searchText: string, history: Turn[], deadlineMs: number, t0: number, emit?: (event: AppStudyEvent) => void, appMode?: "app" | "study", traceId?: string): Promise<SearchAnswer> {
  const spend = meter.spend;
  emit?.({ status: `Searching the classes and library for “${searchText.slice(0, 160)}”` });
  // One clock for retrieval and the model: it starts when retrieval does.
  const tRetrieve = Date.now();
  const deadlineAt = tRetrieve + deadlineMs;
  let retrieveMs = 0;
  try {
    // The verses the question names, in exact King James text, ahead of what the classes said about
    // them: the free model has no read_scripture, and may quote only what it is given.
    const [found, verses] = await withDeadline(Promise.all([retrieve(env, searchText, 12, spend), versesNamed(env, question)]), deadlineMs);
    const passages = [...verses, ...answerCandidates(question, found, 8 - Math.min(verses.length, 2))];
    retrieveMs = Date.now() - tRetrieve;
    for (const passage of passages) emit?.({ status: `Reading ${passage.title.slice(0, 180)}` });
    if (appMode === "study") {
      // Await each metered inference before settling its reservation, even if the client
      // disconnects. A racing timeout must not settle while inference is still spending.
      const result = await answerAppStudy(env, question, history, passages, model, spend, emit ?? (() => undefined), deadlineAt, traceId);
      await finishMeter(env, meter, "ok", Date.now() - t0);
      return { ok: true, ...result, model: model.id, provider: model.provider, ms: Date.now() - t0 };
    }
    // Nothing found: a greeting or a thank-you is still answered, in a sentence; a real question is
    // told so plainly, with no model call, rather than answered from the model's own memory.
    if (!passages.length && !SMALL_TALK.test(question)) {
      await finishMeter(env, meter, "empty", Date.now() - t0);
      return { ok: true, answer: "The search did not find enough reliable material in the library to answer that question. Try asking it another way, or name the person, book, feast or verse you mean.", sources: [], followups: [], model: model.id, provider: model.provider, ms: Date.now() - t0 };
    }
    // Use the plain adapter even for chat models: one bounded answer, never a research loop.
    const prompt = buildPrompt(question, passages, history);
    const system = prompt.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = prompt.filter((m): m is { role: "user" | "assistant"; content: string } => m.role !== "system");
    const left = deadlineAt - Date.now();
    if (left <= 0) throw new DeadlineError(deadlineMs);
    const tModel = Date.now();
    const ran = await withDeadline(researchOpen(env, { ...model, format: "plain" }, system, messages,
      [], new Map(), async () => ({ content: "No tools are available." }), emit ?? (() => undefined), 1, spend, !!emit), left);
    // Where the time goes, for tuning: finding the passages, and the model writing the answer.
    console.log(JSON.stringify({ event: "search_answer_timing", retrieveMs, modelMs: Date.now() - tModel, totalMs: Date.now() - t0 }));
    // A reasoning model's private working, if it ever comes back in the text, is not the answer.
    const { answer: written, followups } = splitFollowups(ran.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, ""));
    const answer = await checkedVerses(env, written);
    if (!answer.trim()) { await finishMeter(env, meter, "empty", Date.now() - t0); return { ok: false, reason: "empty" }; }
    await finishMeter(env, meter, "ok", Date.now() - t0);
    return { ok: true, answer, sources: passages.length ? sourcesOf(answer, passages) : [], followups, model: model.id, provider: model.provider, ms: Date.now() - t0 };
  } catch (e) {
    await finishMeter(env, meter, "failed", Date.now() - t0).catch(() => null);
    console.error(JSON.stringify({ event: e instanceof DeadlineError ? "search_answer_timeout" : "search_answer_failed", elapsedMs: Date.now() - t0, retrieveMs, message: (e as Error).message?.slice(0, 160) }));
    // The same bounded message, for the monitoring record (ask-events.ts).
    return { ok: false, reason: "unavailable", detail: `${e instanceof DeadlineError ? "timeout" : "failed"}: ${(e as Error).message?.slice(0, 160) ?? ""}` };
  }
}

type Msg = { role: "system" | "user" | "assistant"; content: string };
const CLAUDE_DEFAULT = "claude-sonnet-5";
/**
 * The model an answer uses when the reader has not chosen one: an admin's (CLAUDE_MODEL_ADMIN,
 * Claude Opus 5.5 when unset) or every other reader's (CLAUDE_MODEL, Claude Sonnet when unset).
 */
export const defaultModelId = (env: Env, userId: number) => (isAdmin(env, userId) ? env.CLAUDE_MODEL_ADMIN || "claude-opus-5-5" : env.CLAUDE_MODEL || CLAUDE_DEFAULT);

/** The answer, whole: Claude when it can be called (hasClaude), Llama on Workers AI otherwise, or when Claude cannot answer now. */
async function answerOnce(env: Env, messages: Msg[]): Promise<string> {
  if (hasClaude(env)) {
    try { return await claudeOnce(env, messages); }
    catch (e) {
      if (!claudeUnavailable(e)) throw e;
      console.error(JSON.stringify({ event: "ask_claude_unavailable", status: (e as { status?: number }).status ?? 0, backup: "workers-ai" }));
      await alertClaudeFunds(env, e);
    }
  }
  const res = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: 900, temperature: 0.3 }, viaGateway(env)) as { response?: string };
  return (res.response ?? "").trim();
}
async function claudeOnce(env: Env, messages: Msg[]): Promise<string> {
  {
    const client = await claude(env);
    const res = await client.messages.create({ model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"), messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  }
}

/** The answer as it is written, piece by piece: Claude, or Workers AI when there is no key or `backup` is asked for. */
async function* answerPieces(env: Env, messages: Msg[], backup = false): AsyncGenerator<string> {
  if (hasClaude(env) && !backup) {
    const client = await claude(env);
    const stream = client.messages.stream({ model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"), messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
    for await (const event of stream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    return;
  }
  const out = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: 900, temperature: 0.3, stream: true }, viaGateway(env)) as ReadableStream<Uint8Array>;
  let buffer = "";
  const reader = out.getReader(); const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
    for (const ev of events) for (const l of ev.split("\n")) {
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") continue;
      try { const piece = (JSON.parse(data) as { response?: string }).response ?? ""; if (piece) yield piece; } catch { /* a partial event */ }
    }
  }
}

/** The answer with every quoted verse checked against the King James text (verse-guard.mjs). */
async function checkedVerses(env: Env, answer: string): Promise<string> {
  if (!/^>/m.test(answer)) return answer;
  try {
    const r = await guardVerses(answer, await books(env).catch(() => null), (slug, ch) => chapter(env, slug, ch));
    if (r.fixed || r.removed) console.log(JSON.stringify({ event: "ask_verse_guard", checked: r.checked, fixed: r.fixed, removed: r.removed }));
    return r.text;
  } catch { return answer; }
}

/** A greeting, a thank-you or a question about Ask itself: answered even when the library has no passages for it. */
const SMALL_TALK = /^\s*(hi|hello|hey|shalom|good (morning|afternoon|evening)|thanks?( you)?|thank you( so much)?|ok(ay)?|got it|who are you|what are you|what can you do|how do(es)? (this|you) work)\b[\s!.?,]*\S{0,40}$/i;

/** The exact King James text of the verses a question names (at most three references, twelve verses each). */
async function versesNamed(env: Env, question: string): Promise<Passage[]> {
  const named = referencesIn(question);
  if (!named.length) return [];
  const list = await books(env).catch(() => null);
  if (!list) return [];
  const out: Passage[] = [];
  for (const raw of named) {
    const ref = parseReference(raw, list);
    if (!ref?.verse) continue;
    const c = await chapter(env, ref.slug, ref.chapter).catch(() => null);
    const from = ref.verse, to = Math.min(ref.verseEnd ?? from, from + 11);
    const verses = c?.verses.filter((v) => v.verse >= from && v.verse <= to) ?? [];
    if (!verses.length) continue;
    out.push({ kind: "verse", title: `${ref.book} ${ref.chapter}:${from}${to > from ? `-${to}` : ""} (KJV)`, url: `/bible/${ref.slug}/${ref.chapter}`, sub: "", text: verses.map((v) => `${v.verse} ${v.text}`).join("\n").slice(0, 1400) });
  }
  return out;
}

const sourcesOf = (answer: string, passages: Passage[]) => {
  const used = citations(answer, passages.length);
  return (used.length ? used : passages.slice(0, 4).map((_, i) => i + 1)).map((n) => ({ ...passages[n - 1], n }));
};

/**
 * The same, streamed: one JSON line with the passages first, then a line per piece of the
 * answer as the model writes it, then a line with the sources it cited.
 */
export async function askStream(env: Env, q: string, userId: number, ctx: Exec | undefined, history: Turn[], chatId?: string, replaceLast = false, modelId?: string, consent: string[] = [], opts: MeterOpts = {}): Promise<Response> {
  const question = q.trim().slice(0, 400);
  // The reader's choice of model, or their configured account default. With no choice, a light
  // question (routeOf) goes to the lighter Claude model when one is configured (CLAUDE_MODEL_LIGHT):
  // it is answered faster and costs the reader less. Admins keep their own default.
  const light = !modelId && !isAdmin(env, userId) && env.CLAUDE_MODEL_LIGHT && routeOf(question, history) === "light";
  const model = modelOf(modelId || (light ? env.CLAUDE_MODEL_LIGHT : undefined), defaultModelId(env, userId));
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;
  const reply = (status: number, o: unknown) => new Response(line(o), { status, headers: { "content-type": "application/x-ndjson" } });
  if (question.length < 2) return reply(400, { error: "too-short" });
  // An answer the owner approved for this very question: sent at once, with no provider and no charge.
  const approved = approvedFor(question, history);
  if (approved) return new Response(line({ delta: approved.answer }) + line({ done: true, answer: approved.answer, followups: approved.followups ?? [], sources: approvedSources(approved), approved: true }), { headers: { "content-type": "application/x-ndjson" } });
  // Nothing is sent to an AI provider the reader has not agreed to (Apple 5.1.2(i); Telegram Bot
  // Developer Terms 4.3, Standard Bot Privacy Policy 6.2): the app asks, then sends again.
  // Where the provider is based goes with it, when known, for the agreement card.
  if (!consent.includes(model.provider)) return reply(428, { error: "consent", provider: model.provider, model: model.name, ...(countryOf(model.provider) ? { country: countryOf(model.provider) } : {}) });
  // The balance: held before anything is spent, settled once at the end with what the answer
  // actually cost (finishMeter). Leaving mid-answer does not cancel it (waitUntil), so it is still
  // settled once. Too little for this model: Ask says so and offers the free model and a top-up.
  // A routed light answer may cost up to what the reader accepted for their default model, which is dearer.
  const fallbackCap = light ? opts.caps?.[modelOf(undefined, defaultModelId(env, userId)).id] : undefined;
  const started = await begin(env, userId, model, fallbackCap && !opts.caps?.[model.id] ? { ...opts, caps: { ...opts.caps, [model.id]: fallbackCap } } : opts);
  if (!started.ok) return reply(started.status, started.body);
  const meter = started.meter;
  const spend = meter?.spend ?? freeSpend();
  const encoder = new TextEncoder();
  // The reader can leave at any moment (Stop, another screen, the app closed). From then on
  // nothing more is sent, but the answer is still finished, saved and charged exactly once:
  // the work runs under waitUntil, not inside the response, so leaving does not cancel it.
  let open = true;
  let settled = false;
  const finish = async (status: Parameters<typeof finishMeter>[2]) => {
    if (settled || !meter) return null;
    settled = true;
    return finishMeter(env, meter, status);
  };
  // While it is being answered, the conversation says so, for a refresh or another device to wait on.
  if (chatId) await markPending(env, userId, chatId, question).catch(() => undefined);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => { if (!open) return; try { controller.enqueue(encoder.encode(line(o))); } catch { open = false; } };
      // A line every 15 seconds while the research runs, so the app can tell a slow answer from a dead connection.
      const beat = setInterval(() => send({ ping: 1 }), 15000);
      // The finished exchange is saved to the person's conversations, even if they left mid-answer.
      const keep = async (content: string, sources: unknown[], followups: string[], steps: string[] = [], actions: SavedAction[] = [], cut = false) => {
        if (!chatId) return;
        await saveExchange(env, userId, chatId, question, { content, sources: sources as never, followups, steps, actions, cut }, replaceLast).catch((e: Error) => console.error(JSON.stringify({ event: "chat_save_failed", message: e.message?.slice(0, 120) })));
      };
      const job = (async () => {
        try {
          const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12, spend), 8);
          let backup = false;
          // Claude needs its own access (hasClaude); every other model goes through the AI Gateway.
          if (model.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY) {
            // Claude researches first (searches and verses, reported as it goes), then writes.
            const steps: string[] = [];
            let ran: Awaited<ReturnType<typeof runAgent>> | null = null;
            try { ran = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k, spend), (e: AgentEvent) => { if ("status" in e && /^(Searching|Reading|Looking)/.test(e.status)) steps.push(e.status); send(e); }, ctx, userId, model, spend, opts.resources, meter?.maxRounds); }
            catch (e) {
              // Claude cannot answer now (overloaded, rate limited, down, or its key refused): the
              // backup model answers from the passages already found, and the reader is not charged.
              if (!claudeUnavailable(e)) throw e;
              console.error(JSON.stringify({ event: "ask_claude_unavailable", status: (e as { status?: number }).status ?? 0, backup: "workers-ai" }));
              await alertClaudeFunds(env, e);
              await finish("backup");
              send({ reset: true });
              send({ status: "Answering with the backup model" });
              backup = true;
            }
            if (ran) {
              const { text, passages, actions, cut, refused } = ran;
              const { answer, followups } = splitFollowups(text);
              // Claude declined the question (stop_reason "refusal"): said so, never shown as an answer, not charged.
              if (refused && !answer.trim()) { await finish("refused"); send({ error: "refused" }); return; }
              if (!answer.trim()) { await finish("empty"); send({ error: "empty" }); return; }
              const used = await finish("ok");
              const sources = sourcesOf(answer, passages);
              // Saved first: whatever happens to the connection after this, the answer is kept.
              await keep(answer, sources, followups, steps, actions, cut);
              send({ done: true, answer, followups, sources, actions, ...(cut ? { cut: true } : {}) });
              // What the answer cost, and the balance after it; the free model and admins pay nothing.
              if (used) send({ usage: { charged_mc: used.charged_mc, balance: used.balance } });
              else if (meter?.free && creditsOn(env)) send({ usage: { charged_mc: 0, free: true } });
              return;
            }
          }
          const passages = first;
          send({ passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
          // The backup cannot research: with nothing found to answer from, it says Claude is busy
          // rather than that the library has nothing (which only the research could tell).
          if (!passages.length && backup) { send({ error: "busy" }); return; }
          if (!passages.length) {
            const answer = "The search did not find enough reliable material in the library to answer that question.";
            await finish("empty");
            await keep(answer, [], []);
            send({ delta: answer }); send({ done: true, answer, followups: [], sources: [] }); return;
          }
          let answer = "";
          for await (const piece of answerPieces(env, buildPrompt(question, passages, history), backup)) { answer += piece; send({ delta: piece }); }
          const { answer: clean, followups } = splitFollowups(answer);
          if (!clean.trim()) { send({ error: "empty" }); return; }
          const sources = sourcesOf(clean, passages);
          await keep(clean, sources, followups);
          // The backup (or a setup without the model's access) wrote this from the passages: not charged.
          await finish("backup");
          send({ done: true, answer: clean, followups, sources, ...(backup ? { backup: true } : {}) });
        } catch (e) {
          // An answer that failed is not charged: the hold goes back.
          await finish("failed");
          console.error(JSON.stringify({ event: "ask_stream_failed", message: (e as Error).message?.slice(0, 200) }));
          send({ error: "unavailable" });
        } finally {
          // Whatever way it ended, the hold is settled once: an answer that got no further is not charged.
          await finish("failed");
          clearInterval(beat);
          if (chatId) await clearPending(env, userId, chatId).catch(() => undefined);
        }
      })();
      ctx?.waitUntil(job);
      await job;
      if (open) { open = false; try { controller.close(); } catch { /* already closed */ } }
    },
    cancel() { open = false; },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

export type Similar = { ok: true; q: string; hits: (Passage & { score: number })[]; ms: number } | { ok: false; reason: string };
export async function similar(env: Env, q: string, limit = 20): Promise<Similar> {
  const t0 = Date.now();
  const text = q.trim().slice(0, 400);
  if (text.length < 2) return { ok: true, q: text, hits: [], ms: 0 };
  try { return { ok: true, q: text, hits: await retrieve(env, text, limit), ms: Date.now() - t0 }; }
  catch (e) {
    console.error(JSON.stringify({ event: "similar_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
}

export const isVoice = (v: string) => VOICES.some((x) => x.id === v);
export const toBytes = async (out: unknown): Promise<Uint8Array | null> => {
  if (out instanceof ReadableStream) return new Uint8Array(await new Response(out).arrayBuffer());
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out instanceof Uint8Array) return out;
  if (typeof out === "string") return Uint8Array.from(atob(out), (c) => c.charCodeAt(0));
  if (out && typeof out === "object" && "audio" in out && typeof (out as { audio: unknown }).audio === "string") return Uint8Array.from(atob((out as { audio: string }).audio), (c) => c.charCodeAt(0));
  return null;
};

/** One verse read by one voice, as MP3: from R2 when it was read before, else generated and kept. */
export async function speakVerse(env: Env, slug: string, ch: number, verse: number, voice: string, userId: number, ctx?: Exec): Promise<Response> {
  if (!isVoice(voice)) return Response.json({ ok: false, reason: "bad-voice" }, { status: 400 });
  const key = `tts/aura-1/${voice}/${slug}/${ch}/${verse}.mp3`;
  const headers = { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000, immutable" };
  const kept = await env.AUDIO.get(key);
  if (kept) return new Response(kept.body, { headers });
  // A generation is a model call; a cache hit is not. Each person gets fifty new ones a day,
  // so one client cannot enumerate the library's voices on the project's budget.
  if (!(await takeQuota(env, "ttsg", userId, TTS_LIMIT))) return Response.json({ ok: false, reason: "limit" }, { status: 429 });
  const c = await chapter(env, slug, ch, ctx);
  const v = c?.verses.find((x) => x.verse === verse);
  if (!v) return Response.json({ ok: false, reason: "not-found" }, { status: 404 });
  try {
    const out = await env.AI.run(VOICE_MODEL, { text: v.text, speaker: voice as "asteria", encoding: "mp3" }, viaGateway(env, { log: true }));
    const bytes = await toBytes(out);
    if (!bytes?.length) throw new Error("no audio");
    const put = env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } });
    if (ctx) ctx.waitUntil(put); else await put;
    return new Response(bytes, { headers });
  } catch (e) {
    console.error(JSON.stringify({ event: "tts_failed", message: (e as Error).message?.slice(0, 200) }));
    return Response.json({ ok: false, reason: "unavailable" }, { status: 503 });
  }
}
