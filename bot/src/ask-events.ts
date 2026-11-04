import type { Env } from "./env";

/**
 * How each app Ask answer turned out, kept in D1 (ask_events) for 14 days so problems can be
 * found and fixed without anyone reporting them: the outcome, the model, how long it took and how
 * many sources it found. Never the question, the answer, the passages or who asked; the trace id
 * links an event to the reader's own report, if they send one.
 */
export type AskEvent = {
  traceId?: string;
  surface: "app" | "study" | "paid" | "voice";
  model?: string;
  /** complete, fallback (a source-checked answer could not be written), no-evidence, retry, empty, failed, timeout, limit, free-paused, consent… */
  outcome: string;
  detail?: string;
  elapsedMs?: number;
  sources?: number;
};

const RETAIN_DAYS = 14;
const ready = new WeakMap<object, Promise<unknown>>();
const table = (env: Env) => ready.get(env.DB) ?? ready.set(env.DB, env.DB.batch([
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS ask_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, trace_id TEXT,
    surface TEXT NOT NULL, model TEXT, outcome TEXT NOT NULL, detail TEXT, elapsed_ms INTEGER, sources INTEGER)`),
  env.DB.prepare("CREATE INDEX IF NOT EXISTS ask_events_at ON ask_events (at)"),
]).catch((e) => { ready.delete(env.DB); throw e; })).get(env.DB)!;

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : null);

/** Records one outcome. A failure to record never affects the answer. */
export async function recordAskEvent(env: Env, e: AskEvent, now = Date.now()): Promise<void> {
  try {
    await table(env);
    await env.DB.prepare("INSERT INTO ask_events (at, trace_id, surface, model, outcome, detail, elapsed_ms, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(now, clip(e.traceId, 64), e.surface, clip(e.model, 100), clip(e.outcome, 40) ?? "unknown", clip(e.detail, 300), Number.isFinite(e.elapsedMs) ? Math.round(e.elapsedMs!) : null, Number.isFinite(e.sources) ? e.sources! : null).run();
  } catch (err) { console.error(JSON.stringify({ event: "ask_event_record_failed", message: String((err as Error)?.message ?? err).slice(0, 120) })); }
}

export async function sweepAskEvents(env: Env, now = Date.now()): Promise<void> {
  await table(env);
  await env.DB.prepare("DELETE FROM ask_events WHERE at < ?").bind(now - RETAIN_DAYS * 86400_000).run();
}
