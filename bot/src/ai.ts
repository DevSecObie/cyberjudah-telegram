import Anthropic from "@anthropic-ai/sdk";

import { chapter } from "./data";
import { runSearch } from "./search";
import type { Env, Exec } from "./env";
import { ANSWER_MODEL, answerCandidates, buildPrompt, citations, dedupeMatches, EMBED_MODEL, RERANK_MODEL, splitFollowups, VOICE_MODEL, VOICES, type Passage, type Turn } from "./ai.mjs";
import { runAgent, type AgentEvent } from "./agent";
import { saveExchange } from "./chats";
import { billingOn, charge, standing } from "./billing";

/**
 * The AI features, all through Workers AI and the Vectorize index of the teachings:
 * embeddings (bge-m3), retrieval of the closest passages, an answer grounded in them with
 * citations (llama 3.3 70b), search by meaning, and the reading voices (Deepgram Aura),
 * each verse generated once and kept in R2.
 */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 100) }) as { data?: number[][] };
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
    embed(env, [text]).then(([vector]) => (vector ? env.VEC.query(vector, { topK: 20, returnMetadata: "all" }) : { matches: [] as VectorizeMatches["matches"] })),
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
    const res = await (env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> }).run(RERANK_MODEL, input) as { response?: { id?: number; score?: number }[] };
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

