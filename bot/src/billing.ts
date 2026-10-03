import { telegramApi } from "./telegram-api";

import type { Env } from "./env";
import { payloadOf, readPayload, readSupport, SUPPORT_STARS, validPayment } from "./billing.mjs";
export { SUPPORT_STARS };
import { creditsConfig, creditsRecord, deleteCredits, grantPayment, markPlanCancelled, ownerOfUser, refundPayment, sweepHolds, wallet } from "./credits";
import { fmtCredits, MC } from "../../shared/credits.mjs";
import { pid } from "./privacy.mjs";

/**
 * Paying for Ask CyberJudah with Telegram Stars: the monthly plan (a Stars subscription that
 * renews itself) and top-ups, each giving the credits shared/credits.mjs prices. The balance,
 * its ledger and what each answer is charged are in credits.ts. This file is the edge with
 * Telegram: invoices, the check before Stars are taken, fulfilment after, refunds and cancelling.
 */
export const billingOn = (env: Env) => env.ASK_BILLING === "on";

/** Credits a plan payment of this many Stars gives (with the plan's bonus), and a top-up. From what was paid, so a renewal at an older price gets what it paid for. */
const planMc = (env: Env, stars: number) => { const c = creditsConfig(env); return Math.floor(stars * c.creditsPerStar * (1 + c.planBonus) + 1e-6) * MC; };
const packMc = (env: Env, stars: number) => { const c = creditsConfig(env); return Math.floor(stars * c.creditsPerStar + 1e-6) * MC; };

/**
 * An invoice link for the monthly plan or a top-up. New sales wait until the pricing is complete
 * and confirmed (creditConfig `missing`): until then this says what is missing rather than sell.
 */
export async function invoiceFor(env: Env, uid: number, item: string): Promise<{ ok: true; link: string } | { ok: false; missing: string[] }> {
  const c = creditsConfig(env);
  if (c.missing.length) return { ok: false, missing: c.missing };
  const api = telegramApi(env);
  if (item === "plan") {
    const credits = fmtCredits(c.plan.mc);
    return { ok: true, link: await api.createInvoiceLink("Ask CyberJudah · monthly", `${credits} credits each month for Ask CyberJudah. Renews monthly until you cancel. Each month's credits expire at the next renewal; unused ones do not carry over.`, payloadOf("plan", uid, c.plan.stars), "", "XTR", [{ label: "Monthly", amount: c.plan.stars }], { subscription_period: 2592000 }) };
  }
  const stars = Number(/^pack:(\d+)$/.exec(item)?.[1]);
  const pack = c.packs.find((x) => x.stars === stars);
  if (!pack) throw new Error("No such pack");
  return { ok: true, link: await api.createInvoiceLink("Ask CyberJudah · credits", `${fmtCredits(pack.mc)} credits for Ask CyberJudah. Top-up credits never expire.`, payloadOf("pack", uid, pack.stars), "", "XTR", [{ label: "Credits", amount: pack.stars }]) };
}

/** Before Telegram takes the Stars: is this a real item at its real price, for this person? */
export function checkout(env: Env, payload: string, currency: string, amount: number, from: number): boolean {
  // Support is a fixed tier at its face value, for the giver: the invoice was made by the
  // bot, but the shape, the amount and the buyer are checked anyway.
  const s = readSupport(payload);
  if (s) return currency === "XTR" && s.uid === from && s.stars === amount && SUPPORT_STARS.includes(s.stars);
  const c = creditsConfig(env);
  if (c.missing.length) return false;
  const b = validPayment(payload, currency, amount, c);
  return !!b && b.uid === from;
}

type Paid = { invoice_payload: string; currency: string; total_amount: number; telegram_payment_charge_id: string; subscription_expiration_date?: number; is_recurring?: boolean; is_first_recurring?: boolean };
/**
 * After payment: the credits granted, once per Telegram charge (credits.ts grantPayment). The
 * Stars are already taken by now, so a payment is honoured by what was actually paid even if the
 * prices changed meanwhile (a renewal at an older price); only its shape, currency, amount and
 * buyer must be right.
 */
