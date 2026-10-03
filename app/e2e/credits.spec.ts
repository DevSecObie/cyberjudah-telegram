import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";
import { pid } from "../../bot/src/privacy.mjs";

/**
 * Ask's credits against the real local Worker and its D1 (bot/src/credits.ts): what a reader is
 * granted, held and charged; payments, renewals, refunds and their repeats through the bot's real
 * webhook; requests at once; failures; the old allowance carried over; and the app's cards.
 * Only Claude is stood in for (e2e/claude.ts: each call reports 1,000 tokens in and 200 out).
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN!;
const WEBHOOK = process.env.E2E_WEBHOOK_SECRET ?? "e2e-webhook-secret";
const RUN = 500000 + crypto.randomInt(1e9);
const OPUS = "anthropic/claude-opus-5";
const initData = (n: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: RUN + n, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const launch = (n: number) => `#tgWebAppData=${encodeURIComponent(initData(n))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
const auth = (n: number) => ({ authorization: `tma ${initData(n)}` });
const owner = (n: number) => pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + n);
const d1 = (sql: string) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--json", "--command", sql], { cwd: new URL("../../bot/", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].results as Record<string, number | string | null>[];
/** The balance two ways: what the lots hold, and the sum of the ledger. They must always agree, and no lot is ever below zero. */
const books = async (n: number) => {
  const id = await owner(n);
  const lots = d1(`SELECT COALESCE(SUM(remaining_mc), 0) AS mc, COALESCE(MIN(remaining_mc), 0) AS low FROM credit_lots WHERE user_id = '${id}'`)[0];
  const ledger = d1(`SELECT COALESCE(SUM(amount_mc), 0) AS mc FROM credit_ledger WHERE user_id = '${id}'`)[0];
  return { lots: Number(lots.mc), ledger: Number(ledger.mc), low: Number(lots.low) };
};
const account = async (request: APIRequestContext, n: number) => (await request.get("/api/ask/account", { headers: auth(n) })).json();
const askApi = (request: APIRequestContext, n: number, q: string, extra: Record<string, unknown> = {}) =>
  request.post("/api/ask", { headers: auth(n), data: { q, stream: true, consent: ["Anthropic"], ...extra } });
const modelCalls = async (request: APIRequestContext, since: number) => ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= since && e.path === "/anthropic/v1/messages").length;
/** A Telegram update to the bot's webhook, as Telegram sends it. */
const update = (request: APIRequestContext, message: Record<string, unknown>) =>
  request.post("/webhook", { headers: { "x-telegram-bot-api-secret-token": WEBHOOK }, data: { update_id: crypto.randomInt(1e9), message: { message_id: crypto.randomInt(1e6), date: Math.floor(Date.now() / 1000), chat: { id: 1, type: "private" }, ...message } } });
const paid = (n: number, kind: "plan" | "pack", stars: number, charge: string, extra: Record<string, unknown> = {}) =>
  ({ from: { id: RUN + n, is_bot: false, first_name: "Test" }, successful_payment: { currency: "XTR", total_amount: stars, invoice_payload: `ask:${kind}:${RUN + n}:${stars}`, telegram_payment_charge_id: charge, provider_payment_charge_id: "", ...extra } });

test.use({ viewport: { width: 390, height: 844 } });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

async function setup(page: Page, caps: Record<string, number> = { [OPUS]: 2000 }) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
  await page.addInitScript((c) => { try { localStorage.setItem("cj:ai-consent", JSON.stringify(["Anthropic"])); localStorage.setItem("cj:ai-limits", JSON.stringify(c)); } catch { /* none */ } }, caps);
}
const ask = async (page: Page, q: string) => { await page.getByRole("textbox", { name: "Your question" }).fill(q); await page.getByRole("button", { name: "Send" }).click(); };
const answer = (page: Page) => page.locator(".msg--ai").last();

