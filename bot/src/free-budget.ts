import type { Env } from "./env";

export type FreeReservation = { request: string; day: string };
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
export async function reserveFreeBudget(env: Env, request: string, usd: number, now = Date.now()): Promise<FreeReservation | null> {
  if (!Number.isFinite(usd) || usd <= 0) throw new Error("Invalid free answer reservation");
  await tables(env);
  const day = dayOf(now), amount = micro(usd);
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO free_spend_holds (request_id, day, reserved_micro, state)
    SELECT ?, ?, ?, 'held' WHERE COALESCE((SELECT usd_micro FROM free_spend_daily WHERE day = ?), 0)
    + COALESCE((SELECT SUM(reserved_micro) FROM free_spend_holds WHERE day = ? AND state = 'held'), 0) + ? <= ?`)
    .bind(request, day, amount, day, day, amount, cap(env)).run();
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
  await env.DB.prepare("DELETE FROM free_spend_holds WHERE day < ?").bind(before).run();
}
