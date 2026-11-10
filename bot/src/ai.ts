import { boundedFrame, hasSourceList } from "./ask-frame";
import { askIpKey, clientIp } from "./client-ip";
import type { ResourcePins } from "../../shared/resources";
import { books, chapter, dataJson } from "./data";
import { parseReference } from "./refs.mjs";
import { guardVerses } from "./verse-guard.mjs";
import { approvedFor, approvedSources } from "./approved-answers";
import { cacheKey, cachedAnswer, keepAnswer, linkTrace } from "./answer-cache";
import { runSearch } from "./search";
import type { Env, Exec } from "./env";
import { ANSWER_MODEL, answerCandidates, buildPrompt, referencesIn, retrievalText, routeOf, dedupeMatches, notInTheClasses, EMBED_MODEL, RERANK_MODEL, splitFollowups, VOICE_MODEL, VOICES, type Passage, type Turn } from "./ai.mjs";
import { runAgent, type AgentEvent } from "./agent";
import { studyFields, type StudyFields } from "./study-plan";
import { MAX_RESEARCH_ROUNDS, MAX_RESEARCH_MS, adminBudgetPool, researchRounds, researchSignal, timeLeft } from "./research-policy.mjs";
import { withTeachers } from "./class-attribution";
export { withTeachers } from "./class-attribution";
import { backupOnce, backupPieces, mayUseBackup } from "./backup-answer";
import { answerAppStudy, type AppStudyEvent } from "./app-study-answer";
import { APP_STUDY_RELEASE } from "./app-study-release";
import { alertClaudeFunds, claudeUnavailable, hasClaude, unifiedBilling, viaGateway } from "./providers";
import { countryOf, MODELS, modelOf, type AskModel } from "../../shared/ask-models.mjs";
import { pid } from "./privacy.mjs";
import { clearPending, markPending, saveExchange, type SavedAction } from "./chats";
import { isAdmin } from "./edit";
import { creditsConfig, hold, ownerOfUser, prepare, settle, typicalMc, wallet, type Wallet } from "./credits";
import { estimateMc, MC_USD, mcOfUsd, viaUnifiedBilling } from "../../shared/credits.mjs";
import { freeSpend, makeSpend, type Spend } from "./spend";
import { reserveFreeBudget, settleFreeBudget, type FreeReservation } from "./free-budget";
import { ModelBudgetError, researchOpen } from "./agent-open";
import { withAskSourcePictures } from "./ask-source-pictures";
import { withAskBookLinks } from "./ask-source-links";
import { recordRetrieval, assessCoverage, hasControlText, SMALL_TALK, markCoverageGap, isCoverageGap } from "./grounding.mjs";
import { citationReport, citationTokenCount } from "./citations.mjs";
import { autoModel } from "./ask-routing";
import { approvedSources as approvedOutsideHosts } from "./source-policy";
import { recordedMoment, retrievedSourceUrl } from "./retrieved-source-url";
import { issueAnswerReceipt } from "./feedback";
export { freeSpendToday, freePaused } from "./free-budget";

/**
 * The AI features, all through Workers AI and the Vectorize index of the teachings:
 * embeddings (bge-m3), retrieval of the closest passages, an answer grounded in them with
 * citations (llama 3.3 70b), search by meaning, and the reading voices (Deepgram Aura),
 * each verse generated once and kept in R2.
 */
export async function embed(env: Env, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    signal?.throwIfAborted();
    const res = await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 100) }, { ...viaGateway(env), ...(signal ? { signal } : {}) }) as { data?: number[][] };
    out.push(...(res.data ?? []));
  }
  return out;
}

const passageOf = (m: { metadata?: Record<string, unknown>; score: number }, hosts: string[]): (Passage & { score: number }) | null => {
  const md = (m.metadata ?? {}) as Record<string, string | number>;
  const url = retrievedSourceUrl(md, hosts);
  if (!url) return null;
  return { kind: String(md.kind ?? ""), title: String(md.title ?? ""), url, sub: String(md.sub ?? ""), video: md.video ? String(md.video) : undefined, t: recordedMoment(md.t), date: md.date ? String(md.date) : undefined, text: String(md.text ?? ""), score: m.score };
};

/**
 * The passages for a question: the twenty closest in meaning from the index and the best
 * keyword matches from the library search, together, reranked by whether they answer it.
 */
export async function retrieve(env: Env, text: string, topK = 12, spend?: Spend, signal?: AbortSignal): Promise<(Passage & { score: number })[]> {
  const [vectorRes, keywordRes, hosts] = await Promise.all([
    // Search by meaning falls back to the keyword search alone if Workers AI or Vectorize fails,
    // so a question is still answered (and Claude can still research) rather than failing whole.
    embed(env, [text], signal).then(([vector]) => (vector ? env.VEC.query(vector, { topK: 20, returnMetadata: "all" }) : { matches: [] as VectorizeMatches["matches"] }))
      .catch((e: Error) => { console.error(JSON.stringify({ event: "retrieve_vector_failed", message: e.message?.slice(0, 120) })); return { matches: [] as VectorizeMatches["matches"] }; }),
    runSearch(env.DB, text, undefined, 3, true).catch(() => null),
    approvedOutsideHosts(env).catch(() => []),
  ]);
  // A passage must say something: scraps of captions ("do", "yeah so") sit close to every question.
  const said = vectorRes.matches.filter((m) => String((m.metadata as Record<string, unknown> | undefined)?.text ?? "").split(/\s+/).length >= 20);
  // Omit unlinkable evidence before assigning any citation IDs, never after registration.
  const close = dedupeMatches(said).flatMap(m => { const passage = passageOf(m, hosts); return passage ? [recordRetrieval(passage, "vector", m.score)] : []; });
  const keyed: (Passage & { score: number })[] = keywordRes?.ok ? keywordRes.hits.filter((h) => h.text && h.text.split(/\s+/).length >= 20).flatMap((h) => {
    const url = retrievedSourceUrl(h, hosts);
    return url ? [recordRetrieval({ kind: h.kind, title: h.title, url, sub: h.sub, text: h.text!.slice(0, 1400), score: 0.5 }, "keyword")] : [];
  }) : [];
  const seen = new Set(close.map((p) => `${p.kind}|${p.url}|${p.sub ?? ""}`));
  const all = [...close, ...keyed.filter((p) => !seen.has(`${p.kind}|${p.url}|${p.sub ?? ""}`))];
  // What this search cost: the question embedded, one vector query, and what the reranker read.
  spend?.search({ query: text, contexts: all.length > 1 ? all.map((p) => `${p.title}\n${p.text}`.slice(0, 2000)) : [] });
  return withTeachers(env, await rerank(env, text, all, topK, signal));
}

