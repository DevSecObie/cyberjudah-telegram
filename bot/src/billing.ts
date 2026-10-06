import { telegramApi } from "./telegram-api";

import type { Env } from "./env";
import { donationAmountValid, donationsConfig, payloadOf, readPayload, readSupport, SUPPORT_STARS, supportPayloadOf, validPayment } from "./billing.mjs";
export { donationsConfig, SUPPORT_STARS, supportPayloadOf };
import { creditsConfig, creditsRecord, deleteCredits, grantPayment, ownerOfUser, refundPayment, sweepHolds } from "./credits";
import { fmtUsd, mcOfStars, MC_PER_USD } from "../../shared/credits.mjs";
import { DEFAULT_ZONE, givingPauseMessage, pauseMessage, topupPause, zoneOf, type Pause } from "../../shared/holy-days.mjs";
import { pid } from "./privacy.mjs";

/**
 * Paying for Ask CyberJudah with Telegram Stars: top-ups of a few dollars, each adding to the
 * reader's balance exactly what the owner receives for its Stars (shared/credits.mjs). The
 * balance, its ledger and what each answer is charged are in credits.ts. This file is the edge
 * with Telegram: invoices, the check before Stars are taken, adding a payment after, refunds.
 *
 * No top-up is sold from full dark before a Sabbath, feast day or New Moon to full dark at its
 * end, where the reader is (shared/holy-days.mjs): no invoice is made, and a checkout already
 * open is refused. A balance already held is used as on any day.
 */
export const billingOn = (env: Env) => env.ASK_BILLING === "on";

export type InvoiceResult = { ok: true; link: string } | { ok: false; reason: "closed"; missing: string[] } | { ok: false; reason: "pause"; pause: Pause; message: string };
/**
 * An invoice link for a top-up (`pack:<stars>`, one of creditConfig's top-ups), unless pricing is
 * incomplete or top-ups are paused where the reader is now. The reader's zone goes in the payload,
 * so the check before payment can tell the same.
 */
export async function invoiceFor(env: Env, uid: number, item: string, tz: string, now = Date.now()): Promise<InvoiceResult> {
  const c = creditsConfig(env);
  if (c.missing.length) return { ok: false, reason: "closed", missing: c.missing };
  const pause = topupPause(now, tz);
  if (pause) return { ok: false, reason: "pause", pause, message: pauseMessage(pause) };
  const stars = Number(/^pack:(\d+)$/.exec(item)?.[1]);
  const t = c.topups.find((x) => x.stars === stars);
  if (!t) throw new Error("No such top-up");
  const link = await telegramApi(env).createInvoiceLink(
    `Ask CyberJudah · ${fmtUsd(t.usd * MC_PER_USD)} top-up`,
    `Adds ${fmtUsd(t.mc, { floor: true })} to your Ask CyberJudah balance: what CyberJudah receives for ${t.stars} Stars after Telegram's share. Answers are charged only what they cost; CyberJudah makes no profit. Your balance never expires.`,
    payloadOf("pack", uid, t.stars, zoneOf(tz)), "", "XTR", [{ label: "Top-up", amount: t.stars }],
  );
  return { ok: true, link };
}

export type DonationInvoiceResult = { ok: true; link: string } | { ok: false; reason: "closed" } | { ok: false; reason: "bad-amount" } | { ok: false; reason: "pause"; pause: Pause; message: string };
/**
 * An invoice link for a gift of the giver's own chosen amount of Stars (any amount within
 * donationsConfig's bounds, or one of its presets), unless donations are off, the amount is out
 * of bounds, or giving is paused where the giver is now. The giver's zone goes in the payload, so
 * the check before payment can tell the same.
 */
export async function invoiceForDonation(env: Env, uid: number, stars: number, tz: string, now = Date.now()): Promise<DonationInvoiceResult> {
  const cfg = donationsConfig(env);
  if (!cfg.on) return { ok: false, reason: "closed" };
  if (!donationAmountValid(stars, cfg)) return { ok: false, reason: "bad-amount" };
  const pause = topupPause(now, tz);
  if (pause) return { ok: false, reason: "pause", pause, message: givingPauseMessage(pause) };
  const link = await telegramApi(env).createInvoiceLink(
    "Support CyberJudah", "Keep the library free and the classes online. Thank you.",
    supportPayloadOf(uid, stars, zoneOf(tz)), "", "XTR", [{ label: "Support CyberJudah", amount: stars }],
  );
  return { ok: true, link };
}

/**
 * Before Telegram takes the Stars: is this a real top-up or donation at its real price, for this
 * person, and not during a Sabbath, feast day or New Moon where they are? `message` is what
 * Telegram shows the reader when it is refused.
 */
export function checkout(env: Env, payload: string, currency: string, amount: number, from: number, now = Date.now()): { ok: true } | { ok: false; message: string } {
  const changed = { ok: false as const, message: "This item or price has changed. Open Ask CyberJudah and try again." };
  // A donation (support) invoice: the shape, the amount and the giver are checked, and — like a
  // top-up — none is sold during a Sabbath, feast day or New Moon where the giver is. An invoice
  // made outside the Mini App (the /support bot command) carries no zone, so it falls back to
  // DEFAULT_ZONE.
  const s = readSupport(payload);
  if (s) {
    if (currency !== "XTR" || s.uid !== from || s.stars !== amount) return changed;
    const dc = donationsConfig(env);
    if (!dc.on || !donationAmountValid(s.stars, dc)) return changed;
    const pause = topupPause(now, s.tz ?? DEFAULT_ZONE);
    if (pause) return { ok: false, message: givingPauseMessage(pause) };
    return { ok: true };
  }
  const c = creditsConfig(env);
  if (c.missing.length) return changed;
  const b = validPayment(payload, currency, amount, c);
  if (!b || b.uid !== from) return changed;
  const pause = topupPause(now, b.tz);
  if (pause) return { ok: false, message: `${pauseMessage(pause)}. Your balance can still be used meanwhile.` };
  return { ok: true };
}

