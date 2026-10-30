import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import { grantPayment, refundPayment, type Owner } from "./credits";
import { keyedHash } from "./privacy.mjs";
import { mcOfUsd } from "../../shared/credits.mjs";

/**
 * Prepaid Ask credit packs bought in the app through Apple or Google, tracked by RevenueCat.
 * Nothing renews: each pack is a one-time (consumable) purchase, so nothing is ever charged on a
 * Sabbath, feast or New Moon by itself.
 *
 * - The app logs in to RevenueCat with `purchaseId`, a keyed hash of its Firebase UID: RevenueCat
 *   never sees the UID, and the webhook's app_user_id names the balance directly (owner `app:<id>`).
 * - A pack adds its price minus the store's cut (ASK_STORE_FEE, 0.15) to that balance, once per
 *   store transaction (credits.ts grantPayment), so the owner never pays the fee.
 * - A refund takes back what the pack added and is still unspent (refundPayment).
 * - The webhook is accepted only with RevenueCat's authorization header (REVENUECAT_WEBHOOK_AUTH,
 *   a Worker secret the owner sets in both places). Sandbox purchases count only where
 *   REVENUECAT_SANDBOX is "on" (staging).
 */
export type Pack = { id: string; usd: number; credits_mc: number };

export const storeFee = (env: Env) => {
  const f = Number(env.ASK_STORE_FEE ?? 0.15);
  return Number.isFinite(f) && f >= 0 && f < 1 ? f : 0.15;
};

/** ASK_APP_PACKS: "product_id:price_usd,…". A product not listed here is never credited. */
export function packs(env: Env): Pack[] {
  const fee = storeFee(env);
  return String(env.ASK_APP_PACKS ?? "").split(",").map((s) => s.trim()).filter(Boolean).flatMap((entry) => {
    const [id, price] = entry.split(":");
    const usd = Number(price);
    if (!id || !/^[\w.-]{1,100}$/.test(id) || !Number.isFinite(usd) || usd <= 0 || usd > 200) return [];
    return [{ id, usd, credits_mc: mcOfUsd(Math.floor(usd * (1 - fee) * 100) / 100) }];
  });
}

export const purchasesOn = (env: Env) => env.ASK_PURCHASES === "on";
export const purchaseIdOf = (env: Env, uid: string): Promise<string> => keyedHash(env, "revenuecat", uid);
export const appOwner = (purchaseId: string): Owner => `app:${purchaseId}`;

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

type RcEvent = { id?: string; type?: string; app_user_id?: string; product_id?: string; transaction_id?: string; original_transaction_id?: string; environment?: string; cancel_reason?: string; store?: string };

export type Outcome = "credited" | "already" | "refunded" | "ignored";

/** One RevenueCat event applied to the balances. Unknown events and products are ignored, never guessed at. */
export async function applyEvent(env: Env, e: RcEvent): Promise<Outcome> {
  if (!e || typeof e !== "object") return "ignored";
  if (e.environment === "SANDBOX" && env.REVENUECAT_SANDBOX !== "on") return "ignored";
  const user = String(e.app_user_id ?? "");
  const txn = String(e.transaction_id ?? e.original_transaction_id ?? "");
  // Only the app's own purchase ids (a 64-hex keyed hash), never RevenueCat's anonymous ids.
  if (!/^[0-9a-f]{64}$/.test(user) || !/^[\w.:-]{1,128}$/.test(txn)) return "ignored";
  const owner = appOwner(user);
  const charge = `rc:${String(e.store ?? "store").toLowerCase().replace(/[^a-z_]/g, "")}:${txn}`;
  if (e.type === "NON_RENEWING_PURCHASE") {
    const pack = packs(env).find((p) => p.id === e.product_id);
    if (!pack) { console.error(JSON.stringify({ event: "revenuecat_unknown_product", product: String(e.product_id ?? "").slice(0, 100) })); return "ignored"; }
    return (await grantPayment(env, owner, { charge, kind: "pack", stars: 0, mc: pack.credits_mc })) ? "credited" : "already";
  }
  // RevenueCat reports a store refund of a one-time purchase as a cancellation by customer support.
  if (e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT") {
    return (await refundPayment(env, owner, charge)) ? "refunded" : "ignored";
  }
  return "ignored";
}

export const revenuecat = new Hono<{ Bindings: Env }>();
revenuecat.use("*", bodyLimit({ maxSize: 64_000, onError: (c) => c.json({ error: "too-large" }, 413) }));
revenuecat.post("/webhook", async (c) => {
  const secret = c.env.REVENUECAT_WEBHOOK_AUTH;
  if (!secret) return c.json({ error: "unavailable" }, 503);
  if (!sameSecret(c.req.header("authorization") ?? "", secret)) return c.json({ error: "unauthorized" }, 401);
  let body: { event?: RcEvent };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad-request" }, 400); }
  // A failure here answers 500, so RevenueCat delivers the event again; every write is once per charge.
  const outcome = await applyEvent(c.env, body?.event ?? {});
  console.log(JSON.stringify({ event: "revenuecat_webhook", type: String(body?.event?.type ?? "").slice(0, 40), outcome }));
  return c.json({ ok: true, outcome });
});