export async function applyPayment(env: Env, from: number, pay: Paid): Promise<{ kind: "plan" | "pack"; mc: number; renewal: boolean } | null> {
  const b = readPayload(pay.invoice_payload);
  if (!b || b.uid !== from || pay.currency !== "XTR" || pay.total_amount !== b.stars) return null;
  const owner = await ownerOfUser(env, from);
  const renewal = b.kind === "plan" && !!pay.is_recurring && !pay.is_first_recurring;
  const mc = b.kind === "plan" ? planMc(env, b.stars) : packMc(env, b.stars);
  const expiresAt = b.kind === "plan" ? ((pay.subscription_expiration_date ?? 0) * 1000 > Date.now() ? (pay.subscription_expiration_date ?? 0) * 1000 : Date.now() + 30 * 86400000) : null;
  await grantPayment(env, owner, { charge: pay.telegram_payment_charge_id, kind: b.kind, stars: b.stars, mc, expiresAt, renewal, tgUser: from });
  return { kind: b.kind, mc, renewal };
}

/** Telegram refunded a payment (Telegram's refunded_payment, or the admins through refundStarPayment): its unspent credits leave the balance. */
export async function applyRefund(env: Env, from: number, charge: string) {
  return refundPayment(env, await ownerOfUser(env, from), charge);
}

/** An admin's refund: the Stars go back through Telegram, then the payment's unspent credits leave the balance. */
export async function refundStars(env: Env, user: number, charge: string) {
  await telegramApi(env).refundStarPayment(user, charge);
  return applyRefund(env, user, charge);
}

/** The reader cancels the plan from the app: Telegram stops renewing it; this month's credits stay until their date. */
export async function cancelPlan(env: Env, uid: number): Promise<boolean> {
  const plan = await markPlanCancelled(env, await ownerOfUser(env, uid));
  if (!plan) return false;
  await telegramApi(env).editUserStarSubscription(plan.tg, plan.charge, true);
  return true;
}

/**
 * Hourly (docs/PRIVACY.md): holds a request never settled are released (not charged); the old
 * allowance's day totals go after 120 days, who asked on a day after 30. The old `accounts` rows
 * are kept as they were: they are the record the credits were carried over from.
 */
export async function pruneBilling(env: Env): Promise<void> {
  await sweepHolds(env);
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_daily'").first();
  if (!has) return;
  const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_daily WHERE day < ?").bind(day(120)),
    env.DB.prepare("DELETE FROM usage_people WHERE day < ?").bind(day(30)),
  ]);
}

/**
 * Delete my data: the balance, its history and the old allowance record go. A payment record
 * keeps only the Telegram charge ID, kind, amount and date, no longer linked to the person:
 * Telegram's refund process and the owner's accounts need those (docs/PRIVACY.md).
 */
export async function deleteBilling(env: Env, uid: number): Promise<{ credits: number; planUntil: number | null; planCancelled: boolean }> {
  const id = await pid(env, uid);
  // A running plan is cancelled first, so it does not renew for a balance that is gone.
  const planUntil = (await wallet(env, id)).plan?.renews_at ?? null;
  const planCancelled = planUntil ? await cancelPlan(env, uid).catch(() => false) : false;
  const left = await deleteCredits(env, id);
  const stmts = [env.DB.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ? OR user_id = ?").bind(id, String(uid))];
  for (const t of ["accounts", "usage_people"]) {
    if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(t).first()) stmts.push(env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ? OR user_id = ?`).bind(id, String(uid)));
  }
  await env.DB.batch(stmts).catch(() => null);
  await env.SUBS.delete(`acct:${uid}`).catch(() => null);
  return { credits: left.total_mc / MC, planUntil, planCancelled };
}

/** What is kept for this person, for "Download my data". Read only. */
export async function billingRecord(env: Env, uid: number) {
  const id = await pid(env, uid);
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first();
  const pays = has ? await env.DB.prepare("SELECT kind, stars, created_at FROM payments WHERE user_id = ? ORDER BY created_at").bind(id).all<{ kind: string; stars: number; created_at: number }>() : { results: [] };
  return { credits: await creditsRecord(env, id), payments: (pays.results ?? []).map((r) => ({ kind: r.kind, stars: r.stars, at: new Date(r.created_at).toISOString() })) };
}