test("a new reader gets today's free credits; an answer is charged what it used, shown under it, and the books balance", async ({ page, request }) => {
  await setup(page);
  const a = await account(request, 1);
  expect(a.wallet.free_mc).toBe(a.free_daily_mc);
  expect(a.wallet.lots.map((l: { kind: string }) => l.kind)).toEqual(["daily"]);
  // No answer-count anywhere: the header is the balance in credits.
  await page.goto(`/ask${launch(1)}`);
  await expect(page.locator(".chat2__heading small")).toHaveText(/^[\d,]+ credits · [\d,]+ free today$/);
  await ask(page, "Why keep the Passover?");
  await expect(answer(page)).toContainText("A short answer to: Why keep the Passover?");
  const used = answer(page).locator(".msg__usage");
  await expect(used).toHaveText(/^Used [\d.,<]+ credits? · Usage$/);
  // Charged exactly once, in millicredits, from today's free credits; the books agree.
  const id = await owner(1);
  const u = d1(`SELECT status, held_mc, charged_mc, cost_usd FROM credit_usage WHERE user_id = '${id}'`);
  expect(u).toHaveLength(1);
  expect(u[0].status).toBe("ok");
  expect(Number(u[0].charged_mc)).toBeGreaterThan(0);
  expect(Number(u[0].charged_mc)).toBeLessThanOrEqual(Number(u[0].held_mc));
  // What it cost us, in dollars, is what it was charged in credits (1 credit = $0.001), rounded up to the millicredit.
  expect(Number(u[0].charged_mc)).toBe(Math.ceil(Number(u[0].cost_usd) * 1e6 - 1e-6));
  const b = await books(1);
  expect(b.lots).toBe(b.ledger);
  expect(b.lots).toBe(a.wallet.total_mc - Number(u[0].charged_mc));
  // The usage history lists it.
  await used.getByRole("button", { name: "Usage" }).click();
  await expect(page.getByRole("dialog", { name: "Usage" })).toContainText("Answer · Claude Opus 5");
  await expect(page.getByRole("dialog", { name: "Usage" })).toContainText("Free credits");
});

test("a dearer model asks first, with what it typically and at most uses; the server holds no more than the limit accepted", async ({ page, request }) => {
  await setup(page, {});
  const t0 = Date.now();
  await page.goto(`/ask${launch(2)}`);
  await ask(page, "Who are the twelve tribes?");
  const card = answer(page).locator(".creditcard");
  await expect(card).toContainText(/This may use up to [\d,]+ credits/);
  await expect(card).toContainText(/typically uses about [\d,.]+/);
  await expect(card).toContainText("Credits are used based on the model and work needed for each response. Longer answers and deeper research may use more credits.");
  expect(await modelCalls(request, t0)).toBe(0);
  // Without an accepted limit the server refuses on its own too.
  const refused = await askApi(request, 2, "Who are the twelve tribes?");
  expect(refused.status()).toBe(409);
  await card.getByRole("button", { name: /^Allow up to [\d,]+ and ask$/ }).click();
  await expect(answer(page)).toContainText("A short answer to: Who are the twelve tribes?");
  // A lower accepted limit is the hold.
  await (await askApi(request, 2, "And the Sabbath?", { maxCredits: 30, request: "req-limit-30-xyz" })).text();
  const h = d1("SELECT held_mc FROM credit_holds WHERE request_id = 'req-limit-30-xyz'");
  expect(Number(h[0].held_mc)).toBe(30000);
});

test("not enough credits: no model is called, nothing is charged, the question stays, and a top-up is offered", async ({ page, request }) => {
  await setup(page);
  await account(request, 3); // grants today's free credits
  const id = await owner(3);
  d1(`UPDATE credit_lots SET remaining_mc = 5 WHERE user_id = '${id}'`);
  d1(`INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) SELECT user_id, ${Date.now()}, 'adjustment', 5 - granted_mc, id, 'e2e-drain' FROM credit_lots WHERE user_id = '${id}'`);
  const before = await books(3);
  const t0 = Date.now();
  await page.goto(`/ask${launch(3)}`);
  await ask(page, "What does the law say about usury?");
  const card = answer(page).locator(".creditcard");
  await expect(card).toContainText("Not enough credits for this answer");
  await expect(card).toContainText("Your question is kept here.");
  await expect(card.getByRole("button", { name: "Top up" })).toBeVisible();
  await expect(page.locator(".msg--me").last()).toHaveText("What does the law say about usury?");
  expect(await modelCalls(request, t0)).toBe(0);
  expect(await books(3)).toEqual(before);
  await card.getByRole("button", { name: "Top up" }).click();
  const sheet = page.getByRole("dialog", { name: "Credits" });
  await expect(sheet).toContainText("Credits are used based on the model and work needed for each response.");
  await expect(sheet).toContainText(/⭐ 750/);
  await expect(sheet).toContainText(/1,950 credits/);
  await expect(sheet).not.toContainText(/answers? left|in-depth answers/i);
});