/**
 * The closest passages read against the question by a reranker, which orders them by whether
 * they answer it rather than by how near their words sit; the vector order stands when the
 * reranker is unavailable.
 */
async function rerank<T extends Passage>(env: Env, question: string, passages: T[], topK: number, signal?: AbortSignal): Promise<T[]> {
  if (passages.length <= 1) return passages.slice(0, topK);
  try {
    // The published type leaves `query` out; the model takes it.
    const input = { query: question, contexts: passages.map((p) => ({ text: `${p.title}\n${p.text}`.slice(0, 2000) })), top_k: topK };
    const res = await (env.AI as unknown as { run(model: string, input: unknown, options?: unknown): Promise<unknown> }).run(RERANK_MODEL, input, { ...viaGateway(env), ...(signal ? { signal } : {}) }) as { response?: { id?: number; score?: number }[] };
    const order = (res.response ?? []).filter((r) => typeof r.id === "number" && passages[r.id!]).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (!order.length) return passages.slice(0, topK);
    return order.slice(0, topK).map((r) => passages[r.id!]);
  } catch { return passages.slice(0, topK); }
}

export type Answer = ({ ok: true; q: string; answer: string; sources: (Passage & { n: number })[]; unsupported_refs?: string[]; ms: number; cut?: boolean } & StudyFields) | { ok: false; reason: string };
/** Ask answers a day per person (ASK_DAILY_LIMIT; a hundred when unset). */
export function askLimit(env: Env): number {
  const n = Number(env.ASK_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

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

/** The per-address Ask backstop (ASK_IP_DAILY_LIMIT, at least 100, 1000 by default) for both Ask
 *  endpoints: false when this address has used the day's allowance. No address, no check. */
export async function takeAskIpQuota(req: Request, env: Env): Promise<boolean> {
  const ip = await clientIp(req, env);
  return !ip || await takeQuotaKey(env, await askIpKey(env, ip), Math.max(100, Number(env.ASK_IP_DAILY_LIMIT ?? 1000)));
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
    // Per-address Ask counters keep only a keyed hash (client-ip.ts askIpKey: "ask_ip:" + 64 hex +
    // ":" + day, 82 characters); any older row holding a raw address goes at the next sweep.
    env.DB.prepare("DELETE FROM rate_counts WHERE key LIKE 'ask_ip:%' AND length(key) <> 82"),
  ]);
  return [1, 2].reduce((n, i) => n + Number((res[i] as { meta?: { changes?: number } }).meta?.changes ?? 0), 0);
}

