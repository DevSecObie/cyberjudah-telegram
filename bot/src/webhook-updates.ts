import type { Env } from "./env";

const LEASE_MS = 20 * 60_000;
const table = "CREATE TABLE IF NOT EXISTS webhook_updates (update_id INTEGER PRIMARY KEY, claim TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL)";

/** D1 owns update claims; KV is eventually consistent and cannot serialize deliveries.
 * Completed updates are acknowledged; active claims ask Telegram to retry. A crashed
 * handler's claim expires, while a thrown handler releases its own claim immediately.
 * Payment handlers remain independently idempotent by Telegram charge id.
 */
export async function handleWebhookUpdate(env: Env, id: number, next: () => Promise<void>, now = Date.now()): Promise<void> {
  await env.DB.prepare(table).run();
  const claim = crypto.randomUUID();
  const got = await env.DB.prepare(`INSERT INTO webhook_updates (update_id, claim, state, at) VALUES (?, ?, 'running', ?)
    ON CONFLICT (update_id) DO UPDATE SET claim = excluded.claim, at = excluded.at
    WHERE state = 'running' AND at < ?`).bind(id, claim, now, now - LEASE_MS).run();
  if (!Number(got.meta.changes)) {
    const row = await env.DB.prepare("SELECT state FROM webhook_updates WHERE update_id = ?").bind(id).first<{ state: string }>();
    if (row?.state === "done") return;
    throw new Error("This update is still processing; retry delivery.");
  }
  try {
    await next();
    const done = await env.DB.prepare("UPDATE webhook_updates SET state = 'done', at = ? WHERE update_id = ? AND claim = ?").bind(Date.now(), id, claim).run();
    if (!Number(done.meta.changes)) throw new Error("Update claim changed; retry delivery.");
  } catch (e) {
    await env.DB.prepare("DELETE FROM webhook_updates WHERE update_id = ? AND claim = ? AND state = 'running'").bind(id, claim).run().catch(() => undefined);
    throw e;
  }
}

/** Telegram update ids and random claims carry no reader data. Keep dedup for seven days. */
export async function sweepWebhookUpdates(env: Env, now = Date.now()): Promise<void> {
  await env.DB.prepare(table).run();
  await env.DB.prepare("DELETE FROM webhook_updates WHERE at < ?").bind(now - 7 * 86400_000).run();
}
