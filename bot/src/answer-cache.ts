import type { Env } from "./env";
import type { Turn } from "./ai.mjs";
import { hasToolMarkup } from "./agent-open";
import { isCoverageGap } from "./grounding.mjs";
import { PROMPT_VERSION, UNAVAILABLE_CORPUS } from "./ask-versions";

/**
 * Answers already written, kept for a week (KV, ask_cache:…). When the same first question is
 * asked again, word for word apart from case and punctuation, with the same prompts, library
 * (corpus release), model, mode and release, the kept answer is given at once with no model call and no cost. Only first questions
 * (no conversation before them) that found teaching are kept, so nothing personal to one
 * conversation is ever reused. A reader's "wrong" or "harmful" report on a kept answer removes it,
 * so the next reader gets a fresh one.
 */
export const CACHE_TTL_S = 7 * 86400;
const MAX_BYTES = 200_000;
// What a kept answer must hold (#610: the study completeness check below). A change here starts new
// keys alongside the prompt version and corpus release (#600), so answers kept before it are never served.
const PROMPT_REVISION = "study-completeness-v2";

function incomplete(answer: unknown): boolean {
  if (!answer || typeof answer !== "object") return false;
  const value = answer as { partial?: boolean; cut?: boolean; unfinished?: unknown[]; coverage?: { complete?: boolean; stopped?: string; parts?: { status?: string }[] } };
  if (value.partial === true || value.cut === true || value.unfinished?.length) return true;
  if (!value.coverage) return false;
  const coverage = value.coverage;
  return coverage.complete !== true || coverage.stopped !== "covered" || !Array.isArray(coverage.parts) || !coverage.parts.length || coverage.parts.some(part => part?.status !== "covered");
}

export const normalizeQuestion = (q: string) => q.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The cache key for a question, or null when it must not be cached (a follow-up, or too short).
 * A new prompt version (ask-versions.ts), cache revision (PROMPT_REVISION) or corpus release starts new keys, so an answer written
 * before the change is never given after it; old entries expire normally.
 */
export async function cacheKey(question: string, history: Turn[], model: string, mode: string, release: string, corpus: string): Promise<string | null> {
  if (history.length) return null;
  // The library could not be read: no kept answer can be shown to belong to it.
  if (corpus === UNAVAILABLE_CORPUS) return null;
  const q = normalizeQuestion(question);
  if (q.split(" ").length < 2) return null;
  return `ask_cache:${PROMPT_VERSION}:${PROMPT_REVISION}:${corpus}:${release}:${mode}:${model}:${await sha256(q)}`;
}

export async function cachedAnswer<T>(env: Env, key: string | null): Promise<T | null> {
  if (!key) return null;
  try {
    const raw = await env.SUBS.get(key);
    if (!raw) return null;
    // An answer kept before tool-call markup was removed (agent-open.ts chatText) is dropped,
    // so the reader gets a fresh answer and never the markup.
    if (hasToolMarkup(raw)) { await env.SUBS.delete(key).catch(() => undefined); return null; }
    const answer = JSON.parse(raw);
    if (incomplete(answer)) { await env.SUBS.delete(key).catch(() => undefined); return null; }
    return answer as T;
  } catch { return null; }
}

/** Keeps an answer, and links the trace id that served it so a report can remove it. */
export async function keepAnswer(env: Env, key: string | null, answer: unknown, traceId?: string): Promise<void> {
  if (!key || isCoverageGap(answer) || incomplete(answer)) return;
  const value = JSON.stringify(answer);
  if (value.length > MAX_BYTES || hasToolMarkup(value)) return;
  try {
    await env.SUBS.put(key, value, { expirationTtl: CACHE_TTL_S });
    if (traceId) await linkTrace(env, key, traceId);
  } catch { /* A lost cache write only means the next reader's answer is written fresh. */ }
}

export async function linkTrace(env: Env, key: string | null, traceId?: string): Promise<void> {
  if (!key || !traceId) return;
  try { await env.SUBS.put(`ask_cache_trace:${traceId.toLowerCase()}`, key, { expirationTtl: CACHE_TTL_S }); } catch { /* best effort */ }
}

/** A reported answer is never served again from the cache. */
export async function dropReported(env: Env, traceId: string): Promise<boolean> {
  try {
    const key = await env.SUBS.get(`ask_cache_trace:${traceId.toLowerCase()}`);
    if (!key?.startsWith("ask_cache:")) return false;
    await env.SUBS.delete(key);
    return true;
  } catch { return false; }
}
