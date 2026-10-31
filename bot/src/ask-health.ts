import type { Env } from "./env";
import { freeSpendToday } from "./free-budget";
import { hasClaude, unifiedBilling } from "./providers";

/**
 * The admins' Ask health view (Settings > Ask Health), from the ask_events records (ask-events.ts):
 * per model, how its answers turned out (in the manner of a model leaderboard), the latest problems
 * with their reason, today's free budget, and whether Claude's money is there. No question, answer
 * or reader is ever in it; the records never hold them.
 */
export type ModelHealth = { model: string; answers: number; complete: number; fallback: number; failed: number; cutOff: number; medianMs: number | null; avgSources: number | null };
export type AskProblem = { at: number; surface: string; model: string | null; outcome: string; detail: string | null; elapsedMs: number | null };

const OK = new Set(["complete"]);
const FALLBACK = new Set(["fallback", "no-evidence", "empty"]);
// Refusals the reader is told about plainly (limits, consent, sign-in): not faults of the model.
const REFUSAL = new Set(["limit", "free-paused", "consent", "too-short", "too-long", "model-unavailable", "credits"]);

type Row = { at: number; trace_id: string | null; surface: string; model: string | null; outcome: string; detail: string | null; elapsed_ms: number | null; sources: number | null };

/** Summarises the rows: a started request with no other record under its trace id was cut off. */
export function summarise(rows: Row[], now: number, graceMs = 5 * 60_000): { models: ModelHealth[]; problems: AskProblem[] } {
  const ended = new Set(rows.filter((r) => r.outcome !== "started" && r.outcome !== "retry" && r.trace_id).map((r) => r.trace_id));
  const by = new Map<string, { m: ModelHealth; ms: number[]; src: number[] }>();
  const of = (model: string | null) => {
    const id = model || "unknown";
    let e = by.get(id);
    if (!e) by.set(id, (e = { m: { model: id, answers: 0, complete: 0, fallback: 0, failed: 0, cutOff: 0, medianMs: null, avgSources: null }, ms: [], src: [] }));
    return e;
  };
  const problems: AskProblem[] = [];
  for (const r of rows) {
    if (r.outcome === "retry" || REFUSAL.has(r.outcome)) continue;
    if (r.outcome === "started") {
      // Still answering, or no trace id to match: not counted.
      if (!r.trace_id || ended.has(r.trace_id) || now - r.at < graceMs) continue;
      const e = of(r.model);
      e.m.answers++; e.m.cutOff++;
      problems.push({ at: r.at, surface: r.surface, model: r.model, outcome: "cut-off", detail: "Stopped mid-answer; nothing was recorded after it started.", elapsedMs: null });
      continue;
    }
    const e = of(r.model);
    e.m.answers++;
    if (OK.has(r.outcome)) e.m.complete++;
    else if (FALLBACK.has(r.outcome)) e.m.fallback++;
    else e.m.failed++;
    if (r.elapsed_ms != null) e.ms.push(r.elapsed_ms);
    if (r.sources != null) e.src.push(r.sources);
    if (!OK.has(r.outcome)) problems.push({ at: r.at, surface: r.surface, model: r.model, outcome: r.outcome, detail: r.detail, elapsedMs: r.elapsed_ms });
  }
  const models = [...by.values()].map(({ m, ms, src }) => {
    ms.sort((a, b) => a - b);
    return { ...m, medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null, avgSources: src.length ? Math.round((src.reduce((a, b) => a + b, 0) / src.length) * 10) / 10 : null };
  }).sort((a, b) => b.answers - a.answers);
  return { models, problems: problems.sort((a, b) => b.at - a.at).slice(0, 25) };
}

export async function askHealth(env: Env, hours = 24, now = Date.now()) {
  const since = now - Math.min(Math.max(hours, 1), 14 * 24) * 3600_000;
  let rows: Row[] = [];
  try {
    rows = (await env.DB.prepare("SELECT at, trace_id, surface, model, outcome, detail, elapsed_ms, sources FROM ask_events WHERE at >= ? ORDER BY at DESC LIMIT 5000").bind(since).all<Row>()).results ?? [];
  } catch { /* No answers recorded yet: the table is made by the first one. */ }
  const { models, problems } = summarise(rows, now);
  const cap = Number(env.ASK_FREE_DAILY_USD_CAP ?? 0.11);
  let held = 0;
  try {
    const r = await env.DB.prepare("SELECT COALESCE(SUM(reserved_micro), 0) AS m FROM free_spend_holds WHERE day = ? AND state = 'held'").bind(new Date(now).toISOString().slice(0, 10)).first<{ m: number }>();
    held = (r?.m ?? 0) / 1e6;
  } catch { /* none yet */ }
  const fundsAlert = await env.SUBS.get("alert:claude_funds").catch(() => null);
  return {
    hours,
    models,
    problems,
    free: { spentUsd: await freeSpendToday(env, now).catch(() => 0), heldUsd: held, capUsd: Number.isFinite(cap) ? cap : null, model: env.ASK_FREE_MODEL ?? null, deepModel: env.ASK_FREE_DEEP_MODEL ?? null },
    claude: { configured: hasClaude(env), billing: unifiedBilling(env) ? "cloudflare" : "console", outOfFundsSince: fundsAlert },
  };
}
