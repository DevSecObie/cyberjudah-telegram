import { telegramApi } from "./telegram-api";
import type { Env } from "./env";

/**
 * The hourly self-check: the worker probes what it depends on and pages the admins over
 * Telegram when something breaks or recovers. No third-party status service — the bot is
 * the pager. State in KV (`health:state`): alerts fire on the bad transition and repeat
 * every six hours while still bad, so a long outage pages without spamming.
 */

export type Check = { name: string; ok: boolean; detail?: string };

const STATE_KEY = "health:state";
const REMIND_MS = 6 * 3600 * 1000;
/** A daily send whose failures pass this share of attempts pages the admins. */
const DAILY_FAIL_SHARE = 0.2;

/** How long to wait before the one retry of a failed D1 probe. */
export const RETRY_MS = 5000;

/**
 * D1 sometimes refuses a query for a moment ("D1 DB is overloaded. Requests queued for too
 * long."). A probe is tried once more after RETRY_MS, so a passing hiccup does not page the admins.
 */
async function again<T>(probe: () => Promise<T>, wait = RETRY_MS): Promise<T> {
  try { return await probe(); } catch { await new Promise((r) => setTimeout(r, wait)); return probe(); }
}

const err = (e: unknown) => (e instanceof Error ? e.message?.slice(0, 120) : String(e).slice(0, 120));

/** What the worker depends on, probed directly: the indexes, the vectors, and headroom. */
export async function selfCheck(env: Env, now = Date.now(), retryMs = RETRY_MS): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  // One row is enough to show the index is loaded; counting every row scans the whole table.
  try {
    const r = await again(() => env.DB.prepare("SELECT 1 AS n FROM search_docs LIMIT 1").first<{ n: number }>(), retryMs);
    checks.push({ name: "d1-search", ok: Boolean(r), detail: r ? "loaded" : "empty" });
  } catch (e) { checks.push({ name: "d1-search", ok: false, detail: err(e) }); }
  try {
    const r = await again(() => env.TEACH.prepare("SELECT 1 AS n FROM teaching_passages LIMIT 1").first<{ n: number }>(), retryMs);
    checks.push({ name: "d1-teachings", ok: Boolean(r), detail: r ? "loaded" : "empty" });
  } catch (e) { checks.push({ name: "d1-teachings", ok: false, detail: err(e) }); }
  try {
    const d = await env.VEC.describe();
    checks.push({ name: "vectorize", ok: (d.vectorCount ?? 0) > 0, detail: `${d.vectorCount ?? 0} vectors` });
  } catch (e) { checks.push({ name: "vectorize", ok: false, detail: err(e) }); }
  try {
    // D1 does not allow the page_count/page_size pragmas (SQLITE_AUTH); every result's
    // metadata carries the database size in bytes after the statement instead.
    const r = await again(() => env.DB.prepare("SELECT 1").run(), retryMs);
    const bytes = Number((r.meta as { size_after?: number }).size_after ?? 0);
    // D1's per-database storage has a documented ceiling; alert at 80% of it so there is
    // room to act. Override with the D1_SIZE_ALERT_BYTES var when Cloudflare moves it.
    const ceiling = Number(env.D1_SIZE_ALERT_BYTES ?? 8 * 1024 ** 3);
    checks.push({ name: "d1-size", ok: bytes < ceiling, detail: `${(bytes / 1024 ** 3).toFixed(2)} GB of ${(ceiling / 1024 ** 3).toFixed(0)} GB` });
  } catch (e) { checks.push({ name: "d1-size", ok: false, detail: err(e) }); }
  // The last completed daily-verse slot: a high failure share means Telegram is throttling
  // the broadcast or the send path regressed.
  try {
    const slot = await lastDailySlot(env, now);
    if (slot) {
      const attempts = slot.sent + slot.failed;
      const share = attempts ? slot.failed / attempts : 0;
      checks.push({
        name: "daily-send", ok: share < DAILY_FAIL_SHARE,
        detail: attempts ? `${slot.sent} sent, ${slot.failed} failed` : "no attempts",
      });
    }
  } catch (e) { checks.push({ name: "daily-send", ok: false, detail: err(e) }); }
  // D1 serializes writers: a burst of paid answers can lose every hold/settle retry.
  // credits.ts counts those per day; past the alert threshold the admins are paged.
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const r = await env.DB.prepare("SELECT n FROM contention_daily WHERE day = ?").bind(day).first<{ n: number }>().catch(() => null);
    const n = r?.n ?? 0;
    const alertAt = Math.max(1, Number(env.CREDITS_CONTENTION_ALERT ?? 50));
    checks.push({ name: "credits-contention", ok: n < alertAt, detail: `${n} today` });
  } catch (e) { checks.push({ name: "credits-contention", ok: false, detail: err(e) }); }
  return { ok: checks.every((c) => c.ok), checks };
}

/** The most recent finished daily slot's counts, if the sender recorded them. */
async function lastDailySlot(env: Env, now: number): Promise<{ sent: number; failed: number } | null> {
  for (let back = 0; back < 30; back++) {
    const t = new Date(now - back * 3600000);
    const key = `daily:${t.toISOString().slice(0, 10)}:${String(t.getUTCHours()).padStart(2, "0")}`;
    const s = (await env.SUBS.get(key, "json")) as { sent?: number; failed?: number; done?: boolean } | null;
    if (s?.done) return { sent: s.sent ?? 0, failed: s.failed ?? 0 };
  }
  return null;
}

const adminIds = (env: Env): number[] =>
  String(env.ADMIN_IDS ?? "").split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export async function tellAdmins(env: Env, text: string): Promise<void> {
  const ids = adminIds(env);
  if (!ids.length) { console.log(JSON.stringify({ event: "health_no_admins" })); return; }
  const api = telegramApi(env);
  // Plain text: check details carry server error text, which must not be parsed as HTML.
  const results = await Promise.allSettled(ids.map((id) => api.sendMessage(id, text)));
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") console.error(JSON.stringify({ event: "health_alert_failed", message: err(r.reason) }));
  }
}

/** Page on the bad transition (and every six hours while still bad); note the recovery. */
export async function reportHealth(env: Env, result: { ok: boolean; checks: Check[] }, now = Date.now()): Promise<void> {
  const prev = (await env.SUBS.get(STATE_KEY, "json")) as { ok: boolean; at: string; remindedAt?: string } | null;
  if (!result.ok) {
    const bad = result.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ");
    const lastPing = new Date(prev?.remindedAt ?? prev?.at ?? 0).getTime();
    if (!prev || prev.ok || now - lastPing >= REMIND_MS) {
      await tellAdmins(env, `CyberJudah health check failing:\n${bad}\n\n${new Date(now).toISOString()}`);
      await env.SUBS.put(STATE_KEY, JSON.stringify({ ok: false, at: new Date(now).toISOString(), remindedAt: new Date(now).toISOString() }));
    }
    return;
  }
  if (prev && !prev.ok) {
    await tellAdmins(env, `CyberJudah health check recovered.\n\n${new Date(now).toISOString()}`);
  }
  await env.SUBS.put(STATE_KEY, JSON.stringify({ ok: true, at: new Date(now).toISOString() }));
}
