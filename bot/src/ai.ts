import { chapter } from "./data";
import { runSearch } from "./search";
import type { Env, Exec } from "./env";
import { ANSWER_MODEL, answerCandidates, buildPrompt, citations, dedupeMatches, EMBED_MODEL, RERANK_MODEL, splitFollowups, VOICE_MODEL, VOICES, type Passage, type Turn } from "./ai.mjs";
import { runAgent, type AgentEvent } from "./agent";
import { claude, claudeUnavailable, hasClaude, viaGateway } from "./providers";
import { modelOf, type AskModel } from "../../shared/ask-models.mjs";
import { pid } from "./privacy.mjs";
import { clearPending, markPending, saveExchange, type SavedAction } from "./chats";
import { isAdmin } from "./edit";
import { billingOn, charge, reserveAsk, settleAsk, standing, type Take } from "./billing";
import type { Account } from "./billing.mjs";

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
export async function retrieve(env: Env, text: string, topK = 12): Promise<(Passage & { score: number })[]> {
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
  return rerank(env, text, all, topK);
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

/** The question with its conversation: a short follow-up borrows the words of the turn before it. */
const retrievalText = (question: string, history: Turn[]) => {
  const prev = [...history].reverse().find((t) => t.role === "user")?.content ?? "";
  return question.split(/\s+/).length < 6 && prev ? `${prev} ${question}` : question;
};

/** A verse's reading voice: fifty new generations a day per person; the cache is free. */
const TTS_LIMIT = 50;

/**
 * A per-person daily quota, counted atomically inside D1: the increment is one UPSERT, so
 * concurrent requests cannot each read the same count and all slip under the cap the way a
 * KV read-modify-write can. One table for every capped thing; rows from earlier days are
 * swept on the way through.
 */
export async function takeQuota(env: Env, name: string, userId: number, limit: number): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  // Counted under the person's pseudonymous ID, and swept the next day.
  const key = `${name}:${await pid(env, userId)}:${day}`;
  const res = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("INSERT INTO rate_counts (key, n) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET n = n + 1 RETURNING n").bind(key),
    env.DB.prepare("DELETE FROM rate_counts WHERE key NOT LIKE ?").bind(`%:${day}`),
  ]);
  const n = Number((res[1].results?.[0] as { n?: unknown } | undefined)?.n ?? limit + 1);
  return n <= limit;
}

/** A hundred answers a day per person. */
async function allowed(env: Env, userId: number): Promise<boolean> {
  return takeQuota(env, "ask", userId, ASK_LIMIT);
}

/**
 * The free model: never charged, open to every reader, and the one Ask goes on with once the paid
 * answers are used up. ASK_FREE_MODEL names it; by default the strongest low-cost model in
 * Cloudflare's catalog that researches with tools (GLM 5.3 Flash, Workers AI).
 */
export const freeModel = (env: Env) => modelOf(env.ASK_FREE_MODEL || "@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-5.3-flash");

/** Free answers: ASK_BASIC_DAILY a day per person (25 unless set). */
async function basicAllowed(env: Env, userId: number): Promise<boolean> {
  const n = Number(env.ASK_BASIC_DAILY);
  return takeQuota(env, "ask-basic", userId, Number.isInteger(n) && n >= 0 ? n : 25);
}

