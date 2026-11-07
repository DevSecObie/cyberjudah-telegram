import type { Env } from "./env";

export type FreeReservation = { request: string; day: string };
/** A separate daily allowance kept in the same tables under a prefixed day ("claude:2026-10-31"),
 * so Claude answers for readers (ASK_CLAUDE_DAILY_USD_CAP) never spend the free models' allowance. */
export type BudgetPool = { prefix: string; capUsd: number; totalUsd?: number };
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
const micro = (usd: number) => Math.ceil(usd * 1e6 - 1e-6);
const cap = (env: Env) => {
  const value = Number(env.ASK_FREE_DAILY_USD_CAP ?? 0.11);
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid free answer budget");
  return micro(value);
};
async function tables(env: Env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS free_spend_daily (day TEXT PRIMARY KEY, usd_micro INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS free_spend_holds (request_id TEXT PRIMARY KEY, day TEXT NOT NULL, reserved_micro INTEGER NOT NULL, state TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS free_spend_holds_day ON free_spend_holds (day, state)"),
  ]);
}
export async function freeSpendToday(env: Env, now = Date.now()): Promise<number> {
  await tables(env);
  const r = await env.DB.prepare("SELECT usd_micro AS m FROM free_spend_daily WHERE day = ?").bind(dayOf(now)).first<{ m: number }>();
  return (r?.m ?? 0) / 1e6;
}
/** A day's free spend so far against the cap, in micro-dollars: settled answers, and holds still
 *  reserved for answers in flight (or left by an answer that never settled). */
export async function freeUsedToday(env: Env, now = Date.now()): Promise<{ settled: number; held: number; cap: number }> {
  await tables(env);
  const day = dayOf(now);
  const r = await env.DB.prepare(`SELECT COALESCE((SELECT usd_micro FROM free_spend_daily WHERE day = ?), 0) AS settled,
    COALESCE((SELECT SUM(reserved_micro) FROM free_spend_holds WHERE day = ? AND state = 'held'), 0) AS held`).bind(day, day).first<{ settled: number; held: number }>();
  return { settled: Number(r?.settled ?? 0), held: Number(r?.held ?? 0), cap: cap(env) };
}

/** Free answers' spend (settled plus reserved) at or past this share of the day's cap tells the admins. */
export const FREE_BUDGET_ALERT_SHARE = 0.8;
/** How often the cron checks (every quarter hour); a check just after midnight also looks at the day before. */
const ALERT_EVERY_MS = 15 * 60_000;
/**
 * Tell the admins, once per UTC day, when free answers near the day's cap, before readers meet
 * "free-paused". From the quarter-hour cron. Its own KV key, not the health state, so it neither
 * masks nor is masked by an outage. The key is kept only when at least one admin was reached, so a
 * failed send, or no ADMIN_IDS yet, is tried again next time. A cap of 0 means free answers are
 * off on purpose. Returns how many alerts were sent.
 */
export async function alertFreeBudget(env: Env, now = Date.now()): Promise<number> {
  let sent = 0;
  // The day just ended too, so a crossing in its last quarter hour is not lost at midnight.
  for (const at of [...new Set([dayOf(now - ALERT_EVERY_MS), dayOf(now)])].map((d) => Date.parse(`${d}T12:00:00Z`))) {
    try {
      const { settled, held, cap: capMicro } = await freeUsedToday(env, at);
      const used = settled + held;
      if (capMicro <= 0 || used < Math.ceil(capMicro * FREE_BUDGET_ALERT_SHARE)) continue;
      const day = dayOf(at), key = `alert:free_budget:${day}`;
      if (await env.SUBS.get(key)) continue;
      await env.SUBS.put(key, new Date(now).toISOString(), { expirationTtl: 2 * 86400 });
      const usd = (m: number) => `$${(m / 1e6).toFixed(2)}`;
      let reached = 0;
      try {
        // Loaded here, not at the top, so this module stays importable without the Telegram client.
        const { tellAdmins } = await import("./health");
        reached = await tellAdmins(env, `Ask CyberJudah: free answers have used ${usd(used)} of the ${usd(capMicro)} budget for ${day} (${Math.round((used / capMicro) * 100)}%): ${usd(settled)} spent, ${usd(held)} reserved for answers in flight. At the cap, free answers pause until 00:00 UTC (ASK_FREE_DAILY_USD_CAP).\n\n${new Date(now).toISOString()}`);
      } finally {
        if (!reached) await env.SUBS.delete(key).catch(() => {});
      }
      if (reached) sent++;
    } catch (e) {
      console.error(JSON.stringify({ event: "free_budget_alert_failed", message: String((e as Error)?.message ?? e).slice(0, 160) }));
    }
  }
  return sent;
}

