import type { Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.DATA_DIR ?? "";
// The origin the app was built to read its data from (app/src/api/data.ts): stand-ins must sit
// there, or a build pointed elsewhere (VITE_DATA_ORIGIN, as local runs use) bypasses them.
export const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
/** Launch data signed with the local bot token (bot/.dev.vars), so the Worker's API accepts it. */
const BOT_TOKEN = process.env.BOT_TOKEN ?? "123456:ABC-DEF";
const signed = () => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
};
export const LAUNCH = signed();

export async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  if (DATA) await page.route(`${DATA_ORIGIN}/**`, (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    const f = path.join(DATA, p);
    if (f.startsWith(DATA) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  // Playwright tries the last route first: a stand-in thumbnail for screenshots, when given.
  if (process.env.THUMB) await page.route(/ytimg/, (r) => r.fulfill({ path: process.env.THUMB! }));
}

/** In-app navigation (a reload would reset the mock's cloud storage). */
export const goInApp = (page: Page, to: string) => page.evaluate((t) => { history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, "", t); dispatchEvent(new PopStateEvent("popstate")); }, to);

/** The Bible: Bible Strong's reader in the one frame the app keeps loaded (src/bible/BibleFrame.tsx). */
export const bibleFrame = (page: Page) => page.frameLocator('iframe[title="Bible"]');
/** Waits until the Bible's lion has gone: the reader has said it is ready. */
export const bibleReady = (page: Page) => page.locator(".strong-reader__splash[data-done]").waitFor({ state: "attached", timeout: 45_000 });
/** The reader's book trigger, which names the chapter it shows ("John 3"). */
export const bibleAt = (page: Page, passage: string) =>
  bibleFrame(page).getByRole("button", { name: `Choose book and chapter. Current selection: ${passage}`, exact: true });
