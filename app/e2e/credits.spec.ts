import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";
import { pid } from "../../bot/src/privacy.mjs";

/**
 * Ask's pay-as-you-go balance against the real local Worker and its D1 (bot/src/credits.ts,
 * billing.ts): the balance in dollars, each answer charged what it actually cost, the top-up sheet
 * in Stars, payments through the bot's real webhook, the free model with nothing in the balance,
 * and no top-ups during the Sabbath (the Worker's clock is set per request, x-e2e-now, which only
 * the tests' Worker honours). Only Claude is stood in for (e2e/claude.ts: each call reports 1,000
 * tokens in and 200 out).
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN!;
const WEBHOOK = "e2e-webhook-secret";
const RUN = 700000 + crypto.randomInt(1e9);
const OPUS = "anthropic/claude-opus-5";
const sign = (id: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const initData = (n: number) => sign(RUN + n);
const launch = (n: number) => `#tgWebAppData=${encodeURIComponent(initData(n))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
const auth = (n: number) => ({ authorization: `tma ${initData(n)}` });
const owner = (n: number) => pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + n);
const d1 = (sql: string) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--json", "--command", sql], { cwd: new URL("../../bot/", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].results as Record<string, number | string | null>[];
/** The balance two ways: what the lots hold, and the sum of the ledger. They must always agree. */
const books = async (n: number) => {
  const id = await owner(n);
  const lots = d1(`SELECT COALESCE(SUM(remaining_mc), 0) AS mc FROM credit_lots WHERE user_id = '${id}'`)[0];
  const ledger = d1(`SELECT COALESCE(SUM(amount_mc), 0) AS mc FROM credit_ledger WHERE user_id = '${id}'`)[0];
  return { lots: Number(lots.mc), ledger: Number(ledger.mc) };
};
const account = async (request: APIRequestContext, n: number, headers: Record<string, string> = {}) => (await request.get("/api/ask/account?tz=America/New_York", { headers: { ...auth(n), ...headers } })).json();
/** The admins give a reader a balance (POST /api/admin/adjust), once per ref. */
const fund = (request: APIRequestContext, n: number, usd: number, ref = "e2e-fund") =>
  request.post("/api/admin/adjust", { headers: { authorization: `tma ${sign(100000002)}` }, data: { user: RUN + n, usd, ref } });
const modelCalls = async (request: APIRequestContext, since: number) => ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= since && e.path === "/anthropic/v1/messages").length;
/** A Telegram update to the bot's webhook, as Telegram sends it. */
const update = (request: APIRequestContext, message: Record<string, unknown>) =>
  request.post("/webhook", { headers: { "x-telegram-bot-api-secret-token": WEBHOOK }, data: { update_id: crypto.randomInt(1e9), message: { message_id: crypto.randomInt(1e6), date: Math.floor(Date.now() / 1000), chat: { id: 1, type: "private" }, ...message } } });
const paid = (n: number, stars: number, charge: string) =>
  ({ from: { id: RUN + n, is_bot: false, first_name: "Test" }, successful_payment: { currency: "XTR", total_amount: stars, invoice_payload: `ask:pack:${RUN + n}:${stars}:America/New_York`, telegram_payment_charge_id: charge, provider_payment_charge_id: "" } });
/** Friday 30 October 2026 at 9:30 pm in New York, after full dark: the Sabbath has begun there. */
const FRIDAY_NIGHT = "2026-10-31T01:30:00Z";
/** The Wednesday before, at noon: an ordinary day. */
const WEDNESDAY = "2026-10-28T16:00:00Z";

