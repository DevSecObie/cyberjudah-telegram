import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/**
 * Where CyberJudah runs (tg/sdk.ts `environment`): a browser tab, Telegram's Mini App, and a
 * Telegram client that opened it without launch data. Against the real local Worker: its sign-in
 * check, the browser credential (bot/src/device.ts) and Ask's browser allowance.
 *
 * The rule under test: inside Telegram the app never offers to open Telegram (that relaunched the
 * Mini App from inside itself); outside it, Ask still answers, and "Open in Telegram" keeps the
 * screen the reader was on.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const relayData = (page: Page) => (DATA_ORIGIN !== "https://data.cyberjudah.io" ? page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) })) : Promise.resolve());
/** What telegram-web-app.js leaves in an ordinary browser tab: the object, with no platform and no launch data. */
const BROWSER_SDK = `window.Telegram = { WebApp: { platform: "unknown", initData: "", initDataUnsafe: {}, version: "6.0", isVersionAtLeast: () => false, ready() {}, expand() {}, onEvent() {}, offEvent() {} } };`;

test.use({ viewport: { width: 390, height: 844 } });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

async function inBrowser(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: BROWSER_SDK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await relayData(page);
  // Agreed already to the free model's provider, as the Telegram tests' reader has.
  await page.addInitScript(() => { try { localStorage.setItem("cj:ai-consent", JSON.stringify(["Anthropic", "Cloudflare (Workers AI)"])); } catch { /* none */ } });
  // window.open is where "Open in Telegram" goes in a browser: recorded instead of opened.
  await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
}
async function inTelegramWithoutLaunchData(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await relayData(page);
}
const d1 = (sql: string) => execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--json", "--command", sql], { cwd: new URL("../../bot/", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const credential = (page: Page) => page.evaluate(() => localStorage.getItem("cj:remind-device"));

test("in a browser, Ask takes a question under the browser's own credential and never hangs", async ({ page }) => {
  await inBrowser(page);
  await page.goto("/ask");
  // Not disabled with "Open in Telegram": the browser asks with the free model.
  await expect(page.locator(".chat2__outside")).toContainText("free model");
  // The browser's free credits, never a count of questions.
  await expect(page.locator(".chat2__heading small")).toHaveText(/^[\d,]+ credits · [\d,]+ free today$/);
  await expect.poll(() => credential(page)).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  const box = page.getByRole("textbox", { name: "Your question" });
  await expect(box).toBeEnabled();
  await box.fill("Why do we keep the Passover?");
  await page.getByRole("button", { name: "Send" }).click();
  // Acknowledged at once: the question shows, and the answer's place under it (working, then done).
  await expect(page.locator(".msg--me").last()).toHaveText("Why do we keep the Passover?");
  await expect(page.locator(".msg--ai")).toHaveCount(1);
  // It ends: an answer, or (this local Worker has no Workers AI or search index) a clear message
  // with a way on. Never a spinner left turning, and Send comes back.
  await expect(page.locator(".msg--ai .msg__thinking")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator(".msg--ai").last().locator(".msg__text, .msg__error, .trouble")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  // A browser's conversation is not an account's: no saved chats to open here.
  await expect(page.getByRole("button", { name: "Your chats" })).toBeDisabled();
});

test("in a browser, when the day's free credits are used, Open in Telegram keeps Ask as the destination", async ({ page }) => {
  test.setTimeout(90_000);
  await inBrowser(page);
  await page.goto("/ask");
  await expect.poll(() => credential(page)).toBeTruthy();
  const cred = await credential(page);
  // The browser's free credits for today, spent.
  d1(`UPDATE credit_lots SET remaining_mc = 0 WHERE user_id = 'dev:${cred!.split(".")[0]}'`);
  await page.getByRole("textbox", { name: "Your question" }).fill("Who are the twelve tribes?");
  await page.getByRole("button", { name: "Send" }).click();
  const card = page.locator(".msg--ai .creditcard");
  await expect(card).toContainText("Not enough credits for this answer");
  await card.getByRole("button", { name: "Get more credits in Telegram" }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(["https://t.me/CyberJudah_bot/cybr?startapp=ask"]);
});

test("a web link with ?startapp= lands on its screen, as a Telegram launch would", async ({ page }) => {
  await inBrowser(page);
  await page.goto("/?startapp=timeline_3");
  await expect(page).toHaveURL(/\/timeline\/3$/);
});

test("inside Telegram without launch data, nothing offers to open Telegram, and Ask still answers", async ({ page }) => {
  await inTelegramWithoutLaunchData(page);
  // The mock reports a platform (ios) but no tgWebAppData: a Telegram client, unsigned.
  await page.goto("/ask");
  await expect(page.getByRole("button", { name: /Open in Telegram/ })).toHaveCount(0);
  await expect(page.locator(".chat2__outside")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeEnabled();
  // Search the classes needs Telegram's signature: inside Telegram that is a stale launch to reopen, never a relaunch.
  await page.goto("/search?q=passover&mode=said");
  await expect(page.locator(".trouble")).toBeVisible();
  await expect(page.locator(".trouble")).toContainText("session");
  await expect(page.getByRole("button", { name: /Open in Telegram/ })).toHaveCount(0);
});