test("a failed or refused answer is not charged: the hold goes back whole", async ({ request }) => {
  await account(request, 4);
  const before = await books(4);
  for (const q of ["Is Claude overloaded today?", "Please refuse this"]) {
    const res = await askApi(request, 4, q, { maxCredits: 2000 });
    await res.text();
  }
  const id = await owner(4);
  const rows = d1(`SELECT status, charged_mc FROM credit_usage WHERE user_id = '${id}' ORDER BY at`);
  expect(rows.map((r) => r.status)).toEqual(["backup", "refused"]);
  expect(rows.every((r) => Number(r.charged_mc) === 0)).toBe(true);
  expect(d1(`SELECT COUNT(*) AS n FROM credit_holds WHERE user_id = '${id}' AND state <> 'settled'`)[0].n).toBe(0);
  expect(await books(4)).toEqual(before);
});

test("requests sent at once cannot spend the same credits: the balance never goes below zero and the books agree", async ({ request }) => {
  await account(request, 5);
  const id = await owner(5);
  // 150 credits: one Opus answer may hold them all; the others must be refused, not overdrawn.
  d1(`UPDATE credit_lots SET remaining_mc = 150000 WHERE user_id = '${id}'`);
  d1(`INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) SELECT user_id, ${Date.now()}, 'adjustment', 150000 - granted_mc, id, 'e2e-set' FROM credit_lots WHERE user_id = '${id}'`);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => askApi(request, 5, `Question number ${i} about the law`, { maxCredits: 2000 })));
  const statuses = results.map((r) => r.status());
  await Promise.all(results.map((r) => r.text()));
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  expect(statuses.every((s) => s === 200 || s === 402)).toBe(true);
  const b = await books(5);
  expect(b.low).toBeGreaterThanOrEqual(0);
  expect(b.lots).toBe(b.ledger);
  const held = d1(`SELECT COALESCE(SUM(held_mc), 0) AS mc FROM credit_holds WHERE user_id = '${id}'`)[0];
  expect(Number(held.mc)).toBeLessThanOrEqual(150000);
});

test("payments: a top-up and the plan grant once each however often Telegram delivers them; a renewal and a refund are recorded once", async ({ request }) => {
  test.setTimeout(120_000);
  const n = 6;
  await account(request, n);
  const id = await owner(n);
  const base = (await books(n)).lots;
  // A 150-Star top-up, delivered twice.
  for (let i = 0; i < 2; i++) expect((await update(request, paid(n, "pack", 150, `ch-pack-${RUN}`))).status()).toBe(200);
  let lots = d1(`SELECT kind, granted_mc, expires_at FROM credit_lots WHERE user_id = '${id}' AND source = 'pay:ch-pack-${RUN}'`);
  expect(lots).toHaveLength(1);
  expect(lots[0]).toMatchObject({ kind: "topup", granted_mc: 1950000, expires_at: null });
  // The plan, then its renewal a month on; each delivered twice.
  const until = Math.floor(Date.now() / 1000) + 30 * 86400;
  for (let i = 0; i < 2; i++) await update(request, paid(n, "plan", 750, `ch-plan-1-${RUN}`, { subscription_expiration_date: until, is_recurring: true, is_first_recurring: true }));
  for (let i = 0; i < 2; i++) await update(request, paid(n, "plan", 750, `ch-plan-2-${RUN}`, { subscription_expiration_date: until + 30 * 86400, is_recurring: true }));
  lots = d1(`SELECT kind, granted_mc, expires_at FROM credit_lots WHERE user_id = '${id}' AND kind = 'plan' ORDER BY expires_at`);
  expect(lots).toHaveLength(2);
  expect(lots.map((l) => Number(l.expires_at))).toEqual([until * 1000, (until + 30 * 86400) * 1000]);
  expect(d1(`SELECT type FROM credit_ledger WHERE user_id = '${id}' AND type IN ('purchase', 'renewal') ORDER BY at, id`).map((r) => r.type)).toEqual(["purchase", "purchase", "renewal"]);
  expect(d1(`SELECT COUNT(*) AS n FROM payments WHERE charge_id LIKE 'ch-%-${RUN}'`)[0].n).toBe(3);
  // The month that ends soonest is spent first: the account lists it before the next month and the top-up.
  const a = await account(request, n);
  expect(a.wallet.lots.map((l: { kind: string }) => l.kind)).toEqual(["daily", "plan", "plan", "topup"]);
  expect(a.wallet.plan.renews_at).toBe((until + 30 * 86400) * 1000);
  // A refund of the top-up, delivered twice: its unspent credits leave the balance once.
  for (let i = 0; i < 2; i++) await update(request, { from: { id: RUN + n, is_bot: false, first_name: "Test" }, refunded_payment: { currency: "XTR", total_amount: 150, invoice_payload: `ask:pack:${RUN + n}:150`, telegram_payment_charge_id: `ch-pack-${RUN}` } });
  expect(d1(`SELECT amount_mc FROM credit_ledger WHERE user_id = '${id}' AND type = 'refund'`).map((r) => Number(r.amount_mc))).toEqual([-1950000]);
  const b = await books(n);
  expect(b.lots).toBe(b.ledger);
  expect(b.lots).toBe(base + 11700000 * 2);
  // A payment for someone else, or at the wrong amount, grants nothing.
  await update(request, { ...paid(n, "pack", 150, `ch-bad-${RUN}`), from: { id: RUN + 99, is_bot: false, first_name: "X" } });
  expect(d1(`SELECT COUNT(*) AS n FROM credit_lots WHERE source = 'pay:ch-bad-${RUN}'`)[0].n).toBe(0);
});