async function allowed(env: Env, userId: number, ctx?: Exec): Promise<boolean> {
  const key = `ask:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await env.SUBS.get(key)) ?? 0);
  if (used >= ASK_LIMIT) return false;
  const put = env.SUBS.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  if (ctx) ctx.waitUntil(put); else await put;
  return true;
}

/** A question answered in one piece (the bot and older clients); a hundred a day per person. */
export async function ask(env: Env, q: string, userId: number, ctx?: Exec, history: Turn[] = []): Promise<Answer> {
  const t0 = Date.now();
  const question = q.trim().slice(0, 400);
  if (question.length < 2) return { ok: false, reason: "too-short" };
  if (billingOn(env) ? !(await standing(env, userId)).ok : !(await allowed(env, userId, ctx))) return { ok: false, reason: billingOn(env) ? "allowance" : "limit" };
  try {
    const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12), 8);
    if (env.ANTHROPIC_API_KEY) {
      const { text, passages, units } = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k), () => undefined, ctx);
      await charge(env, userId, units);
      const { answer } = splitFollowups(text);
      return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
    }
    const passages = first;
    if (!passages.length) return { ok: true, q: question, answer: "The search did not find enough reliable material in the library to answer that question.", sources: [], ms: Date.now() - t0 };
    const { answer } = splitFollowups(await answerOnce(env, buildPrompt(question, passages, history)));
    return { ok: true, q: question, answer, sources: sourcesOf(answer, passages), ms: Date.now() - t0 };
  } catch (e) {
    console.error(JSON.stringify({ event: "ask_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
}

type Msg = { role: "system" | "user" | "assistant"; content: string };
const CLAUDE_DEFAULT = "claude-opus-5";

/** The answer, whole: Claude when the key is set, Llama on Workers AI otherwise. */
async function answerOnce(env: Env, messages: Msg[]): Promise<string> {
  if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({ model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"), messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
    return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  }
  const res = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: 900, temperature: 0.3 }) as { response?: string };
  return (res.response ?? "").trim();
}

/** The answer as it is written, piece by piece. */
async function* answerPieces(env: Env, messages: Msg[]): AsyncGenerator<string> {
  if (env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const stream = client.messages.stream({ model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "medium" }, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n"), messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })) });
    for await (const event of stream) if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    return;
  }
  const out = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: 900, temperature: 0.3, stream: true }) as ReadableStream<Uint8Array>;
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
export async function askStream(env: Env, q: string, userId: number, ctx: Exec | undefined, history: Turn[], chatId?: string): Promise<Response> {
  const question = q.trim().slice(0, 400);
  const line = (o: unknown) => `${JSON.stringify(o)}\n`;
  if (question.length < 2) return new Response(line({ error: "too-short" }), { status: 400, headers: { "content-type": "application/x-ndjson" } });
  // With Claude, each answer is charged to the person's allowance; without it, the old daily cap.
  if (billingOn(env)) {
    const st = await standing(env, userId);
    if (!st.ok) return new Response(line({ error: "allowance", balance: st.balance }), { status: 402, headers: { "content-type": "application/x-ndjson" } });
  } else if (!(await allowed(env, userId, ctx))) return new Response(line({ error: "limit" }), { status: 429, headers: { "content-type": "application/x-ndjson" } });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(line(o)));
      // The finished exchange is saved to the person's conversations, even if they left mid-answer.
      const keep = (content: string, sources: unknown[], followups: string[], steps: string[] = []) => {
        if (!chatId) return;
        const save = saveExchange(env, userId, chatId, question, { content, sources: sources as never, followups, steps }).catch((e: Error) => console.error(JSON.stringify({ event: "chat_save_failed", message: e.message?.slice(0, 120) })));
        if (ctx) ctx.waitUntil(save);
      };
      try {
        const first = answerCandidates(question, await retrieve(env, retrievalText(question, history), 12), 8);
        if (env.ANTHROPIC_API_KEY) {
          // Claude researches first (searches and verses, reported as it goes), then writes.
          const steps: string[] = [];
          const { text, passages, units, calls } = await runAgent(env, question, history, first, (t, k) => retrieve(env, t, k), (e: AgentEvent) => { if ("status" in e && /^(Searching|Reading)/.test(e.status)) steps.push(e.status); send(e); }, ctx);
          const { answer, followups } = splitFollowups(text);
          const sources = sourcesOf(answer, passages);
          send({ done: true, answer, followups, sources });
          // The answer is charged what it used, and the person sees what is left.
          const left = await charge(env, userId, units).catch(() => null);
          console.log(JSON.stringify({ event: "ask_usage", units, calls, searches: steps.length }));
          if (left && billingOn(env)) send({ usage: { units, balance: left } });
          keep(answer, sources, followups, steps);
          return;
        }
        const passages = first;
        send({ passages: passages.map((p, i) => ({ ...p, n: i + 1 })) });
        if (!passages.length) {
          const answer = "The search did not find enough reliable material in the library to answer that question.";
          send({ delta: answer }); send({ done: true, sources: [] }); return;
        }
        let answer = "";
        for await (const piece of answerPieces(env, buildPrompt(question, passages, history))) { answer += piece; send({ delta: piece }); }
        const { answer: clean, followups } = splitFollowups(answer);
        const sources = sourcesOf(clean, passages);
        send({ done: true, answer: clean, followups, sources });
        keep(clean, sources, followups);
      } catch (e) {
        console.error(JSON.stringify({ event: "ask_stream_failed", message: (e as Error).message?.slice(0, 200) }));
        send({ error: "unavailable" });
      } finally { controller.close(); }
    },
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
export async function speakVerse(env: Env, slug: string, ch: number, verse: number, voice: string, ctx?: Exec): Promise<Response> {
  if (!isVoice(voice)) return Response.json({ ok: false, reason: "bad-voice" }, { status: 400 });
  const key = `tts/aura-1/${voice}/${slug}/${ch}/${verse}.mp3`;
  const headers = { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000, immutable" };
  const kept = await env.AUDIO.get(key);
  if (kept) return new Response(kept.body, { headers });
  const c = await chapter(env, slug, ch, ctx);
  const v = c?.verses.find((x) => x.verse === verse);
  if (!v) return Response.json({ ok: false, reason: "not-found" }, { status: 404 });
  try {
    const out = await env.AI.run(VOICE_MODEL, { text: v.text, speaker: voice as "asteria", encoding: "mp3" });
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