test.use({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/credits/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/credits/${name}.png`, import.meta.url).pathname });
};
async function setup(page: Page, opts: { caps?: Record<string, number>; now?: string } = {}) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
  // A fixed paid model keeps cost assertions independent of account defaults.
  await page.addInitScript(({ caps, model }) => { try { localStorage.setItem("cj:ai-limits", JSON.stringify(caps)); localStorage.setItem("cj:ask-model", model); } catch { /* none */ } }, { caps: opts.caps ?? { [OPUS]: 2_000_000 }, model: OPUS });
  // The Worker's clock for the balance and top-ups, when a test sets it.
  if (opts.now) { const now = opts.now; await page.route(/\/api\/ask\/(account|buy)/, (r) => r.continue({ headers: { ...r.request().headers(), "x-e2e-now": now } })); }
}
const ask = async (page: Page, q: string) => { await page.getByRole("textbox", { name: "Your question" }).fill(q); await page.getByRole("button", { name: "Send" }).click(); };
const answer = (page: Page) => page.locator(".msg--ai").last();
const dollars = (mc: number) => `$${(Math.floor(mc / 10_000) / 100).toFixed(2)}`;

test("the balance is in dollars, and each answer deducts what it actually cost, shown under it", async ({ page, request }) => {
  await setup(page);
  expect((await fund(request, 1, 1)).ok()).toBe(true);
  await page.goto(`/ask${launch(1)}`);
  // The composer balance remains exact and separate from the header model picker.
  await expect(page.locator(".composer2__model")).toHaveAccessibleName("$1.00 left");
  await ask(page, "Why keep the Passover?");
  await expect(answer(page)).toContainText("A short answer to: Why keep the Passover?");
  const used = answer(page).locator(".msg__usage");
  await expect(used).toHaveText(/^Cost (\$\d+\.\d\d|<\$0\.01) · Usage$/);
  // Charged once, exactly what it cost (rounded up to the millionth of a dollar), never more than was held.
  const id = await owner(1);
  const u = d1(`SELECT status, held_mc, charged_mc, cost_usd FROM credit_usage WHERE user_id = '${id}'`);
  expect(u).toHaveLength(1);
  expect(u[0].status).toBe("ok");
  expect(Number(u[0].charged_mc)).toBeGreaterThan(0);
  expect(Number(u[0].charged_mc)).toBeLessThanOrEqual(Number(u[0].held_mc));
  expect(Number(u[0].charged_mc)).toBe(Math.ceil(Number(u[0].cost_usd) * 1e6 - 1e-6));
  // The books agree, and the composer shows what is left.
  const b = await books(1);
  expect(b.lots).toBe(b.ledger);
  expect(b.lots).toBe(1_000_000 - Number(u[0].charged_mc));
  await expect(page.locator(".composer2__model")).toHaveAccessibleName(`${dollars(b.lots)} left`);
  await shot(page, "1-cost-under-answer");
  // The usage history lists the answer and what was added.
  await used.getByRole("button", { name: "Usage" }).click();
  const sheet = page.getByRole("dialog", { name: "Usage" });
  await expect(sheet).toContainText("Answer · Claude Opus 5");
  await expect(sheet).toContainText("Adjustment");
  await expect(sheet).not.toContainText(/credit/i);
});

test("a dearer model asks before an answer that may cost more than $0.25, and calls nothing until allowed", async ({ page, request }) => {
  await setup(page, { caps: {} });
  await fund(request, 2, 5);
  const t0 = Date.now();
  await page.goto(`/ask${launch(2)}`);
  await ask(page, "Who are the twelve tribes?");
  const card = answer(page).locator(".creditcard");
  await expect(card).toContainText(/This answer may cost up to \$\d+\.\d\d/);
  await expect(card).toContainText(/typically costs about \$\d+\.\d\d an answer/);
  expect(await modelCalls(request, t0)).toBe(0);
  await card.getByRole("button", { name: /^Allow up to \$\d+\.\d\d and ask$/ }).click();
  await expect(answer(page)).toContainText("A short answer to: Who are the twelve tribes?");
});

test("the top-up sheet: $1, $5 and $20 with their Stars, why a dollar costs that many, and a payment adds what the Stars pay out", async ({ page, request }) => {
  await setup(page, { now: WEDNESDAY });
  await page.goto(`/ask${launch(3)}`);
  await expect(page.locator(".composer2__model")).toHaveAccessibleName("$0.00 left");
  await page.locator(".composer2__model").click();
  const sheet = page.getByRole("dialog", { name: "Balance" });
  await expect(sheet.getByRole("button", { name: "Add $1.00 for 77 Stars" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add $5.00 for 385 Stars" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add $20.00 for 1539 Stars" })).toBeVisible();
  await expect(sheet).toContainText("Telegram (and the app store, when you buy Stars) keeps a share of each Star, so $1 of balance costs about 77 Stars. CyberJudah makes no profit: you pay only what your answers cost.");
  await expect(sheet).not.toContainText(/credit|plan|month/i);
  await shot(page, "2-top-up-sheet");
  // Buying opens Telegram's invoice for that many Stars, made with the reader's time zone.
  const t0 = Date.now();
  await sheet.getByRole("button", { name: "Add $5.00 for 385 Stars" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.filter((e) => e[0] === "invoice").length)).toBe(1);
  const made = ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= t0 && e.path.endsWith("/createInvoiceLink"));
  expect(made).toHaveLength(1);
  const inv = made[0].body as { payload: string; currency: string; prices: { amount: number }[]; description: string };
  expect([inv.currency, inv.prices[0].amount, inv.payload]).toEqual(["XTR", 385, `ask:pack:${RUN + 3}:385:America/New_York`]);
  expect(inv.description).toContain("CyberJudah makes no profit");
  // Telegram delivers the payment to the bot: 385 Stars × $0.013 = $5.005 is added, once, even if delivered twice.
  for (let i = 0; i < 2; i++) expect((await update(request, paid(3, 385, `e2e-charge-${RUN}`))).ok()).toBe(true);
  expect((await account(request, 3)).wallet.total_mc).toBe(5_005_000);
  expect((await books(3)).ledger).toBe(5_005_000);
  await page.reload();
  await expect(page.locator(".composer2__model")).toHaveAccessibleName("$5.00 left");
});

test("during the Sabbath the top-up buttons give way to when they open again, and the server makes no invoice; the balance is still used", async ({ page, request }) => {
  await setup(page, { now: FRIDAY_NIGHT });
  await fund(request, 4, 1);
  await page.goto(`/ask${launch(4)}`);
  await expect(page.locator(".composer2__model")).toHaveAccessibleName("$1.00 left");
  await page.locator(".composer2__model").click();
  const sheet = page.getByRole("dialog", { name: "Balance" });
  await expect(sheet.locator(".credits__pause")).toHaveText("Top-ups pause for the Sabbath — they open again after dark on Saturday");
  await expect(sheet.getByRole("button", { name: /^Add \$/ })).toHaveCount(0);
  await shot(page, "3-sabbath");
  // The server refuses on its own, for any top-up.
  const refused = await request.post("/api/ask/buy", { headers: { ...auth(4), "x-e2e-now": FRIDAY_NIGHT }, data: { item: "pack:77", tz: "America/New_York" } });
  expect(refused.status()).toBe(423);
  expect((await refused.json()).message).toBe("Top-ups pause for the Sabbath — they open again after dark on Saturday");
  // After full dark on Saturday they are back.
  const open = await account(request, 4, { "x-e2e-now": "2026-11-01T01:30:00Z" });
  expect(open.sale.pause).toBeNull();
  // The balance already held is used as on any day.
  await page.reload();
  await ask(page, "Why keep the Passover?");
  await expect(answer(page)).toContainText("A short answer to: Why keep the Passover?");
  await expect(answer(page).locator(".msg__usage")).toHaveText(/^Cost /);
});

test("with nothing in the balance a paid model is not called and the free model is offered; the free model still answers for $0", async ({ page, request }) => {
  await setup(page);
  const t0 = Date.now();
  await page.goto(`/ask${launch(5)}`);
  await ask(page, "What does the law say about usury?");
  const card = answer(page).locator(".creditcard");
  await expect(card).toContainText("Not enough balance for this answer");
  await expect(card).toContainText("you have $0.00");
  await expect(card.getByRole("button", { name: "Top up" })).toBeVisible();
  // The server names the configured fallback. Several models are free, so the first
  // free entry in the catalog need not be the fallback offered on this card.
  const paidModel = await request.post("/api/ask", { headers: auth(5), data: { q: "And the Sabbath?", stream: true, model: OPUS, consent: ["Anthropic"], caps: { [OPUS]: 2_000_000 } } });
  expect(paidModel.status()).toBe(402);
  const { free } = JSON.parse((await paidModel.text()).split("\n")[0]);
  expect(free).toMatchObject({ id: expect.any(String), name: expect.any(String), provider: expect.any(String) });
  const catalogModel = (await account(request, 5)).models.find((m: { id: string }) => m.id === free.id);
  expect(catalogModel).toMatchObject({ ...free, free: true });
  const freeButton = card.getByRole("button", { name: `Ask with ${free.name} (free)`, exact: true });
  await expect(freeButton).toBeVisible();
  await shot(page, "4-not-enough");
  expect(await modelCalls(request, t0)).toBe(0);
  // Choosing it from the card asks again with the free model. (Its answer is stood in for here:
  // the local Worker has no Workers AI to run it.)
  const sent: { model?: string }[] = [];
  await page.route("**/api/ask", (r) => { sent.push(r.request().postDataJSON()); return r.fulfill({ contentType: "application/x-ndjson", body: `${JSON.stringify({ done: true, answer: "Free answer.", sources: [] })}\n${JSON.stringify({ usage: { charged_mc: 0, free: true } })}\n` }); });
  await freeButton.click();
  await expect(answer(page)).toContainText("Free answer.");
  await expect(answer(page).locator(".msg__usage")).toHaveText("Free model · no charge · Usage");
  expect(sent.at(-1)?.model).toBe(free.id);
  // The free model is let through by the server with nothing in the balance, and nothing is charged.
  const r = await request.post("/api/ask", { headers: auth(5), data: { q: "What does the law say about usury?", stream: true, model: free.id, consent: [free.provider] } });
  expect(r.status()).toBe(200);
  await r.text();
  const id = await owner(5);
  expect(d1(`SELECT COUNT(*) AS n FROM credit_usage WHERE user_id = '${id}'`)[0].n).toBe(0);
  expect((await books(5)).lots).toBe(0);
  await expect(page.locator(".chat2__heading")).toContainText(`${free.name} · free`);
});
