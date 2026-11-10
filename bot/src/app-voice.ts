import type { Env } from "./env";
import { takeQuotaKey, toBytes, VOICE_KEY } from "./ai";
import { VOICE_MODEL, voiceId } from "./ai.mjs";
import { viaGateway } from "./providers";
import { reserveFreeBudget, settleFreeBudget } from "./free-budget";
import { citationPattern } from "./citations.mjs";

/**
 * Voice for the app's Ask: a question spoken aloud becomes text (speech recognition), and an answer
 * is read aloud in one of the reading voices. Both run on Workers AI, the free models' provider, so
 * the reader's agreement to it covers them. Both are funded from the shared free daily allowance,
 * reserved before the model runs, and capped per account each day. A read answer is kept in R2 by
 * what it says and in which voice, so hearing it again costs nothing. No audio or text is logged.
 */
export const LISTEN_MODEL = "@cf/deepgram/nova-3";
const LISTEN_MAX_BYTES = 2_000_000; // about a minute of compressed speech
const SPEAK_MAX_CHARS = 3000;
// Workers AI prices (per minute of audio heard, per thousand characters read), with headroom.
const LISTEN_USD = 0.008, SPEAK_USD_PER_KCHAR = 0.04;
const day = () => new Date().toISOString().slice(0, 10);

/** The most Aura-2 reads in one request (Deepgram's limit is 2,000 characters). */
export const AURA_MAX_CHARS = 2000;
/** Text in parts of at most `max` characters, cut after a sentence (or a space) where it can be. */
export function speechPieces(text: string, max = AURA_MAX_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "), head.lastIndexOf("\n"));
    const at = cut > max / 2 ? cut + 1 : head.lastIndexOf(" ") > max / 2 ? head.lastIndexOf(" ") : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Markdown and citation marks taken off, so the voice reads the words only. */
export function speakable(text: string) {
  return text.replace(new RegExp(`\\s*${citationPattern().source}`, 'g'), "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "").replace(/^>\s?/gm, "").replace(/[*_`]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\n{2,}/g, "\n").trim();
}

export async function listen(env: Env, account: string, audio: ArrayBuffer, contentType = ""): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  if (!audio.byteLength) return { ok: false, status: 400, error: "no-audio" };
  if (audio.byteLength > LISTEN_MAX_BYTES) return { ok: false, status: 413, error: "too-large" };
  if (!(await takeQuotaKey(env, `ask_listen:${account}:${day()}`, 60))) return { ok: false, status: 429, error: "limit" };
  const hold = await reserveFreeBudget(env, crypto.randomUUID(), LISTEN_USD).catch(() => null);
  if (!hold) return { ok: false, status: 429, error: "free-paused" };
  try {
    // Nova-3 takes the audio as it came, with its type (Deepgram detects a container it is not told).
    const res = await env.AI.run(LISTEN_MODEL as never, { audio: { body: new Response(audio).body, contentType: contentType || "application/octet-stream" }, language: "en", smart_format: true, punctuate: true } as never, viaGateway(env)) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
    await settleFreeBudget(env, hold, LISTEN_USD);
    const text = String(res?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim().slice(0, 4000);
    return text ? { ok: true, text } : { ok: false, status: 422, error: "not-heard" };
  } catch {
    await settleFreeBudget(env, hold, LISTEN_USD).catch(() => undefined);
    return { ok: false, status: 503, error: "unavailable" };
  }
}

export async function speak(env: Env, account: string, text: string, voice: string): Promise<Response> {
  const words = speakable(text).slice(0, SPEAK_MAX_CHARS);
  if (words.length < 2) return Response.json({ error: "too-short" }, { status: 400 });
  const speaker = voiceId(voice);
  if (!speaker) return Response.json({ error: "bad-voice" }, { status: 400 });
  const headers = { "content-type": "audio/mpeg", "cache-control": "private, max-age=86400" };
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(words)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `tts/answers/${VOICE_KEY}/${speaker}/${digest}.mp3`;
  const kept = await env.AUDIO.get(key).catch(() => null);
  if (kept) return new Response(kept.body, { headers });
  if (!(await takeQuotaKey(env, `ask_speak:${account}:${day()}`, 30))) return Response.json({ error: "limit" }, { status: 429 });
  const usd = (words.length / 1000) * SPEAK_USD_PER_KCHAR;
  const hold = await reserveFreeBudget(env, crypto.randomUUID(), usd).catch(() => null);
  if (!hold) return Response.json({ error: "free-paused" }, { status: 429 });
  try {
    // Aura-2 reads at most AURA_MAX_CHARS a request: a longer answer is read in parts, joined as one MP3.
    const parts: Uint8Array[] = [];
    for (const piece of speechPieces(words)) {
      const part = await toBytes(await env.AI.run(VOICE_MODEL as never, { text: piece, speaker, encoding: "mp3" } as never, viaGateway(env)));
      if (!part?.length) throw new Error("no audio");
      parts.push(part);
    }
    await settleFreeBudget(env, hold, usd);
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (bytes.set(p, at), at + p.length), 0);
    await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/mpeg" } }).catch(() => undefined);
    return new Response(bytes, { headers });
  } catch {
    await settleFreeBudget(env, hold, usd).catch(() => undefined);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
