import { Api } from "grammy";

import type { Env } from "./env";
import { balance, emptyAccount, grantPack, grantPlan, payloadOf, pricing, readSupport, reserve, RESERVE_UNITS, settleTake, spend, SUPPORT_STARS, takeOf, today, validPayment, type Account, type Balance, type Pricing, type Take } from "./billing.mjs";
export { RESERVE_UNITS, SUPPORT_STARS };
export type { Account, Balance, Pricing, Take };
import { isAdmin } from "./edit";

/**
 * The person's allowance for Ask CyberJudah, kept in D1's `accounts` table: today's free
 * use, the monthly plan paid in Stars, and the credit from top-up packs. Every balance
 * mutation is one optimistic-concurrency transaction (a version-checked UPDATE, retried on
 * contention), so concurrent requests cannot each read the same balance and all spend it
 * the way a KV read-modify-write can. `usage:<day>` sums the day's questions and units for
 * the admins to price by.
 */
export const prices = (env: Env): Pricing => pricing(env as unknown as Record<string, unknown>);
export const billingOn = (env: Env) => Boolean(env.ANTHROPIC_API_KEY) && env.ASK_BILLING === "on";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY, day TEXT NOT NULL DEFAULT '',
    free_used INTEGER NOT NULL DEFAULT 0, plan_until INTEGER NOT NULL DEFAULT 0,
    plan_allowance INTEGER NOT NULL DEFAULT 0, plan_used INTEGER NOT NULL DEFAULT 0,
    credits INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1)`,
  "CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS usage_daily (day TEXT PRIMARY KEY, questions INTEGER NOT NULL DEFAULT 0, units INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS usage_people (day TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (day, user_id))",
];

type Row = { user_id: string; day: string; free_used: number; plan_until: number; plan_allowance: number; plan_used: number; credits: number; version: number };

/** Created once per isolate; every statement is IF NOT EXISTS, so concurrent first calls are harmless. */
let tablesReady = false;
async function ensureTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  tablesReady = true;
}

const toAccount = (r: Row): Account => ({
  day: r.day, freeUsed: r.free_used,
  plan: r.plan_until > 0 ? { until: r.plan_until, allowance: r.plan_allowance, used: r.plan_used } : null,
  credits: r.credits,
});

/** The day's free allowance starts again each UTC day; normalize on read without writing. */
const normalized = (a: Account, now = Date.now()): Account =>
  a.day === today(now) ? a : { ...a, day: today(now), freeUsed: 0 };

const COLS = "user_id, day, free_used, plan_until, plan_allowance, plan_used, credits";

/** The account row, creating it on first sight. A leftover KV balance is adopted once, then the KV key is dropped. */
async function loadAccount(env: Env, uid: number): Promise<{ account: Account; version: number }> {
  await ensureTables(env);
  const id = String(uid);
  let row: Row | null = await env.DB.prepare(`SELECT ${COLS}, version FROM accounts WHERE user_id = ?`).bind(id).first<Row>();
  if (!row) {
    const kv = (await env.SUBS.get(`acct:${uid}`, "json")) as Account | null;
    const a = kv ?? emptyAccount();
    row = await env.DB.prepare(
      `INSERT INTO accounts (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET user_id = excluded.user_id RETURNING ${COLS}, version`)
      .bind(id, a.day, a.freeUsed, a.plan?.until ?? 0, a.plan?.allowance ?? 0, a.plan?.used ?? 0, a.credits)
      .first<Row>();
    if (kv) await env.SUBS.delete(`acct:${uid}`).catch(() => null);
    row ??= await env.DB.prepare(`SELECT ${COLS}, version FROM accounts WHERE user_id = ?`).bind(id).first<Row>();
  }
  if (!row) throw new Error("account missing");
  return { account: normalized(toAccount(row)), version: row.version };
}

/**
 * Run fn against the current account and write the result back only if nobody else changed
 * it meanwhile; retry a few times on contention. The fn stays pure (see billing.mjs), so a
 * retry simply recomputes against the newer account.
 */
async function transact(env: Env, uid: number, fn: (a: Account) => Account, tries = 5): Promise<Account> {
  for (let i = 0; i < tries; i++) {
    const { account, version } = await loadAccount(env, uid);
    const next = fn(account);
    const r = await env.DB.prepare(
      `UPDATE accounts SET day = ?, free_used = ?, plan_until = ?, plan_allowance = ?, plan_used = ?, credits = ?, version = version + 1
       WHERE user_id = ? AND version = ?`)
      .bind(next.day, next.freeUsed, next.plan?.until ?? 0, next.plan?.allowance ?? 0, next.plan?.used ?? 0, next.credits, String(uid), version)
      .run();
    if (Number(r.meta.changes ?? 0) > 0) return next;
  }
  throw new Error("billing contention");
}

export async function account(env: Env, uid: number): Promise<Account> {
  return (await loadAccount(env, uid)).account;
}

/** The units an average answer uses lately, for showing a balance as "about N questions". */
export async function averageUnits(env: Env): Promise<number> {
  await ensureTables(env);
  for (const day of [today(), today(Date.now() - 86400000)]) {
    const d = await env.DB.prepare("SELECT questions, units FROM usage_daily WHERE day = ?").bind(day).first<{ questions: number; units: number }>();
    if (d && d.questions >= 3) return Math.round(d.units / d.questions);
  }
  return 60000;
}

export type Standing = { ok: boolean; unlimited: boolean; balance: Balance; perQuestion: number };
/** May this person ask now? Admins always may; everyone else while any allowance is left. */
export async function standing(env: Env, uid: number): Promise<Standing> {
  const p = prices(env);
  const b = balance(await account(env, uid), p);
  const unlimited = isAdmin(env, uid);
  return { ok: unlimited || b.total > 0, unlimited, balance: b, perQuestion: await averageUnits(env) };
}

/** Charges an answer to the person and adds it to the day's totals. */
export async function charge(env: Env, uid: number, units: number): Promise<Balance> {
  const p = prices(env);
  const deduct = billingOn(env) && !isAdmin(env, uid);
  const next = deduct ? await transact(env, uid, (a) => spend(a, units, p)) : await account(env, uid);
  await recordUsage(env, uid, units);
  return balance(next, p);
}

/**
 * Reserve the minimum up front for a metered answer (Claude with billing on). The gate is
 * the reservation itself: no balance, no request. The returned take (what came from each
 * pot) settles the request at the end against the actual units, so an abandoned or failed
 * stream cannot spend the model's work for free — and a concurrent request cannot have its
 * reservation clobbered by the other's settle.
 */
export async function reserveAsk(env: Env, uid: number): Promise<{ ok: false; balance: Balance } | { ok: true; take: Take; balance: Balance }> {
  const p = prices(env);
  const before = await account(env, uid);
  if (balance(before, p).total <= 0) return { ok: false, balance: balance(before, p) };
  const { reserved } = reserve(before, p);
  const take = takeOf(before, reserved);
  const next = await transact(env, uid, () => reserved);
  return { ok: true, take, balance: balance(next, p) };
}

/**
 * Settle a reservation: the actual units are charged against what the reservation took, so
 * metering stays exact, and the day's totals record what the answer used. Settle a failed
 * request for RESERVE_UNITS: the model was still paid for.
 */
export async function settleAsk(env: Env, uid: number, take: Take, actualUnits: number): Promise<Balance> {
  const p = prices(env);
  const next = await transact(env, uid, (a) => settleTake(a, take, actualUnits, p));
  await recordUsage(env, uid, actualUnits);
  return balance(next, p);
}

/** The day's totals of questions and units, kept 120 days for the admins' pricing. */
async function recordUsage(env: Env, uid: number, units: number): Promise<void> {
  await ensureTables(env);
  const day = today();
  const u = Math.max(0, Math.round(units));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO usage_daily (day, questions, units) VALUES (?, 1, ?)
      ON CONFLICT (day) DO UPDATE SET questions = questions + 1, units = units + excluded.units`).bind(day, u),
    env.DB.prepare(`INSERT OR IGNORE INTO usage_people (day, user_id) VALUES (?, ?)`).bind(day, String(uid)),
  ]);
}

