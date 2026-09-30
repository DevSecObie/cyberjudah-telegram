import { Api } from "grammy";

import type { Env } from "./env";
import { balance, emptyAccount, grantPack, grantPlan, payloadOf, pricing, readSupport, reserve, RESERVE_UNITS, spend, SUPPORT_STARS, today, validPayment, type Account, type Balance, type Pricing } from "./billing.mjs";
export { RESERVE_UNITS, SUPPORT_STARS };
import { isAdmin } from "./edit";

/**
 * The person's allowance for Ask CyberJudah, kept in KV as `acct:<user>`: today's free use,
 * the monthly plan paid in Stars, and the credit from top-up packs. Every answer is charged
 * what it used; `usage:<day>` sums the day's questions and units for the admins to price by.
 */
const key = (uid: number) => `acct:${uid}`;
export const prices = (env: Env): Pricing => pricing(env as unknown as Record<string, unknown>);
/**
 * Charging is switched on by ASK_BILLING="on" once the prices are checked. Until then every
 * answer is still measured (so /api/admin/usage shows the real cost), nobody is charged, and
 * the old daily cap applies.
 */
export const billingOn = (env: Env) => Boolean(env.ANTHROPIC_API_KEY) && env.ASK_BILLING === "on";

export async function account(env: Env, uid: number): Promise<Account> {
  return ((await env.SUBS.get(key(uid), "json")) as Account | null) ?? emptyAccount();
}

/** The units an average answer uses lately, for showing a balance as "about N questions". */
export async function averageUnits(env: Env): Promise<number> {
  const d = (await env.SUBS.get(`usage:${today()}`, "json")) as { questions: number; units: number } | null
    ?? (await env.SUBS.get(`usage:${today(Date.now() - 86400000)}`, "json")) as { questions: number; units: number } | null;
  return d && d.questions >= 3 ? Math.round(d.units / d.questions) : 60000;
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
  const next = deduct ? spend(await account(env, uid), units, p) : await account(env, uid);
  if (deduct) await env.SUBS.put(key(uid), JSON.stringify(next));
  await recordUsage(env, uid, units);
  return balance(next, p);
}

/**
 * Reserve the minimum up front for a metered answer (Claude with billing on). The gate is
 * the reservation itself: no balance, no request. The snapshot is settled at the end of the
 * request against the actual units, so an abandoned or failed stream cannot spend for free.
 */
export async function reserveAsk(env: Env, uid: number): Promise<{ ok: false; balance: Balance } | { ok: true; before: Account; balance: Balance }> {
  const p = prices(env);
  const { before, reserved } = reserve(await account(env, uid), p);
  const b = balance(reserved, p);
  if (balance(before, p).total <= 0) return { ok: false, balance: b };
  await env.SUBS.put(key(uid), JSON.stringify(reserved));
  return { ok: true, before, balance: b };
}

/**
 * Settle a reservation: the actual units are charged against the pre-request snapshot, so
 * metering stays exact, and the day's totals record what the answer used. Settle a failed
 * request for RESERVE_UNITS: the model was still paid for.
 */
export async function settleAsk(env: Env, uid: number, before: Account, actualUnits: number): Promise<Balance> {
  const p = prices(env);
  const next = spend(before, actualUnits, p);
  await env.SUBS.put(key(uid), JSON.stringify(next));
  await recordUsage(env, uid, actualUnits);
  return balance(next, p);
}

/** The day's totals of questions and units, kept 120 days for the admins' pricing. */
async function recordUsage(env: Env, uid: number, units: number): Promise<void> {
  const dayKey = `usage:${today()}`;
  const d = ((await env.SUBS.get(dayKey, "json")) as { questions: number; units: number; people: number[] } | null) ?? { questions: 0, units: 0, people: [] };
  d.questions += 1; d.units += Math.round(units); if (!d.people.includes(uid) && d.people.length < 5000) d.people.push(uid);
  await env.SUBS.put(dayKey, JSON.stringify(d), { expirationTtl: 120 * 86400 });
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

/** After payment: the plan or the credit granted, once per Telegram charge. */
export async function applyPayment(env: Env, from: number, pay: { invoice_payload: string; currency: string; total_amount: number; telegram_payment_charge_id: string; subscription_expiration_date?: number }): Promise<"plan" | "pack" | null> {
  const p = prices(env);
  const b = validPayment(pay.invoice_payload, pay.currency, pay.total_amount, p);
  if (!b || b.uid !== from) return null;
  const seen = `paid:${pay.telegram_payment_charge_id}`;
  if (await env.SUBS.get(seen)) return b.kind;
  const acct = await account(env, from);
  const next = b.kind === "plan" ? grantPlan(acct, p, (pay.subscription_expiration_date ?? 0) * 1000) : grantPack(acct, b.stars, p);
  await env.SUBS.put(key(from), JSON.stringify(next));
  await env.SUBS.put(seen, "1", { expirationTtl: 400 * 86400 });
  return b.kind;
}
