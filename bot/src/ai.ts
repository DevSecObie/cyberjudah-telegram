import { chapter } from "./data";
import type { Env, Exec } from "./env";
import { ANSWER_MODEL, buildPrompt, citations, dedupeMatches, EMBED_MODEL, RERANK_MODEL, VOICE_MODEL, VOICES, type Passage } from "./ai.mjs";

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

/** The passages closest in meaning to the text, one per page or recording moment. */
export async function retrieve(env: Env, text: string, topK = 12): Promise<(Passage & { score: number })[]> {
  const [vector] = await embed(env, [text]);
  if (!vector) return [];
  const res = await env.VEC.query(vector, { topK: 50, returnMetadata: "all" });
  // A passage must say something: scraps of captions ("do", "yeah so") sit close to every question.
  const said = res.matches.filter((m) => String((m.metadata as Record<string, unknown> | undefined)?.text ?? "").split(/\s+/).length >= 20);
  const close = dedupeMatches(said).slice(0, Math.max(topK * 3, 24)).map(passageOf);
  return rerank(env, text, close, topK);
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
    const input = { query: question, contexts: passages.map((p) => ({ text: `${p.title}\n${p.text}`.slice(0, 2000) })), top_k: topK } as unknown as Parameters<typeof env.AI.run<typeof RERANK_MODEL>>[1];
    const res = await env.AI.run(RERANK_MODEL, input) as { response?: { id?: number; score?: number }[] };
    const order = (res.response ?? []).filter((r) => typeof r.id === "number" && passages[r.id!]).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (!order.length) return passages.slice(0, topK);
    return order.slice(0, topK).map((r) => passages[r.id!]);
  } catch { return passages.slice(0, topK); }
}

export type Answer = { ok: true; q: string; answer: string; sources: (Passage & { n: number })[]; ms: number } | { ok: false; reason: string };
const ASK_LIMIT = 40;

/** A question answered from the closest passages only, each claim cited; forty a day per person. */
export async function ask(env: Env, q: string, userId: number, ctx?: Exec): Promise<Answer> {
  const t0 = Date.now();
  const question = q.trim().slice(0, 400);
  if (question.length < 3) return { ok: false, reason: "too-short" };
  const day = new Date().toISOString().slice(0, 10);
  const key = `ask:${userId}:${day}`;
  const used = Number((await env.SUBS.get(key)) ?? 0);
  if (used >= ASK_LIMIT) return { ok: false, reason: "limit" };
  const put = env.SUBS.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
  if (ctx) ctx.waitUntil(put); else await put;
  try {
    const passages = await retrieve(env, question, 8);
    if (!passages.length) return { ok: true, q: question, answer: "Nothing in the library is close to that question yet.", sources: [], ms: Date.now() - t0 };
    const res = await env.AI.run(ANSWER_MODEL, { messages: buildPrompt(question, passages), max_tokens: 700, temperature: 0.2 }) as { response?: string };
    const answer = (res.response ?? "").trim();
    const used = citations(answer, passages.length);
    const sources = (used.length ? used : passages.slice(0, 4).map((_, i) => i + 1)).map((n) => ({ ...passages[n - 1], n }));
    return { ok: true, q: question, answer, sources, ms: Date.now() - t0 };
  } catch (e) {
    console.error(JSON.stringify({ event: "ask_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 200) }));
    return { ok: false, reason: "unavailable" };
  }
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