/** Usage older than 120 days is pruned by the hourly cron. */
export async function pruneBilling(env: Env): Promise<void> {
  await ensureTables(env);
  const cutoff = today(Date.now() - 120 * 86400000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_daily WHERE day < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM usage_people WHERE day < ?").bind(cutoff),
  ]);
}

/** One day's totals for the admins' usage page. */
export async function usageDay(env: Env, day: string): Promise<{ questions: number; units: number; people: number }> {
  await ensureTables(env);
  const d = await env.DB.prepare("SELECT questions, units FROM usage_daily WHERE day = ?").bind(day).first<{ questions: number; units: number }>();
  const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM usage_people WHERE day = ?").bind(day).first<{ n: number }>();
  return { questions: d?.questions ?? 0, units: d?.units ?? 0, people: p?.n ?? 0 };
}

/** An invoice link for the monthly plan (a Stars subscription that renews itself) or a pack. */
export async function invoiceFor(env: Env, uid: number, item: string): Promise<string> {
  const p = prices(env);
  const api = new Api(env.BOT_TOKEN);
  if (item === "plan") {
    return api.createInvoiceLink("Ask CyberJudah · monthly", `A month of Ask CyberJudah: about ${Math.round(p.plan.units / 60000)} in-depth answers from the library, renewed each month until you cancel.`, payloadOf("plan", uid, p.plan.stars), "", "XTR", [{ label: "Monthly", amount: p.plan.stars }], { subscription_period: 2592000 });
  }
  const stars = Number(/^pack:(\d+)$/.exec(item)?.[1]);
  const pack = p.packs.find((x) => x.stars === stars);
  if (!pack) throw new Error("No such pack");
  return api.createInvoiceLink("Ask CyberJudah · top-up", `About ${Math.round(pack.units / 60000)} in-depth answers from the library. The credit does not expire.`, payloadOf("pack", uid, pack.stars), "", "XTR", [{ label: "Top-up", amount: pack.stars }]);
}