test("the old allowance is carried over once, unit for unit, and today's free credits come fresh each day", async ({ request }) => {
  const n = 7;
  const id = await owner(n);
  const until = Date.now() + 10 * 86400000;
  d1(`CREATE TABLE IF NOT EXISTS accounts (user_id TEXT PRIMARY KEY, day TEXT NOT NULL DEFAULT '', free_used INTEGER NOT NULL DEFAULT 0, plan_until INTEGER NOT NULL DEFAULT 0, plan_allowance INTEGER NOT NULL DEFAULT 0, plan_used INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1)`);
  d1(`INSERT INTO accounts (user_id, day, free_used, plan_until, plan_allowance, plan_used, credits) VALUES ('${id}', '2026-10-01', 5000, ${until}, 1950000, 450000, 390000)`);
  await account(request, n);
  await account(request, n);
  const m = d1(`SELECT kind, granted_mc, expires_at FROM credit_lots WHERE user_id = '${id}' AND source LIKE 'migrate:%' ORDER BY kind`);
  // 390,000 units of top-up = 1,950 credits that never expire; the plan's 1,500,000 units left = 7,500 credits to its date.
  expect(m).toEqual([{ kind: "plan", granted_mc: 7500000, expires_at: until }, { kind: "topup", granted_mc: 1950000, expires_at: null }]);
  expect(d1(`SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = '${id}' AND type = 'migration'`)[0].n).toBe(2);
  // The old record is kept as it was: it is what the credits were carried over from.
  expect(d1(`SELECT credits FROM accounts WHERE user_id = '${id}'`)[0].credits).toBe(390000);
  // Yesterday's free credits that were left expire, recorded; today's are granted once.
  d1(`INSERT INTO credit_lots (user_id, kind, granted_mc, remaining_mc, expires_at, source, created_at) VALUES ('${id}', 'daily', 600000, 250000, ${Date.now() - 1000}, 'daily:2000-01-01', ${Date.now() - 86400000})`);
  d1(`INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) SELECT user_id, ${Date.now() - 86400000}, 'daily_grant', 250000, id, source FROM credit_lots WHERE user_id = '${id}' AND source = 'daily:2000-01-01'`);
  await account(request, n);
  expect(d1(`SELECT amount_mc FROM credit_ledger WHERE user_id = '${id}' AND type = 'expire'`).map((r) => Number(r.amount_mc))).toEqual([-250000]);
  expect(d1(`SELECT COUNT(*) AS n FROM credit_lots WHERE user_id = '${id}' AND kind = 'daily' AND remaining_mc > 0`)[0].n).toBe(1);
  const b = await books(n);
  expect(b.lots).toBe(b.ledger);
});

test("a model change does not touch the balance: each model has its own typical cost, the credits stay the same credits", async ({ request }) => {
  const a = await account(request, 8);
  const byId = Object.fromEntries(a.models.map((m: { id: string; typical_mc: number; max_mc: number }) => [m.id, m]));
  // Estimated from each model's own prices (the typical cost also learns from real answers, so it is not compared here).
  expect(byId[OPUS].max_mc).toBeGreaterThan(byId["anthropic/claude-haiku-4.5"].max_mc);
  // No answer has been asked: the balance is today's free credits whichever model is chosen next.
  const again = await account(request, 8);
  expect(again.wallet.total_mc).toBe(a.wallet.total_mc);
  expect(a.wallet.total_mc).toBe(a.free_daily_mc);
});

test("new sales wait until the pricing is confirmed; the reason is not shown to readers", async ({ request }) => {
  await account(request, 9);
  const r = await request.post("/api/ask/buy", { headers: auth(9), data: { item: "pack:150" } });
  expect(r.status()).toBe(409);
  expect(await r.json()).toEqual({ ok: false, error: "Credits are not on sale just yet." });
});
