import { expect, test, type APIRequestContext } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { STAND_IN, type Logged } from "./stand-ins";
import { pid } from "../../bot/src/privacy.mjs";

/**
 * Donations ("Support CyberJudah", bot/src/billing.ts) against the real local Worker and its D1:
 * GET /api/donations is public and reports the presets, the amount bounds and the holy-days pause;
 * POST /api/invoice makes a Stars invoice for any amount within those bounds; a gift pauses the
 * same way an Ask top-up does; and a completed payment, delivered through the bot's real webhook,
 * is recorded once per Telegram charge under the giver's pseudonymous id, never added to the Ask
 * credit balance. The Mini App screen itself is built separately; this exercises the API it calls.
 */
const BOT_TOKEN = process.env.BOT_TOKEN!;
const WEBHOOK = "e2e-webhook-secret";
const RUN = 800000 + crypto.randomInt(1e9);
const sign = (id: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const auth = (n: number) => ({ authorization: `tma ${sign(RUN + n)}` });
const owner = (n: number) => pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + n);
const d1 = (sql: string) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--json", "--command", sql], { cwd: new URL("../../bot/", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].results as Record<string, number | string | null>[];
// credit_lots is created on first use (CREATE TABLE IF NOT EXISTS, bot/src/credits.ts): if a gift
// never touched the balance, this run's Worker may never have created it at all.
const books = async (n: number) => {
  const has = d1("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credit_lots'");
  if (!has.length) return 0;
  return d1(`SELECT COALESCE(SUM(remaining_mc), 0) AS mc FROM credit_lots WHERE user_id = '${await owner(n)}'`)[0].mc;
};
/** A Telegram update to the bot's webhook, as Telegram sends it. */
const update = (request: APIRequestContext, message: Record<string, unknown>) =>
  request.post("/webhook", { headers: { "x-telegram-bot-api-secret-token": WEBHOOK }, data: { update_id: crypto.randomInt(1e9), message: { message_id: crypto.randomInt(1e6), date: Math.floor(Date.now() / 1000), chat: { id: 1, type: "private" }, ...message } } });
const gift = (n: number, stars: number, charge: string, tz = "America/New_York") =>
  ({ from: { id: RUN + n, is_bot: false, first_name: "Test" }, successful_payment: { currency: "XTR", total_amount: stars, invoice_payload: `support:${RUN + n}:${stars}:${tz}`, telegram_payment_charge_id: charge, provider_payment_charge_id: "" } });
/** Friday 30 October 2026 at 9:30 pm in New York, after full dark: the Sabbath has begun there. */
const FRIDAY_NIGHT = "2026-10-31T01:30:00Z";
/** The Wednesday before, at noon: an ordinary day. */
const WEDNESDAY = "2026-10-28T16:00:00Z";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

test("GET /api/donations is public and reports the presets, the bounds, and no pause on an ordinary day", async ({ request }) => {
  const r = await request.get("/api/donations?tz=America/New_York", { headers: { "x-e2e-now": WEDNESDAY } });
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ open: true, presets: [50, 100, 500], minStars: 1, maxStars: null, donationUrl: null, pause: null });
});

test("during the Sabbath GET /api/donations reports the pause, and the server makes no invoice", async ({ request }) => {
  const paused = await request.get("/api/donations?tz=America/New_York", { headers: { "x-e2e-now": FRIDAY_NIGHT } });
  expect((await paused.json()).pause).toEqual({ kind: "sabbath", until: expect.any(Number), message: "Giving pauses for the Sabbath — it opens again after dark on Saturday" });
  const refused = await request.post("/api/invoice", { headers: { ...auth(1), "x-e2e-now": FRIDAY_NIGHT }, data: { stars: 100, tz: "America/New_York" } });
  expect(refused.status()).toBe(423);
  const body = await refused.json();
  expect(body.error).toBe("paused");
  expect(body.pause.message).toBe("Giving pauses for the Sabbath — it opens again after dark on Saturday");
  // After full dark on Saturday it is back.
  const open = await request.get("/api/donations?tz=America/New_York", { headers: { "x-e2e-now": "2026-11-01T01:30:00Z" } });
  expect((await open.json()).pause).toBeNull();
});

test("POST /api/invoice requires sign-in, and makes a Stars invoice for any amount within bounds", async ({ request }) => {
  expect((await request.post("/api/invoice", { data: { stars: 100 } })).status()).toBe(401);
  const t0 = Date.now();
  const r = await request.post("/api/invoice", { headers: { ...auth(2), "x-e2e-now": WEDNESDAY }, data: { stars: 250, tz: "America/New_York" } });
  expect(r.status()).toBe(200);
  expect((await r.json()).link).toMatch(/^https:\/\//);
  const made = ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= t0 && e.path.endsWith("/createInvoiceLink"));
  expect(made).toHaveLength(1);
  const inv = made[0].body as { payload: string; currency: string; prices: { amount: number }[] };
  expect([inv.currency, inv.prices[0].amount, inv.payload]).toEqual(["XTR", 250, `support:${RUN + 2}:250:America/New_York`]);
});

test("an amount of zero, or one that is not a whole number, is refused as bad-amount", async ({ request }) => {
  for (const stars of [0, -5, 1.5]) {
    const r = await request.post("/api/invoice", { headers: { ...auth(3), "x-e2e-now": WEDNESDAY }, data: { stars, tz: "America/New_York" } });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBe("bad-amount");
  }
});

test("a completed gift is recorded once per Telegram charge, under the giver's pseudonymous id, and never added to the Ask balance", async ({ request }) => {
  const id = await owner(4);
  for (let i = 0; i < 2; i++) expect((await update(request, gift(4, 100, `e2e-gift-${RUN}`))).ok()).toBe(true);
  const rows = d1(`SELECT user_id, stars FROM donations WHERE user_id = '${id}'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].stars).toBe(100);
  expect(rows[0].user_id).not.toBe(String(RUN + 4));
  // A gift never touches the Ask credit balance.
  expect(await books(4)).toBe(0);
});
