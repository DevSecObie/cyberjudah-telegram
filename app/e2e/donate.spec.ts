import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";

/**
 * The "Support CyberJudah" screen (app/src/screens/Donate.tsx) against the real local Worker:
 * the presets and bounds GET /api/donations reports, a custom amount within them, the Stars
 * invoice POST /api/invoice makes (CYB-82, bot/src/billing.ts), the thank-you state Telegram's
 * own "paid" result shows, and the holy-days pause in place of the buttons. The API itself —
 * including the server's own refusal to make an invoice during a pause — is donations.spec.ts;
 * this is the screen a reader actually sees.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const BOT_TOKEN = process.env.BOT_TOKEN!;
const RUN = 900000 + crypto.randomInt(1e9);
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

async function setup(page: Page, opts: { now?: string } = {}) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  { const now = opts.now ?? WEEKDAY; await page.route(/\/api\/(donations|invoice)/, (r) => r.continue({ headers: { ...r.request().headers(), "x-e2e-now": now } })); }
}

test("Settings and More each reach Support CyberJudah, and it shows the presets and a custom amount within the server's bounds", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings${launch(1)}`);
  await page.click(".row >> text=Support CyberJudah");
  await expect(page).toHaveURL(/\/settings\/donate/);
  await expect(page.getByRole("heading", { name: "Support CyberJudah" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Give 50 Stars" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Give 100 Stars" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Give 500 Stars" })).toBeVisible();
  // No owner link is configured in this run: the app never invents one.
  await expect(page.getByRole("button", { name: "Give another way" })).toHaveCount(0);
  // A custom amount: the Give button only enables for a whole number at or above the minimum.
  const custom = page.getByLabel("Another amount");
  const giveCustom = page.getByRole("button", { name: "⭐ Give" });
  await expect(giveCustom).toBeDisabled();
  await custom.fill("0");
  await expect(giveCustom).toBeDisabled();
  await custom.fill("1.5");
  await expect(giveCustom).toBeDisabled();
  await custom.fill("250");
  await expect(giveCustom).toBeEnabled();

  await page.goto(`/more${launch(1)}`);
  await expect(page.getByRole("link", { name: "Support CyberJudah" })).toHaveAttribute("href", "/settings/donate");
});

test("giving a preset makes a Stars invoice for that amount in the giver's time zone, and Telegram's paid result shows thanks", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/settings/donate${launch(2)}`);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Give 100 Stars" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thank you." })).toBeVisible();
  const made = ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= t0 && e.path.endsWith("/createInvoiceLink"));
  expect(made).toHaveLength(1);
  const inv = made[0].body as { currency: string; prices: { amount: number }[]; payload: string };
  expect([inv.currency, inv.prices[0].amount, inv.payload]).toEqual(["XTR", 100, `support:${RUN + 2}:100:America/New_York`]);
  // Reading is never behind this: the tab bar (and so the rest of the app) stays reachable.
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
});

test("during the Sabbath the calm pause message takes the place of the buttons, and clears after dark", async ({ page }) => {
  await setup(page, { now: FRIDAY_NIGHT });
  await page.goto(`/settings/donate${launch(3)}`);
  await expect(page.getByRole("status").filter({ hasText: "Giving pauses for the Sabbath" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Give \d+ Stars$/ })).toHaveCount(0);
  await expect(page.getByLabel("Another amount")).toHaveCount(0);
});