/** ASK_DAILY_LIMIT answers a day per person. */
async function allowed(env: Env, userId: number): Promise<boolean> {
  return takeQuota(env, "ask", userId, askLimit(env));
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
export type MeterOpts = { resources?: ResourcePins; request?: string; maxMc?: number; caps?: Record<string, number>; signal?: AbortSignal; clientStreaming?: boolean };

/**
 * The free tier answers at the owner's expense, with the same default research guard
 * (ASK_FREE_MAX_ROUNDS, 3 by default, at most 25) and a hard per-answer ceiling (ASK_FREE_MAX_USD, five cents).
 * Without the ceiling, one answer's budget is the paid per-request maximum.
 */
const freeMaxRounds = (env: Env) => { const rounds = Number(env.ASK_FREE_MAX_ROUNDS ?? 3); return researchRounds(Number.isFinite(rounds) ? rounds : 3); };
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
    const rounds = sponsoredSearch ? 1 : isFree && !admin ? freeMaxRounds(env) : MAX_RESEARCH_ROUNDS;
    const estFree = budgeted ? estimateMc(model, cfg, { rounds }) : est;
    const budget = budgeted ? Math.min(estFree.maxMc * MC_USD, freeMaxUsd(env)) : est.maxMc * MC_USD;
    let reservation: FreeReservation | undefined;
    {
      try {
        const held = await reserveFreeBudget(env, crypto.randomUUID(), budget, Date.now(), admin && !sponsoredSearch ? adminBudgetPool(env) : undefined);
        if (!held) return { ok: false, status: 429, body: { error: "free-paused", ...(admin && !sponsoredSearch ? { message: "The admin answer budget is used up for today. It resets at midnight UTC." } : {}) } };
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
export async function finishMeter(env: Env, m: Meter, status: "ok" | "failed" | "refused" | "empty" | "backup" | "partial", elapsedMs?: number, chargePartial = false): Promise<{ charged_mc: number; balance: Wallet } | null> {
  const cost = m.spend.total();
  const actual = mcOfUsd(cost);
  const charged = (status === "ok" || (status === "partial" && chargePartial)) && !m.free ? Math.min(actual, m.held) : 0;
  const detail = { calls: m.spend.calls, searches: m.spend.searches, model_usd: Math.round(m.spend.modelUsd * 1e6) / 1e6, research_usd: Math.round(m.spend.researchUsd * 1e6) / 1e6, usage_complete: !m.spend.unreported };
  console.log(JSON.stringify({ event: "ask_usage", model: m.model.id, status, cost_usd: Math.round(cost * 1e6) / 1e6, charged_mc: charged, held_mc: m.held, free: m.free, ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...detail }));
  // Failed/backup calls may have incurred unreported provider costs. Keep their full
  // reservation; a failed settlement leaves the reservation held, never reusable.
  if (m.reservation) await settleFreeBudget(env, m.reservation,
    m.spend.unreported || (!m.admin && (status === "failed" || status === "backup")) ? Math.max(cost, m.spend.budgetUsd ?? 0) : cost);
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
    return freeModels(env).has(model.id) || isAdmin(env, uid) ? startMeter(env, uid, model, opts) : { ok: true, meter: null };
  }
  // Apply the reader quota before reserving the global budget: denied requests use none.
  if (freeModels(env).has(model.id) && !isAdmin(env, uid) && !(await allowed(env, uid))) return { ok: false, status: 429, body: { error: "limit" } };
  return startMeter(env, uid, model, opts);
}

/** A question answered in one piece (the bot and older clients). It cannot ask first, so it is held to ASK_CONFIRM_ABOVE_USD at most. */
export async function ask(env: Env, q: string, userId: number, ctx?: Exec, history: Turn[] = [], consent: string[] = [], resources?: ResourcePins, callerSignal?: AbortSignal): Promise<Answer> {
  const t0 = Date.now();
  const signal = researchSignal(callerSignal, t0 + MAX_RESEARCH_MS);
  const question = q.trim();
  if (question.length > 4000) return { ok: false, reason: "too-long" };
  if (question.length < 2) return { ok: false, reason: "too-short" };
  const model = modelOf(defaultModelId(env, userId));
  // The one-piece answer uses the setup's own model: agreed to, as in askStream.
  if (!consent.includes(model.provider)) return { ok: false, reason: "consent" };
  const r = await begin(env, userId, model, { maxMc: creditsConfig(env).confirmAboveMc });
  if (!r.ok) return { ok: false, reason: r.body.error === "free-paused" ? "free-paused" : r.status === 429 ? "limit" : r.status === 503 ? "unavailable" : "credits" };
  const meter = r.meter;
  const spend = meter?.spend ?? freeSpend();
  try {
    const first = answerCandidates(question, await withDeadline(retrieve(env, retrievalText(question, history), 12, spend, signal), timeLeft(t0 + MAX_RESEARCH_MS)), 8);
    signal.throwIfAborted();
    if (model.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY) {
      const ran = await runAgent(env, question, history, first, (t, k, readingSignal) => retrieve(env, t, k, spend, readingSignal ?? signal), () => undefined, ctx, undefined, model, spend, resources, meter?.maxRounds, true, { signal, deadlineAt: t0 + MAX_RESEARCH_MS });
      const { text, passages, grounded, cut } = ran;
      const answer = await checkedVerses(env, splitFollowups(text).answer);
      if (meter) await finishMeter(env, meter, cut ? "partial" : grounded === false ? "empty" : answer.trim() ? "ok" : "empty");
      const sources = await askSourcesOf(env, answer, passages);
      return { ok: true, q: question, answer, sources, ...citationMetadata(answer, passages), ...(cut ? { cut: true } : {}), ...studyFields(ran.tracked, ran.plan, ran.coverage, sources.map(s => s.n), answer), ms: Date.now() - t0 };
    }
    // The backup sends the question to its own provider: only with the reader's agreement to it.
    // Without it nothing is written by a model, so nothing is held: the meter settles as empty.
    const backupAllowed = mayUseBackup(consent);
    if (meter) await finishMeter(env, meter, backupAllowed ? "backup" : "empty");
    const passages = first;
    if (assessCoverage(env, retrievalText(question, history), passages).blocked && passages.length) { const gap = notInTheClasses(passages.filter(source => !hasControlText(`${source.title}\n${source.text}`))); return { ok: true, q: question, answer: gap.answer, sources: await askSourcesOf(env, gap.answer, gap.sources), unsupported_refs: [], ms: Date.now() - t0 }; }
    if (!passages.length) return { ok: true, q: question, answer: "The search did not find enough reliable material in the library to answer that question.", sources: [], unsupported_refs: [], ms: Date.now() - t0 };
    if (!backupAllowed) return { ok: false, reason: "unavailable" };
    const { answer } = splitFollowups(await answerOnce(env, buildPrompt(question, passages, history), isAdmin(env, userId), passages, signal));
    return { ok: true, q: question, answer, sources: await askSourcesOf(env, answer, passages), ...citationMetadata(answer, passages), ms: Date.now() - t0 };
  } catch (e) {
    // An answer that failed is not charged: the hold goes back.
    if (meter) await finishMeter(env, meter, "failed");
    console.error(JSON.stringify({ event: "ask_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
}

type CitationDiagnostics = { sources_returned: number; citation_tokens_found: number; valid_ids: number; retries: number; model: string };
export type SearchAnswer =
  | ({ ok: true; answer: string; followups?: string[]; sources: (Passage & { n: number; evidence?: string; thumb?: string })[]; model: string; provider: string; ms: number; unsupported_refs?: string[]; ui?: string; teachingFound?: boolean; state?: "no-cited-answer"; related?: { label: "Related library passages"; passages: Passage[] }; citation_diagnostics?: CitationDiagnostics; cut?: boolean } & StudyFields)
  | { ok: false; reason: "too-short" | "too-long" | "model-unavailable" | "unavailable" | "empty" | "free-paused" | "consent" | "limit"; detail?: string };

/** Search defaults to hosted free-tier models; third-party billing requires an explicit opt-in. */
export function searchModel(env: Env): AskModel | null {
  const id = env.SEARCH_AI_MODEL?.trim() || freeModel(env).id;
  if (env.SEARCH_AI_FREE_ONLY !== "off" && !id.startsWith("@cf/")) return null;
  return MODELS.find((m) => m.id === id && FREE_FORMATS.has(m.format)
    && (m.id.startsWith("@cf/") || m.provider === "Google" && m.id.startsWith("google/"))) ?? null;
}

/**
 * A library-grounded answer with at most one citation retry, funded by the same free reservation. A configured
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
  return Promise.race([work, late]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
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
  return boundedAnswer(env, model, started.meter, question, question, [], deadlineMs, t0, undefined, undefined, undefined, true);
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
/** Everything Claude may spend for readers, over all days (the prepaid amount); unset means no total. */
const readerClaudeTotal = (env: Env) => { const n = Number(env.ASK_CLAUDE_TOTAL_USD_CAP); return env.ASK_CLAUDE_TOTAL_USD_CAP && Number.isFinite(n) && n >= 0 ? n : undefined; };
const readerClaudeMaxUsd = (env: Env) => Math.min(usdSetting(env.ASK_CLAUDE_MAX_USD, 0.2), readerClaudeCap(env));
export const claudeForReaders = (env: Env) => env.ASK_CLAUDE_FOR_READERS === "on" && hasClaude(env) && readerClaudeCap(env) > 0;
function readerClaudes(env: Env): AskModel[] {
  // The lighter model first: it is the default answer; the everyday model takes the deep questions.
  const ids = [env.CLAUDE_MODEL_LIGHT || "claude-haiku-5-5", env.CLAUDE_MODEL || CLAUDE_DEFAULT].map((id) => modelOf(id).id);
  return [...new Set(ids)].map((id) => MODELS.find((m) => m.id === id && m.format === "anthropic")).filter((m): m is AskModel => !!m);
}

/**
 * The models the app offers: the approved free models, and for an admin's linked account Claude
 * (when it can be called), every day: the owner chose not to pause it on holy days.
 */
export function appAskModels(env: Env, adminId?: number, readers = false): AskModel[] {
  const allowed = freeModels(env);
  // Every free (Workers AI) text model is offered; ASK_FREE_MODELS can narrow the list.
  const free = MODELS.filter(m => allowed.has(m.id) && m.id.startsWith("@cf/") && FREE_FORMATS.has(m.format));
  const claudeOk = !!adminId && isAdmin(env, adminId) && hasClaude(env);
  if (!claudeOk) return readers === true && claudeForReaders(env) ? [...readerClaudes(env), ...free] : free;
  // The admin's chosen frontier model is also the native linked-account default.
  const ids = [defaultModelId(env, adminId), env.CLAUDE_MODEL || CLAUDE_DEFAULT, env.CLAUDE_MODEL_LIGHT].filter((id): id is string => !!id).map((id) => modelOf(id).id);
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
  if (approved) return { ok: true, answer: approved.answer, sources: await withTeachers(env, approvedSources(approved)), ...citationMetadata(approved.answer, approvedSources(approved)), followups: approved.followups ?? [], model: "approved", provider: "CyberJudah", ms: Date.now() - t0 };
  // With no choice, a deep question (routeOf) goes to the stronger free model when one is configured
  // (ASK_FREE_DEEP_MODEL) and approved; everything else to the fast default.
  const deep = !options.model && env.ASK_FREE_DEEP_MODEL && routeOf(question, history) === "deep" ? appAskModels(env).find(m => m.id === env.ASK_FREE_DEEP_MODEL) : undefined;
  const model = deep ?? appAskModels(env).find(m => m.id === (options.model || freeModel(env).id));
  if (!model) return { ok: false, reason: "model-unavailable" };
  // Nothing is sent to a provider the reader has not agreed to, as in askStream.
  if (!consent.includes(model.provider)) return { ok: false, reason: "consent" };
  // The same first question, already answered this week by this model and mode: given at once (answer-cache.ts).
  const mode = options.study ? "study" : "app";
  const key = await cacheKey(question, history, model.id, `${mode}:coverage-${env.ASK_COVERAGE_MODE === "enforce" ? "enforce" : "shadow"}`, APP_STUDY_RELEASE.version);
  const kept = await cachedAnswer<SearchAnswer & { ok: true }>(env, key);
  if (kept?.ok) { await linkTrace(env, key, options.traceId); return { ...kept, ms: Date.now() - t0 }; }
  if (!(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, askLimit(env)))) return { ok: false, reason: "limit" };
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
  if (result.ok && result.sources.length && !isCoverageGap(result)) await keepAnswer(env, key, result, options.traceId);
  return result;
}

/** The free model a Claude answer falls back to: the default free model when the app offers it, else the first free one it offers. */
const freeFallback = (env: Env, models: AskModel[]) => (models.find((m) => m.id === freeModel(env).id) ?? models.find((m) => m.format !== "anthropic"))?.id ?? freeModel(env).id;

/**
 * The app's Ask, answered the way cyberjudah.io/app and Telegram answer (askStream): the model
 * researches in rounds with the same tools (the classes, the KJV with the Apocrypha, people,
 * dictionaries), streaming its steps, then writes a cited answer. Free models run on the shared
 * free budget; an admin's linked account answers with Claude (CLAUDE_MODEL by default), at no charge to
 * anyone but the owner's console, except on the Sabbath, feasts and New Moons (no paid calls from
 * sunset to dark), when the free model answers instead.
 */
export async function answerAppAgent(env: Env, q: string, account: string, history: Turn[] = [], consent: string[] = [], options: { model?: string; emit?: (event: AgentEvent) => void; traceId?: string; adminId?: number; quotaTaken?: boolean; signal?: AbortSignal } = {}): Promise<SearchAnswer> {
  const t0 = Date.now();
  const signal = researchSignal(options.signal, t0 + MAX_RESEARCH_MS);
  const question = q.trim();
  if (question.length > 4000) return { ok: false, reason: "too-long" };
  if (question.length < 2) return { ok: false, reason: "too-short" };
  const approved = approvedFor(question, history);
  if (approved) return { ok: true, answer: approved.answer, sources: await withTeachers(env, approvedSources(approved)), ...citationMetadata(approved.answer, approvedSources(approved)), followups: approved.followups ?? [], model: "approved", provider: "CyberJudah", ms: Date.now() - t0 };
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
  const key = await cacheKey(question, history, model.id, `agent:coverage-${env.ASK_COVERAGE_MODE === "enforce" ? "enforce" : "shadow"}`, APP_STUDY_RELEASE.version);
  const kept = await cachedAnswer<SearchAnswer & { ok: true }>(env, key);
  if (kept?.ok) { await linkTrace(env, key, options.traceId); return { ...kept, ms: Date.now() - t0 }; }
  let meter: Meter;
  if (model.format === "anthropic" && adminClaude) {
    // An admin's linked account: the admin meter holds nothing and charges no one.
    const started = await startMeter(env, options.adminId!, model, {});
    if (!started.ok) return { ok: false, reason: "unavailable" };
    meter = { ...started.meter, maxRounds: MAX_RESEARCH_ROUNDS };
  } else if (model.format === "anthropic") {
    // A signed-in reader on Claude (claudeForReaders): the reader's daily limit, then the answer's
    // most is reserved against Claude's own daily cap. Past the cap the free model answers.
    if (!options.quotaTaken && !(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, askLimit(env)))) return { ok: false, reason: "limit" };
    const budget = readerClaudeMaxUsd(env);
    let reservation: FreeReservation | null = null;
    try { reservation = budget > 0 ? await reserveFreeBudget(env, crypto.randomUUID(), budget, Date.now(), { prefix: "claude:", capUsd: readerClaudeCap(env), totalUsd: readerClaudeTotal(env) }) : null; }
    catch { return { ok: false, reason: "unavailable" }; }
    if (!reservation) {
      // The free model answers this same question: its quota is already counted, and only with the
      // reader's own agreement to the free model's provider (never assumed).
      return answerAppAgent(env, q, account, history, consent, { ...options, signal, model: freeFallback(env, models), adminId: undefined, quotaTaken: true });
    }
    meter = { owner: "", request: reservation.request, held: 0, spend: makeSpend({ budgetUsd: budget, rates: creditsConfig(env).research }), model, free: true, admin: false, reservation, maxRounds: MAX_RESEARCH_ROUNDS };
  } else {
    if (!options.quotaTaken && !(await takeQuotaKey(env, `ask_app:${account}:${new Date().toISOString().slice(0, 10)}`, askLimit(env)))) return { ok: false, reason: "limit" };
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
    // The first search runs before the model does: its steps are shown (the app's "Researched" row)
    // even when the model answers from these passages without searching again.
    const searchText = retrievalText(question, history);
    emit({ status: `Searching the classes and library for “${question.slice(0, 160)}”` });
    const [found, verses] = await withDeadline(Promise.all([retrieve(env, searchText, 12, spend, signal), versesNamed(env, question)]), timeLeft(t0 + MAX_RESEARCH_MS));
    const first = [...verses, ...answerCandidates(question, found, 8 - Math.min(verses.length, 2))];
    for (const passage of first) emit({ status: `Reading ${passage.title.slice(0, 180)}` });
    let ran: Awaited<ReturnType<typeof runAgent>>;
    try {
      ran = await runAgent(env, question, history, first, (t, k, readingSignal) => retrieve(env, t, k, spend, readingSignal ?? signal), emit, undefined, undefined, model, spend, undefined, meter.maxRounds, false, { signal, deadlineAt: t0 + MAX_RESEARCH_MS });
    } catch (e) {
      if (signal.aborted || model.format !== "anthropic" || !claudeUnavailable(e)) throw e;
      // Claude cannot answer now (out of money, overloaded, down): the free model answers instead.
      await alertClaudeFunds(env, e);
      await finishMeter(env, meter, "backup", Date.now() - t0);
      emit({ reset: true });
      // Only with the reader's own agreement to the free model's provider; a reader's quota is already counted.
      return answerAppAgent(env, q, account, history, consent, { ...options, signal, model: freeFallback(env, models), adminId: undefined, quotaTaken: !adminClaude });
    }
    const { answer, followups } = splitFollowups(ran.text.replace(/<think>[\s\S]*?<\/think>\s*/gi, ""));
    if (!answer.trim() && ran.cut && model.format === "anthropic" && !adminClaude) {
      // A reader's Claude answer ran out of what was set aside for it before writing: the free model
      // answers instead, with the reader's own agreement to its provider and no second quota.
      await finishMeter(env, meter, "backup", Date.now() - t0);
      emit({ reset: true });
      return answerAppAgent(env, q, account, history, consent, { ...options, signal, model: freeFallback(env, models), adminId: undefined, quotaTaken: true });
    }
    if (!answer.trim()) { await finishMeter(env, meter, "empty", Date.now() - t0); return { ok: false, reason: "empty" }; }
    await finishMeter(env, meter, ran.cut ? "partial" : ran.grounded === false ? "empty" : "ok", Date.now() - t0);
    const sources = sourcesOf(answer, ran.passages);
    const study = studyFields(ran.tracked, ran.plan, ran.coverage, sources.map(s => s.n), answer);
    const result: SearchAnswer = { ok: true, answer, sources, ...citationMetadata(answer, ran.passages), followups, model: model.id, provider: model.provider, ...(ran.cut ? { cut: true } : {}), ...study, ms: Date.now() - t0 };
    // An answer cut off at its length limit is shown as written, but never kept as a finished answer.
    // An answer that used the reader's own data (agent.ts readerData) is never kept for other readers.
    if (result.ok && result.sources.length && !ran.cut && study.partial !== true && ran.grounded !== false && !ran.readerData) await keepAnswer(env, key, result, options.traceId);
    return result;
  } catch (e) {
    await finishMeter(env, meter, "failed", Date.now() - t0).catch(() => null);
    console.error(JSON.stringify({ event: "app_agent_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 160) }));
    return { ok: false, reason: "unavailable", detail: `failed: ${(e as Error).message?.slice(0, 160) ?? ""}` };
  }
}

/**
 * One library-grounded answer under a free meter. Search may retry a citation-less draft once;
 * the app's existing plain/study paths keep their own behavior.
 */
async function boundedAnswer(env: Env, model: AskModel, meter: Meter, question: string, searchText: string, history: Turn[], deadlineMs: number, t0: number, emit?: (event: AppStudyEvent) => void, appMode?: "app" | "study", traceId?: string, requireSearchCitations = false): Promise<SearchAnswer> {
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
      return { ok: true, ...result, ...citationMetadata(result.answer, result.sources), model: model.id, provider: model.provider, ms: Date.now() - t0 };
    }
    // Nothing found: a greeting or a thank-you is still answered, in a sentence; a real question is
    // told so plainly, with no model call, rather than answered from the model's own memory.
    const coverage = assessCoverage(env, searchText, passages);
    if ((!passages.length || coverage.blocked) && !SMALL_TALK.test(question)) {
      await finishMeter(env, meter, "empty", Date.now() - t0);
      if (requireSearchCitations) return noCitedSearchAnswer(model, passages, "", 0, t0, true);
      const none = notInTheClasses(passages.filter(source => !hasControlText(`${source.title}\n${source.text}`)));
      return markCoverageGap({ ok: true as const, answer: none.answer, sources: none.sources, unsupported_refs: [], followups: [], model: model.id, provider: model.provider, ms: Date.now() - t0 });
    }
    // Use the plain adapter even for chat models: one bounded answer, never a research loop.
    const prompt = buildPrompt(question, passages, history, { plain: true });
    const system = prompt.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const messages = prompt.filter((m): m is { role: "user" | "assistant"; content: string } => m.role !== "system");
    const tModel = Date.now();
    const write = async (retry = false) => {
      const left = deadlineAt - Date.now();
      if (left <= 0) throw new DeadlineError(deadlineMs);
      // Retry the same fenced evidence, never the uncited draft or any new model-supplied instructions.
      const instruction = retry
        ? "Write a fresh answer using only the supplied library passages. Cite each supported claim using its source_n as [n], for example [1]. Use only IDs in that registry. If the passages do not answer the question, say so; do not guess."
        : undefined;
      return withDeadline(researchOpen(env, { ...model, format: "plain" }, system, messages,
        [], new Map(), async () => ({ content: "No tools are available." }), emit ?? (() => undefined), 1, spend, !!emit, instruction), left);
    };
    const clean = async (text: string) => {
      const { answer, followups } = splitFollowups(text.replace(/<think>[\s\S]*?<\/think>\s*/gi, ""));
      return { answer: await checkedVerses(env, answer), followups };
    };
    let { answer, followups } = await clean((await write()).text);
    let retries = 0;
    const needsCitations = requireSearchCitations && !SMALL_TALK.test(question);
    if (needsCitations && !sourcesOf(answer, passages).length && !spend.unreported && Date.now() < deadlineAt) {
      try {
        const ran = await write(true);
        retries = 1;
        ({ answer, followups } = await clean(ran.text));
      } catch (e) {
        // Insufficient remaining reservation is an honest uncited result; transport failures
        // remain unavailable (503), so release checks never mistake an outage for grounding.
        if (!(e instanceof ModelBudgetError)) throw e;
      }
    }
    // Where the time goes, for tuning: finding the passages, and the model writing the answer.
    console.log(JSON.stringify({ event: "search_answer_timing", retrieveMs, modelMs: Date.now() - tModel, totalMs: Date.now() - t0 }));
    if (needsCitations && !sourcesOf(answer, passages).length) {
      await finishMeter(env, meter, "empty", Date.now() - t0);
      return noCitedSearchAnswer(model, passages, answer, retries, t0);
    }
    if (!answer.trim()) { await finishMeter(env, meter, "empty", Date.now() - t0); return { ok: false, reason: "empty" }; }
    await finishMeter(env, meter, "ok", Date.now() - t0);
    const sources = sourcesOf(answer, passages);
    return { ok: true, answer, sources, ...citationMetadata(answer, passages), followups, model: model.id, provider: model.provider, ms: Date.now() - t0,
      ...(requireSearchCitations ? { citation_diagnostics: searchCitationDiagnostics(model, answer, sources.length, retries) } : {}) };
  } catch (e) {
    await finishMeter(env, meter, "failed", Date.now() - t0).catch(() => null);
    console.error(JSON.stringify({ event: e instanceof DeadlineError ? "search_answer_timeout" : "search_answer_failed", elapsedMs: Date.now() - t0, retrieveMs, message: (e as Error).message?.slice(0, 160) }));
    // The same bounded message, for the monitoring record (ask-events.ts).
    return { ok: false, reason: "unavailable", detail: `${e instanceof DeadlineError ? "timeout" : "failed"}: ${(e as Error).message?.slice(0, 160) ?? ""}` };
  }
}

const searchCitationDiagnostics = (model: AskModel, draft: string, sourceCount: number, retries: number): CitationDiagnostics => ({
  sources_returned: sourceCount, citation_tokens_found: citationTokenCount(draft), valid_ids: sourceCount, retries, model: model.id,
});
function noCitedSearchAnswer(model: AskModel, passages: Passage[], draft: string, retries: number, t0: number, gap = false): SearchAnswer {
  return { ok: true, state: "no-cited-answer", answer: gap ? "I could not find material answering this directly." : "I could not produce a cited answer from the library material I found.",
    sources: [], unsupported_refs: [], followups: [], related: { label: "Related library passages", passages: passages.filter(source => !hasControlText(`${source.title}\n${source.text}`)).map(source => { const { n: _n, ...record } = source as Passage & { n?: number }; return record; }) },
    citation_diagnostics: searchCitationDiagnostics(model, draft, 0, retries), model: model.id, provider: model.provider, ms: Date.now() - t0 };
}

type Msg = { role: "system" | "user" | "assistant"; content: string };
const CLAUDE_DEFAULT = "claude-sonnet-5-5";
/**
 * The model an answer uses when the reader has not chosen one: an admin's (CLAUDE_MODEL_ADMIN,
 * Claude Opus 5.5 when unset) or every other reader's (CLAUDE_MODEL, Claude Sonnet when unset).
 */
export const defaultModelId = (env: Env, userId: number) => (isAdmin(env, userId) ? env.CLAUDE_MODEL_ADMIN || "claude-opus-5-5" : env.CLAUDE_MODEL || CLAUDE_DEFAULT);

/** Legacy/provider-outage answers use a separately budgeted Workers AI backup. */
async function answerOnce(env: Env, messages: Msg[], admin = false, sources: Passage[] = [], signal?: AbortSignal): Promise<string> {
  return backupOnce(env, messages, admin, sources, signal);
}

async function* answerPieces(env: Env, messages: Msg[], admin = false, sources: Passage[] = [], signal?: AbortSignal, wrote: { model?: string } = {}): AsyncGenerator<string> {
  yield* backupPieces(env, messages, admin, sources, signal, wrote);
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

const citationStateOf = (answer: string, passages: Passage[]) => citationReport(answer, passages.map((source, index) => (source as Passage & { n?: number }).n ?? index + 1));
const sourcesOf = (answer: string, passages: Passage[]) => {
  const registry = new Map(passages.map((source, index) => [(source as Passage & { n?: number }).n ?? index + 1, source]));
  return citationStateOf(answer, passages).supported.map(n => ({ ...registry.get(n)!, n }));
};
const citationMetadata = (answer: string, passages: Passage[]) => ({ unsupported_refs: citationStateOf(answer, passages).unsupported_refs });

// Telegram clients can show credited source text without opening an outside site.
const askSourcesOf = async (env: Env, answer: string, passages: Passage[]) => withAskSourcePictures(env, withAskBookLinks((await withTeachers(env, sourcesOf(answer, passages)))
  .map(source => ({ ...source, excerpt: source.text.slice(0, 1000) }))));

/**
 * The same, streamed: one JSON line with the passages first, then a line per piece of the
 * answer as the model writes it, then a line with the sources it cited.
 */
export async function askStream(env: Env, q: string, userId: number, ctx: Exec | undefined, history: Turn[], chatId?: string, replaceLast = false, modelId?: string, consent: string[] = [], opts: MeterOpts = {}): Promise<Response> {
  const startedAt = Date.now();
  const abort = new AbortController();
  const signal = researchSignal(AbortSignal.any([abort.signal, ...(opts.signal ? [opts.signal] : [])]), startedAt + MAX_RESEARCH_MS);
  const question = q.trim();
  if (question.length > 4000) return Response.json({ error: "too-long", message: "Keep the question within 4,000 characters; use the library reading tools for full source material." }, { status: 400 });
  // The reader's choice of model, or their configured account default. With no choice, a light
  // question (routeOf) goes to the lighter Claude model when one is configured (CLAUDE_MODEL_LIGHT):
  // it is answered faster and costs the reader less. Admins keep their own default.
  const light = !modelId && !isAdmin(env, userId) && env.CLAUDE_MODEL_LIGHT && routeOf(question, history) === "light";
  const selected = modelOf(modelId || (light ? env.CLAUDE_MODEL_LIGHT : undefined), defaultModelId(env, userId));
  // Lines with sources or passages carry bounded previews (ask-frame.ts): the full text stays behind
  // each source's own page, and a long answer's final line stays under the Mini App's 256 KiB limit.
  const line = (o: unknown) => `${JSON.stringify(hasSourceList(o) ? boundedFrame(o as object) : o)}\n`;
  const reply = (status: number, o: unknown) => new Response(line(o), { status, headers: { "content-type": "application/x-ndjson" } });
  if (question.length < 2) return reply(400, { error: "too-short" });
  // An answer the owner approved for this very question: sent at once, with no provider and no charge.
  const approved = approvedFor(question, history);
  if (approved) return new Response(line({ delta: approved.answer }) + line({ done: true, answer: approved.answer, followups: approved.followups ?? [], sources: await withAskSourcePictures(env, withAskBookLinks(await withTeachers(env, approvedSources(approved)))), answer_id: await issueAnswerReceipt(env, userId, approvedSources(approved)), ...citationMetadata(approved.answer, approvedSources(approved)), approved: true }), { headers: { "content-type": "application/x-ndjson" } });
  const model = modelId === "auto" ? await autoModel(env, question, Math.floor(history.length / 2), userId, selected, freeModels(env), isAdmin(env, userId)) : selected;
  // Nothing is sent to an AI provider the reader has not agreed to (Apple 5.1.2(i); Telegram Bot
  // Developer Terms 4.3, Standard Bot Privacy Policy 6.2): the app asks, then sends again.
  // Where the provider is based goes with it, when known, for the agreement card.
  if (!consent.includes(model.provider)) return reply(428, { error: "consent", provider: model.provider, model: model.name, ...(countryOf(model.provider) ? { country: countryOf(model.provider) } : {}) });
  // The balance: held before anything is spent, settled once at the end with what the answer
  // actually cost (finishMeter). A disconnect stops further research; accounting still
  // settles once under waitUntil. Too little for this model: Ask says so and offers the free model and a top-up.
  // A routed light answer may cost up to what the reader accepted for their default model, which is dearer.
  const fallbackCap = light ? opts.caps?.[modelOf(undefined, defaultModelId(env, userId)).id] : undefined;
  const started = await begin(env, userId, model, fallbackCap && !opts.caps?.[model.id] ? { ...opts, caps: { ...opts.caps, [model.id]: fallbackCap } } : opts);
  if (!started.ok) return reply(started.status, started.body);
  const meter = started.meter;
  const spend = meter?.spend ?? freeSpend();
  const encoder = new TextEncoder();
  // The reader can leave at any moment (Stop, another screen, the app closed). From then on
  // the shared signal stops provider work and further tools. Accounting still completes under
  // waitUntil, so already incurred costs are recorded and a failed answer is not charged.
  let open = true, deliveredText = false, backupAnswer = false;
  let settled = false;
  const finish = async (status: Parameters<typeof finishMeter>[2], chargePartial = false) => {
    if (settled || !meter) return null;
    settled = true;
    return finishMeter(env, meter, status, undefined, chargePartial);
  };
  // While it is being answered, the conversation says so, for a refresh or another device to wait on.
  if (chatId) await markPending(env, userId, chatId, question).catch(() => undefined);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => { if (!open) return; try { controller.enqueue(encoder.encode(line(o))); if (o && typeof o === "object" && "reset" in o && o.reset === true) deliveredText = false; if (o && typeof o === "object" && "delta" in o && typeof o.delta === "string" && o.delta.trim() && opts.clientStreaming !== false) deliveredText = true; } catch { open = false; } };
      const done = async (value: { sources: { n?: number }[]; [key: string]: unknown }) => send({ ...value, answer_id: await issueAnswerReceipt(env, userId, value.sources) });
      // A line every 15 seconds while the research runs, so the app can tell a slow answer from a dead connection.
      const beat = setInterval(() => send({ ping: 1 }), 15000);
      // The finished exchange is saved to the person's conversations, even if they left mid-answer.
      const keep = async (content: string, sources: unknown[], followups: string[], steps: string[] = [], actions: SavedAction[] = [], cut = false, study: StudyFields = {}) => {
        if (!chatId) return;
        await saveExchange(env, userId, chatId, question, { content, sources: sources as never, followups, steps, actions, cut, ...study }, replaceLast).catch((e: Error) => console.error(JSON.stringify({ event: "chat_save_failed", message: e.message?.slice(0, 120) })));
      };
      const job = (async () => {
        try {
          const first = answerCandidates(question, await withDeadline(retrieve(env, retrievalText(question, history), 12, spend, signal), timeLeft(startedAt + MAX_RESEARCH_MS)), 8);
    signal.throwIfAborted();
          let backup = false;
          // Claude needs its own access (hasClaude); every other model goes through the AI Gateway.
          if (model.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY) {
            // Claude researches first (searches and verses, reported as it goes), then writes.
            const steps: string[] = [];
            let ran: Awaited<ReturnType<typeof runAgent>> | null = null;
            try { ran = await runAgent(env, question, history, first, (t, k, readingSignal) => retrieve(env, t, k, spend, readingSignal ?? signal), (e: AgentEvent) => { if ("status" in e && /^(Searching|Reading|Looking)/.test(e.status)) steps.push(e.status); send(e); }, ctx, userId, model, spend, opts.resources, meter?.maxRounds, true, { signal, deadlineAt: startedAt + MAX_RESEARCH_MS }); }
            catch (e) {
              // Claude cannot answer now (overloaded, rate limited, down, or its key refused): the
              // backup model answers from the passages already found, and the reader is not charged.
              if (signal.aborted || !claudeUnavailable(e)) throw e;
              console.error(JSON.stringify({ event: "ask_claude_unavailable", status: (e as { status?: number }).status ?? 0, backup: "workers-ai" }));
              await alertClaudeFunds(env, e);
              backup = true;
              // Decided before the meter settles: without the reader's agreement to the backup's
              // provider no backup answer is written, so the free reservation is released ("empty").
              if (!mayUseBackup(consent)) { await finish("empty"); send({ reset: true }); send({ error: "busy" }); return; }
              await finish("backup");
              send({ reset: true });
              send({ status: "Answering with the backup model" });
            }
            if (ran) {
              const { text, passages, actions, cut, refused, grounded } = ran;
              const { answer, followups } = splitFollowups(text);
              // Claude declined the question (stop_reason "refusal"): said so, never shown as an answer, not charged.
              if (refused && !answer.trim()) { await finish("refused"); send({ error: "refused" }); return; }
              if (!answer.trim()) { await finish("empty"); send({ error: "empty" }); return; }
              const used = await finish(cut ? "partial" : grounded === false ? "empty" : "ok");
              const sources = await askSourcesOf(env, answer, passages);
              // Saved first: whatever happens to the connection after this, the answer is kept.
              // Each part lists only sources the answer cites (the numbers its own sources carry).
              const study = studyFields(ran.tracked, ran.plan, ran.coverage, sources.map((s) => s.n), answer);
              await keep(answer, sources, followups, steps, actions, cut, study);
              // The model that wrote an answer is named on its finished line, so an Auto answer can show it;
              // the fixed sentences below, written by no model, name none.
              await done({ done: true, answer, followups, sources, ...citationMetadata(answer, passages), actions, model: model.id, ...(cut ? { cut: true } : {}), ...study });
              // What the answer cost, and the balance after it; the free model and admins pay nothing.
              if (used) send({ usage: { charged_mc: used.charged_mc, balance: used.balance } });
              else if (meter?.free && creditsOn(env)) send({ usage: { charged_mc: 0, free: true } });
              return;
            }
          }
          backupAnswer = true;
          const passages = first;
          send({ passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
          // The backup cannot research: with nothing found to answer from, it says Claude is busy
          // rather than that the library has nothing (which only the research could tell).
          if (!passages.length && backup) { send({ error: "busy" }); return; }
          if (!passages.length) {
            const answer = "The search did not find enough reliable material in the library to answer that question.";
            await finish("empty");
            await keep(answer, [], []);
            send({ delta: answer }); await done({ done: true, answer, followups: [], sources: [], unsupported_refs: [] }); return;
          }
          if (assessCoverage(env, retrievalText(question, history), passages).blocked) {
            const gap = notInTheClasses(passages.filter(source => !hasControlText(`${source.title}\n${source.text}`)));
            const sources = await askSourcesOf(env, gap.answer, gap.sources);
            await finish("empty"); await keep(gap.answer, sources, []);
            send({ reset: true }); send({ delta: gap.answer }); await done({ done: true, answer: gap.answer, followups: [], sources, unsupported_refs: [] }); return;
          }
          // The backup sends the question to its own provider: only with the reader's agreement to it.
          // Without it nothing is sent, and the reader is told honestly that no answer could be written.
          if (!mayUseBackup(consent)) { await finish("empty"); send({ error: backup ? "busy" : "unavailable" }); return; }
          let answer = "";
          const wrote: { model?: string } = {};
          for await (const piece of answerPieces(env, buildPrompt(question, passages, history), isAdmin(env, userId), passages, signal, wrote)) { answer += piece; send({ delta: piece }); }
          const { answer: clean, followups } = splitFollowups(answer);
          if (!clean.trim()) { send({ error: "empty" }); return; }
          const sources = await askSourcesOf(env, clean, passages);
          await keep(clean, sources, followups);
          // The backup (or a setup without the model's access) wrote this from the passages: not charged.
          await finish("backup");
          await done({ done: true, answer: clean, followups, sources, ...citationMetadata(clean, passages), ...(wrote.model ? { model: wrote.model } : {}), ...(backup ? { backup: true } : {}) });
        } catch (e) {
          // An answer that failed is not charged: the hold goes back.
          const paidPartial = signal.aborted && deliveredText && !backupAnswer;
          await finish(paidPartial ? "partial" : "failed", paidPartial);
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
    cancel() { open = false; abort.abort(); },
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
