import type { Env } from "./env";
import { isVoice, takeQuotaKey, toBytes } from "./ai";
import { VOICE_MODEL } from "./ai.mjs";
import { viaGateway } from "./providers";
import { reserveFreeBudget, settleFreeBudget } from "./free-budget";

/**
 * Voice for the app's Ask: a question spoken aloud becomes text (speech recognition), and an answer
 * is read aloud in one of the reading voices. Both run on Workers AI, the free models' provider, so
 * the reader's agreement to it covers them. Both are funded from the shared free daily allowance,
 * reserved before the model runs, and capped per account each day. A read answer is kept in R2 by
 * what it says and in which voice, so hearing it again costs nothing. No audio or text is logged.
 */
export const LISTEN_MODEL = "@cf/openai/whisper-large-v3-turbo";
const LISTEN_MAX_BYTES = 2_000_000; // about a minute of compressed speech
const SPEAK_MAX_CHARS = 3000;
// Workers AI prices (per minute of audio heard, per thousand characters read), with headroom.
const LISTEN_USD = 0.002, SPEAK_USD_PER_KCHAR = 0.02;
const day = () => new Date().toISOString().slice(0, 10);

/** Markdown and citation marks taken off, so the voice reads the words only. */
export function speakable(text: string) {
  return text.replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "").replace(/^>\s?/gm, "").replace(/[*_`]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\n{2,}/g, "\n").trim();
}

export async function listen(env: Env, account: string, audio: ArrayBuffer): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  if (!audio.byteLength) return { ok: false, status: 400, error: "no-audio" };
  if (audio.byteLength > LISTEN_MAX_BYTES) return { ok: false, status: 413, error: "too-large" };
  if (!(await takeQuotaKey(env, `ask_listen:${account}:${day()}`, 60))) return { ok: false, status: 429, error: "limit" };
  const hold = await reserveFreeBudget(env, crypto.randomUUID(), LISTEN_USD).catch(() => null);
  if (!hold) return { ok: false, status: 429, error: "free-paused" };
  try {
    const bytes = new Uint8Array(audio);
    let b64 = "";
    for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await env.AI.run(LISTEN_MODEL as never, { audio: btoa(b64), task: "transcribe", language: "en" } as never, viaGateway(env)) as { text?: string };
    await settleFreeBudget(env, hold, LISTEN_USD);
    const text = String(res?.text ?? "").trim().slice(0, 4000);
    return text ? { ok: true, text } : { ok: false, status: 422, error: "not-heard" };
  } catch {
    await settleFreeBudget(env, hold, LISTEN_USD).catch(() => undefined);
    return { ok: false, status: 503, error: "unavailable" };
  }
}

export async function speak(env: Env, account: string, text: string, voice: string): Promise<Response> {
  const words = speakable(text).slice(0, SPEAK_MAX_CHARS);
  if (words.length < 2) return Response.json({ error: "too-short" }, { status: 400 });
  if (!isVoice(voice)) return Response.json({ error: "bad-voice" }, { status: 400 });
  const headers = { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" };
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(words)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `tts/answers/${voice}/${digest}.mp3`;
  const kept = await env.AUDIO.get(key).catch(() => null);
  if (kept) return new Response(kept.body, { headers });
  if (!(await takeQuotaKey(env, `ask_speak:${account}:${day()}`, 30))) return Response.json({ error: "limit" }, { status: 429 });
  const usd = (words.length / 1000) * SPEAK_USD_PER_KCHAR;
  const hold = await reserveFreeBudget(env, crypto.randomUUID(), usd).catch(() => null);
  if (!hold) return Response.json({ error: "free-paused" }, { status: 429 });
  try {
    const out = await env.AI.run(VOICE_MODEL, { text: words, speaker: voice as "asteria", encoding: "mp3" }, viaGateway(env));
    await settleFreeBudget(env, hold, usd);
    const bytes = await toBytes(out);
    if (!bytes?.length) throw new Error("no audio");
    await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } }).catch(() => undefined);
    return new Response(bytes, { headers });
  } catch {
    await settleFreeBudget(env, hold, usd).catch(() => undefined);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