/** A question answered in one piece (the bot and older clients); a hundred a day per person. */
export async function ask(env: Env, q: string, userId: number, ctx?: Exec, history: Turn[] = [], consent: string[] = []): Promise<Answer> {
  const t0 = Date.now();
  const question = q.trim().slice(0, 400);
  if (question.length < 2) return { ok: false, reason: "too-short" };
  // The one-piece answer uses the setup's own model: agreed to, as in askStream.
  if (hasClaude(env) && !consent.includes(modelOf(env.CLAUDE_MODEL || CLAUDE_DEFAULT).provider)) return { ok: false, reason: "consent" };
  // A metered answer reserves its minimum up front, so questions sent at once cannot spend more
  // than is left, and settles the exact units at the end (nothing, if it failed on our side).
  const metered = billingOn(env) && hasClaude(env);
  let take: Take | null = null;
  if (metered && !isAdmin(env, userId)) {
    const r = await reserveAsk(env, userId);
    if (!r.ok) return { ok: false, reason: "allowance" };
    take = r.take;
  } else if (billingOn(env) ? !(await standing(env, userId)).ok : !(await allowed(env, userId))) {
    return { ok: false, reason: billingOn(env) ? "allowance" : "limit" };
  }
  try {
    const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12), 8);
    if (hasClaude(env)) {
      const { text, passages, units } = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k), () => undefined, ctx);
      if (metered && take) await settleAsk(env, userId, take, units);
      else await charge(env, userId, units);
      const { answer } = splitFollowups(text);
      return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
    }
    const passages = first;
    if (!passages.length) return { ok: true, q: question, answer: "The search did not find enough reliable material in the library to answer that question.", sources: [], ms: Date.now() - t0 };
    const { answer } = splitFollowups(await answerOnce(env, buildPrompt(question, passages, history)));
    return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
  } catch (e) {
    // An answer that failed on our side is not charged: the reservation goes back.
    if (metered && take) await settleAsk(env, userId, take, 0).catch(() => null);
    console.error(JSON.stringify({ event: "ask_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
}

type Msg = { role: "system" | "user" | "assistant"; content: string };
const CLAUDE_DEFAULT = "claude-opus-5";

/** The answer, whole: Claude when it can be called (hasClaude), Llama on Workers AI otherwise, or when Claude cannot answer now. */
async function answerOnce(env: Env, messages: Msg[]): Promise<string> {
  if (hasClaude(env)) {
    try { return await claudeOnce(env, messages); }
    catch (e) {
      if (!claudeUnavailable(e)) throw e;
      console.error(JSON.stringify({ event: "ask_claude_unavailable", status: (e as { status?: number }).status ?? 0, backup: "workers-ai" }));
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

const sourcesOf = (answer: string, passages: Passage[]) => {
  const used = citations(answer, passages.length);
  return (used.length ? used : passages.slice(0, 4).map((_, i) => i + 1)).map((n) => ({ ...passages[n - 1], n }));
};

/**
 * The same, streamed: one JSON line with the passages first, then a line per piece of the
 * answer as the model writes it, then a line with the sources it cited.
 */
export async function askStream(env: Env, q: string, userId: number, ctx: Exec | undefined, history: Turn[], chatId?: string, replaceLast = false, modelId?: string, consent: string[] = []): Promise<Response> {
  // The reader's choice of model, or the setup's own (CLAUDE_MODEL) when none or an unknown one is sent.
  let model = modelOf(modelId, env.CLAUDE_MODEL || CLAUDE_DEFAULT);
  // The free model (ASK_FREE_MODEL) is never charged: chosen, or once the allowance is used up.
  const free = freeModel(env);
  let gratis = model.id === free.id;
  const question = q.trim().slice(0, 400);
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;
  if (question.length < 2) return new Response(line({ error: "too-short" }), { status: 400, headers: { "content-type": "application/x-ndjson" } });
  // A metered answer reserves its minimum up front and settles the exact units at the end (see ask).
  // Leaving mid-answer does not cancel it (waitUntil), so it is still settled once.
  // Nothing is sent to an AI provider the reader has not agreed to (Apple 5.1.2(i); Telegram Bot
  // Developer Terms 4.3, Standard Bot Privacy Policy 6.2): the app asks, then sends again.
  const needsConsent = (m: AskModel) => !consent.includes(m.provider) && new Response(line({ error: "consent", provider: m.provider, model: m.name }), { status: 428, headers: { "content-type": "application/x-ndjson" } });
  const refused0 = needsConsent(model);
  if (refused0) return refused0;
  const metered = billingOn(env) && hasClaude(env);
  let take: Take | null = null;
  // With the paid answers used up, Ask does not stop: it goes on with the free model, which
  // researches with the same tools and is not charged, as the large AI apps fall back to a
  // lighter model at their limit, up to ASK_BASIC_DAILY a day; then the plans are offered.
  let limited = false;
  if (metered && !isAdmin(env, userId)) {
    const r = gratis ? null : await reserveAsk(env, userId);
    if (r?.ok) take = r.take;
    else if (await basicAllowed(env, userId)) {
      // The free model may be another provider: agreed to as well, or asked for first (nothing was reserved).
      const refused1 = needsConsent(free);
      if (refused1) return refused1;
      limited = !gratis; model = free; gratis = true;
    }
    else return new Response(line({ error: "allowance", ...(r ? { balance: r.balance } : {}) }), { status: 402, headers: { "content-type": "application/x-ndjson" } });
  } else if (billingOn(env)) {
    const st = await standing(env, userId);
    if (!st.ok) return new Response(line({ error: "allowance", balance: st.balance }), { status: 402, headers: { "content-type": "application/x-ndjson" } });
  } else if (!(await allowed(env, userId))) {
    return new Response(line({ error: "limit" }), { status: 429, headers: { "content-type": "application/x-ndjson" } });
  }
  const encoder = new TextEncoder();
  // The reader can leave at any moment (Stop, another screen, the app closed). From then on
  // nothing more is sent, but the answer is still finished, saved and charged exactly once:
  // the work runs under waitUntil, not inside the response, so leaving does not cancel it.
  let open = true;
  let settled = false;
  const settle = async (units: number) => {
    if (settled) return null;
    settled = true;
    return metered && take ? await settleAsk(env, userId, take, units).catch(() => null) : await charge(env, userId, units).catch(() => null);
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
          const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12), 8);
          let backup = limited;
          // Claude needs its own access (hasClaude); every other model goes through the AI Gateway.
          if (model.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY) {
            // Claude researches first (searches and verses, reported as it goes), then writes.
            const steps: string[] = [];
            let ran: Awaited<ReturnType<typeof runAgent>> | null = null;
            try { ran = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k), (e: AgentEvent) => { if ("status" in e && /^(Searching|Reading|Looking)/.test(e.status)) steps.push(e.status); send(e); }, ctx, userId, model); }
            catch (e) {
              // Claude cannot answer now (overloaded, rate limited, down, or its key refused): the
              // backup model answers from the passages already found, and the reader is not charged.
              if (!claudeUnavailable(e)) throw e;
              console.error(JSON.stringify({ event: "ask_claude_unavailable", status: (e as { status?: number }).status ?? 0, backup: "workers-ai" }));
              await settle(0);
              send({ reset: true });
              send({ status: "Answering with the backup model" });
              backup = true;
            }
            if (ran) {
              const { text, passages, units, calls, actions, cut, refused } = ran;
              const { answer, followups } = splitFollowups(text);
              const left = await settle(gratis ? 0 : units);
              console.log(JSON.stringify({ event: "ask_usage", units, calls, searches: steps.length, actions: actions.length, cut }));
              // Claude declined the question (stop_reason "refusal"): said so, never shown as an answer.
              if (refused && !answer.trim()) { send({ error: "refused" }); return; }
              if (!answer.trim()) { send({ error: "empty" }); return; }
              const sources = sourcesOf(answer, passages);
              // Saved first: whatever happens to the connection after this, the answer is kept.
              await keep(answer, sources, followups, steps, actions, cut);
              send({ done: true, answer, followups, sources, actions, ...(cut ? { cut: true } : {}), ...(limited ? { limited: true } : {}) });
              if (left && billingOn(env)) send({ usage: { units, balance: left } });
              return;
            }
          }
          const passages = first;
          send({ passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
          // The backup cannot research: with nothing found to answer from, it says Claude is busy
          // rather than that the library has nothing (which only the research could tell).
          if (!passages.length && limited) { send({ error: "allowance" }); return; }
          if (!passages.length && backup) { send({ error: "busy" }); return; }
          if (!passages.length) {
            const answer = "The search did not find enough reliable material in the library to answer that question.";
            await keep(answer, [], []);
            send({ delta: answer }); send({ done: true, answer, followups: [], sources: [] }); return;
          }
          let answer = "";
          for await (const piece of answerPieces(env, buildPrompt(question, passages, history), backup)) { answer += piece; send({ delta: piece }); }
          const { answer: clean, followups } = splitFollowups(answer);
          if (!clean.trim()) { send({ error: "empty" }); return; }
          const sources = sourcesOf(clean, passages);
          await keep(clean, sources, followups);
          send({ done: true, answer: clean, followups, sources, ...(limited ? { limited: true } : backup ? { backup: true } : {}) });
        } catch (e) {
          // An answer that failed on our side is not charged: the reservation goes back.
          await settle(0);
          console.error(JSON.stringify({ event: "ask_stream_failed", message: (e as Error).message?.slice(0, 200) }));
          send({ error: "unavailable" });
        } finally {
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

const isVoice = (v: string) => VOICES.some((x) => x.id === v);
const toBytes = async (out: unknown): Promise<Uint8Array | null> => {
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