type Paid = { invoice_payload: string; currency: string; total_amount: number; telegram_payment_charge_id: string; is_recurring?: boolean };
/**
 * After payment: the Stars are added to the balance once per Telegram charge, at what the owner
 * receives for them (credits.ts grantPayment). The Stars are already taken by now, so a payment is
 * honoured by what was actually paid even if the prices changed meanwhile; only its shape,
 * currency, amount and buyer must be right.
 *
 * A monthly plan bought before plans were withdrawn can still renew: its Stars are added to the
 * balance the same way, and the subscription is cancelled with Telegram so it does not renew again.
 */
export async function applyPayment(env: Env, from: number, pay: Paid): Promise<{ kind: "plan" | "pack"; mc: number } | null> {
  const b = readPayload(pay.invoice_payload);
  if (!b || b.uid !== from || pay.currency !== "XTR" || pay.total_amount !== b.stars) return null;
  const c = creditsConfig(env);
  const mc = mcOfStars(b.stars, c.usdPerStar, c.margin);
  await grantPayment(env, await ownerOfUser(env, from), { charge: pay.telegram_payment_charge_id, kind: b.kind, stars: b.stars, mc });
  if (b.kind === "plan") {
    await telegramApi(env).editUserStarSubscription(from, pay.telegram_payment_charge_id, true)
      .catch((e: Error) => console.error(JSON.stringify({ event: "plan_cancel_failed", message: e.message?.slice(0, 160) })));
  }
  return { kind: b.kind, mc };
}

/**
 * After payment: a gift is recorded once per Telegram charge, in its own ledger — a donation
 * never touches the Ask credit balance (credit_lots, credit_ledger). Returns the Stars given, or
 * null when the payload is not a donation.
 */
export async function applyDonation(env: Env, from: number, pay: Paid): Promise<{ stars: number } | null> {
  const s = readSupport(pay.invoice_payload);
  if (!s || s.uid !== from || pay.currency !== "XTR" || pay.total_amount !== s.stars) return null;
  // Keyed by the giver's pseudonymous id (pid), the same as payments and credit_ledger: never the raw Telegram id.
  const owner = await ownerOfUser(env, from);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS donations (charge_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("INSERT OR IGNORE INTO donations (charge_id, user_id, stars, created_at) VALUES (?, ?, ?, ?)").bind(pay.telegram_payment_charge_id, owner, s.stars, Date.now()),
  ]);
  return { stars: s.stars };
}

/** Telegram refunded a payment (Telegram's refunded_payment, or the admins through refundStarPayment): what it added and is still unspent leaves the balance. */
export async function applyRefund(env: Env, from: number, charge: string) {
  return refundPayment(env, await ownerOfUser(env, from), charge);
}

/** An admin's refund: the Stars go back through Telegram, then what that payment added and is unspent leaves the balance. */
export async function refundStars(env: Env, user: number, charge: string) {
  await telegramApi(env).refundStarPayment(user, charge);
  return applyRefund(env, user, charge);
}

/**
 * Hourly (docs/PRIVACY.md): holds a request never settled are released (not charged); the old
 * allowance's day totals go after 120 days, who asked on a day after 30. The old `accounts` rows
 * are kept as they were: they are the record the balance was carried over from.
 */
export async function pruneBilling(env: Env): Promise<void> {
  await sweepHolds(env);
  // Per-request telemetry is kept CREDIT_USAGE_RETENTION_DAYS (180); the money trail
  // (credit_ledger) is never pruned here. `at` is ms, and the new index keeps this cheap.
  const keepMs = Math.max(30, Number(env.CREDIT_USAGE_RETENTION_DAYS ?? 180)) * 86400000;
  await env.DB.prepare("DELETE FROM credit_usage WHERE at < ?").bind(Date.now() - keepMs).run().catch(() => null);
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
export async function deleteBilling(env: Env, uid: number): Promise<{ balanceUsd: number }> {
  const id = await pid(env, uid);
  const left = await deleteCredits(env, id);
  const stmts: D1PreparedStatement[] = [];
  // The payments table may not exist before the first payment. Absence is harmless;
  // a failed lookup or cleanup must reach the caller rather than report success.
  if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first()) {
    stmts.push(env.DB.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ? OR user_id = ?").bind(id, String(uid)));
  }
  for (const t of ["accounts", "usage_people"]) {
    if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(t).first()) stmts.push(env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ? OR user_id = ?`).bind(id, String(uid)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await env.SUBS.delete(`acct:${uid}`);
  return { balanceUsd: left.total_mc / MC_PER_USD };
}

/** What is kept for this person, for "Download my data". Read only. */
export async function billingRecord(env: Env, uid: number) {
  const id = await pid(env, uid);
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first();
  const pays = has ? await env.DB.prepare("SELECT kind, stars, created_at FROM payments WHERE user_id = ? ORDER BY created_at").bind(id).all<{ kind: string; stars: number; created_at: number }>() : { results: [] };
  return { balance: await creditsRecord(env, id), payments: (pays.results ?? []).map((r) => ({ kind: r.kind, stars: r.stars, at: new Date(r.created_at).toISOString() })) };
}