export async function freePaused(env: Env, now = Date.now()): Promise<boolean> {
  try {
    await tables(env);
    const day = dayOf(now);
    const r = await env.DB.prepare(`SELECT COALESCE((SELECT usd_micro FROM free_spend_daily WHERE day = ?), 0)
      + COALESCE((SELECT SUM(reserved_micro) FROM free_spend_holds WHERE day = ? AND state = 'held'), 0) AS m`).bind(day, day).first<{ m: number }>();
    return !r || r.m >= cap(env);
  } catch { return true; } // An unreadable counter never means a zero balance.
}

/** Admission reserves the whole answer budget in one statement, before any model work.
 * Lost or unsettled reservations remain held for that UTC day; guessing their cost or
 * releasing them on a timer could enable new work after a provider already charged us.
 */
export async function reserveFreeBudget(env: Env, request: string, usd: number, now = Date.now(), pool?: BudgetPool): Promise<FreeReservation | null> {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("Invalid free answer reservation");
  if (pool && (!Number.isFinite(pool.capUsd) || pool.capUsd < 0 || !/^[a-z]+:$/.test(pool.prefix))) throw new Error("Invalid answer budget pool");
  await tables(env);
  if (pool?.totalUsd !== undefined && (!Number.isFinite(pool.totalUsd) || pool.totalUsd < 0)) throw new Error("Invalid answer budget total");
  const day = `${pool?.prefix ?? ""}${dayOf(now)}`, amount = micro(usd);
  // A pool with a total (a prepaid amount, such as Claude's for readers) also stops when everything
  // it has ever spent, plus what is held now, would pass that total. Spent days are kept for ever
  // in free_spend_daily; holds still open are counted whatever their day.
  const total = pool?.totalUsd !== undefined ? micro(pool.totalUsd) : -1;
  const like = `${pool?.prefix ?? ""}%`;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO free_spend_holds (request_id, day, reserved_micro, state)
    SELECT ?, ?, ?, 'held' WHERE COALESCE((SELECT usd_micro FROM free_spend_daily WHERE day = ?), 0)
    + COALESCE((SELECT SUM(reserved_micro) FROM free_spend_holds WHERE day = ? AND state = 'held'), 0) + ? <= ?
    AND (? < 0 OR COALESCE((SELECT SUM(usd_micro) FROM free_spend_daily WHERE day LIKE ?), 0)
      + COALESCE((SELECT SUM(reserved_micro) FROM free_spend_holds WHERE day LIKE ? AND state = 'held'), 0) + ? <= ?)`)
    .bind(request, day, amount, day, day, amount, pool ? micro(pool.capUsd) : cap(env), total, like, like, amount, total).run();
  return Number(result.meta.changes) ? { request, day } : null;
}

/** Counter and reservation settle together, once. On failure the reservation stays held. */
export async function settleFreeBudget(env: Env, hold: FreeReservation, actualUsd: number): Promise<void> {
  if (!Number.isFinite(actualUsd) || actualUsd < 0) throw new Error("Invalid free answer cost");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO free_spend_daily (day, usd_micro)
      SELECT day, ? FROM free_spend_holds WHERE request_id = ? AND day = ? AND state = 'held'
      ON CONFLICT (day) DO UPDATE SET usd_micro = usd_micro + excluded.usd_micro`).bind(micro(actualUsd), hold.request, hold.day),
    env.DB.prepare("UPDATE free_spend_holds SET state = 'settled' WHERE request_id = ? AND day = ? AND state = 'held'").bind(hold.request, hold.day),
  ]);
}

export async function sweepFreeBudget(env: Env, now = Date.now()): Promise<void> {
  await tables(env);
  const before = dayOf(now - 7 * 86400_000);
  await env.DB.prepare("DELETE FROM free_spend_holds WHERE day < ? OR (day LIKE '%:%' AND substr(day, instr(day, ':') + 1) < ?)").bind(before, before).run();
}
