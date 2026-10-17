import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";

/**
 * The outcomes of a gift on the "Support CyberJudah" screen (app/src/screens/Donate.tsx) that
 * donate.spec.ts does not cover: Telegram's own invoice result decides whether thanks are shown
 * ("paid" only, never "pending", "cancelled" or "failed", the rule the top-up flow follows), and a
 * pause that begins between loading the screen and giving (POST /api/invoice → 423) puts the
 * server's own message in place of the buttons without a second invoice request.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const BOT_TOKEN = process.env.BOT_TOKEN!;
const RUN = 910000 + crypto.randomInt(1e9);
const sign = (id: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const launch = (n: number) => `#tgWebAppData=${encodeURIComponent(sign(RUN + n))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
/** Friday 30 October 2026 at 9:30 pm in New York, after full dark: the Sabbath has begun there. */
const FRIDAY_NIGHT = "2026-10-31T01:30:00Z";
/** Wednesday 28 October 2026 at noon in New York: giving is open. The screen must not depend on the day the suite runs. */
const WEEKDAY = "2026-10-28T16:00:00Z";

test.use({ viewport: { width: 390, height: 844 }, timezoneId: "America/New_York" });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

const invoicesMade = async (request: APIRequestContext, since: number) =>
  ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= since && e.path.endsWith("/createInvoiceLink"));

async function open(page: Page, n: number, opts: { pinned?: boolean } = {}) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  if (!opts.pinned) await page.route(/\/api\/(donations|invoice)/, (r) => r.continue({ headers: { ...r.request().headers(), "x-e2e-now": WEEKDAY } }));
  await page.goto(`/settings/donate${launch(n)}`);
  await expect(page.getByRole("button", { name: "Give 50 Stars" })).toBeEnabled();
}

for (const [i, status] of (["pending", "cancelled", "failed"] as const).entries()) {
  test(`Telegram's "${status}" invoice result shows no thanks: only "paid" does`, async ({ page, request }) => {
    await open(page, 10 + i);
    // Telegram's answer for this gift, as the Mini App SDK reports it.
    await page.evaluate((s) => { (window as any).Telegram.WebApp.openInvoice = (_u: string, cb?: (st: string) => void) => { cb && cb(s); }; }, status);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Give 50 Stars" }).click();
    // The server made the invoice; what Telegram then said decides the screen.
    await expect.poll(async () => (await invoicesMade(request, t0)).length).toBe(1);
    await expect(page.getByRole("button", { name: "Give 50 Stars" })).toBeEnabled();
    await expect(page.getByRole("status").filter({ hasText: "Thank you." })).toHaveCount(0);
  });
}

test("a pause that begins between loading the screen and giving shows the server's message in place of the buttons, with no second invoice request", async ({ page, request }) => {
  let dark = false;
  const invoiceRequests: string[] = [];
  await page.route(/\/api\/donations/, (r) => r.continue({ headers: { ...r.request().headers(), "x-e2e-now": dark ? FRIDAY_NIGHT : WEEKDAY } }));
  await page.route(/\/api\/invoice/, (r) => { invoiceRequests.push(r.request().postData() ?? ""); return r.continue({ headers: { ...r.request().headers(), "x-e2e-now": FRIDAY_NIGHT } }); });
  await open(page, 20, { pinned: true });
  // The screen loaded while giving was open; it has got dark where the giver is since.
  dark = true;
  const t0 = Date.now();
  await page.getByRole("button", { name: "Give 100 Stars" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Giving pauses for the Sabbath" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Give \d+ Stars$/ })).toHaveCount(0);
  await expect(page.getByLabel("Another amount")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Thank you." })).toHaveCount(0);
  // One refusal, no retry, and no invoice was made.
  expect(invoiceRequests).toHaveLength(1);
  expect(await invoicesMade(request, t0)).toHaveLength(0);
});