/** Before Telegram takes the Stars: is this a real item at its real price, for this person? */
export function checkout(env: Env, payload: string, currency: string, amount: number, from: number): boolean {
  // Support is a fixed tier at its face value, for the giver: the invoice was made by the
  // bot, but the shape, the amount and the buyer are checked anyway.
  const s = readSupport(payload);
  if (s) return currency === "XTR" && s.uid === from && s.stars === amount && SUPPORT_STARS.includes(s.stars);
  const b = validPayment(payload, currency, amount, prices(env));
  return !!b && b.uid === from;
}

/**
 * After payment: the plan or the credit granted, once per Telegram charge. The charge id
 * is claimed atomically — two deliveries of the same payment cannot both grant.
 */
export async function applyPayment(env: Env, from: number, pay: { invoice_payload: string; currency: string; total_amount: number; telegram_payment_charge_id: string; subscription_expiration_date?: number }): Promise<"plan" | "pack" | null> {
  const p = prices(env);
  const b = validPayment(pay.invoice_payload, pay.currency, pay.total_amount, p);
  if (!b || b.uid !== from) return null;
  await ensureTables(env);
  const claimed = await env.DB.prepare(
    `INSERT OR IGNORE INTO payments (charge_id, user_id, kind, stars, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(pay.telegram_payment_charge_id, String(from), b.kind, b.stars, Date.now()).run();
  if (Number(claimed.meta.changes ?? 0) === 0) return b.kind;
  await transact(env, from, (a) => b.kind === "plan" ? grantPlan(a, p, (pay.subscription_expiration_date ?? 0) * 1000) : grantPack(a, b.stars, p));
  return b.kind;
}
