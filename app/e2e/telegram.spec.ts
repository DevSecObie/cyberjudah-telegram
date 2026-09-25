import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The app driven inside a stand-in for Telegram's SDK: a script served in place of
 * telegram-web-app.js that records what the app asks Telegram to do (buttons, haptics,
 * storage, popups) so the tests can assert on it. Data comes from a local copy of the
 * library when DATA_DIR is set, else from the data origin.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.DATA_DIR ?? "";
const LAUNCH = "#tgWebAppData=query_id%3DAAH%26user%3D%257B%2522id%2522%253A1%252C%2522first_name%2522%253A%2522Test%2522%257D%26auth_date%3D1%26hash%3Dx&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  if (DATA) await page.route("https://data.cyberjudah.io/**", (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname);
    const f = path.join(DATA, p);
    if (f.startsWith(DATA) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route(/ytimg|youtube\.com/, (r) => r.abort());
}
type S = { main: string | null; second: string | null; back: boolean; settings: boolean };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __tg: { state(): S } }).__tg.state()) as Promise<S>;
const press = (page: Page, which: "back" | "main" | "second" | "settings") => page.evaluate((w) => (window as unknown as { __tg: { press(w: string): void } }).__tg.press(w), which);

test.beforeEach(async ({ page }) => setup(page));

test("launch lands on the deep link's screen and the reader drives the bottom bar", async ({ page }) => {
  await page.goto(`/?tgWebAppStartParam=john_3_16${LAUNCH}&tgWebAppStartParam=john_3_16`);
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16/);
  await expect(page.locator("#v16")).toHaveAttribute("aria-pressed", "true");
  expect(await state(page)).toMatchObject({ main: "Share John 3:16", second: "More…", back: true });
  await page.click("#v16");
  expect(await state(page)).toMatchObject({ main: "John 4 →", second: "← John 2" });
  await press(page, "main");
  await expect(page).toHaveURL(/\/read\/john\/4/);
  await press(page, "back");
  await expect(page).toHaveURL(/\/read\/john\/3/);
});

test("tabs are roots, detail screens push, and the back button walks them", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".hello h1")).toHaveText("CyberJudah");
  expect((await state(page)).back).toBe(false);
  await page.click(".tab >> text=Bible");
  await page.click("button.row >> text=Psalms");
  await page.click('.chapters a[aria-label="Psalms 23"]');
  await expect(page.locator("#v1")).toBeVisible();
  expect((await state(page)).back).toBe(true);
  await press(page, "back");
  await expect(page).toHaveURL(/\/bible/);
});

test("the verse sheet: colour highlight, note and bookmark persist through CloudStorage", async ({ page }) => {
  await page.goto(`/read/psalms/23?v=1${LAUNCH}`);
  await expect(page.locator("#v1")).toHaveAttribute("aria-pressed", "true");
  await press(page, "second");
  await page.click('.swatch[aria-label="Green"]');
  await expect(page.locator("#v1")).toHaveAttribute("data-hl", "g");
  await press(page, "second");
  await page.click(".sheet__item >> text=Add a note");
  await page.fill("#sheet-text", "The shepherd psalm.");
  await page.click(".sheet__form button[type=submit]");
  await expect(page.locator("#v1")).toHaveAttribute("data-note", "");
  await expect(page.locator(".vnote")).toHaveText("The shepherd psalm.");
  await press(page, "second");
  await page.click(".sheet__item >> text=Bookmark");
  await expect(page.locator("#v1")).toHaveAttribute("data-bm", "");
  const cloud = await page.evaluate(() => (window as unknown as { __tg: { cloud: Record<string, string> } }).__tg.cloud);
  expect(JSON.parse(cloud.bm)[0].title).toBe("Psalms 23:1");
  expect(cloud.hl).toContain("psalms/23");
  expect(JSON.parse(cloud.nt_psalms_23)["1"]).toBe("The shepherd psalm.");
  // The back button closes an open sheet before it leaves the screen.
  await press(page, "second");
  await expect(page.locator(".sheet")).toBeVisible();
  await press(page, "back");
  await expect(page.locator(".sheet")).toHaveCount(0);
  await expect(page).toHaveURL(/\/read\/psalms\/23/);
  // A full reload would reset the mock's cloud; walk there inside the app instead.
  await press(page, "back");
  await page.click(".tab >> text=More");
  await page.click(".row >> text=Bookmarks, highlights");
  await expect(page.locator(".row__title").first()).toContainText("The Lord is my shepherd");
  await page.click('[role=tab] >> text=Notes');
  await expect(page.locator(".row__title").first()).toHaveText("The shepherd psalm.");
});

test("the reading plan ticks today's chapters and keeps a streak", async ({ page }) => {
  await page.goto(`/plan${LAUNCH}`);
  await press(page, "main");
  await page.click(".sheet__item >> text=4 chapters a day");
  await expect(page.locator(".card__label")).toHaveText("Today");
  await expect(page.locator(".plan-row")).toHaveCount(4);
  for (let i = 0; i < 4; i++) await page.locator(".plan-row i").nth(i).click();
  await expect(page.locator(".plan-row[data-read]")).toHaveCount(4);
  expect((await state(page)).main).toBe("Tomorrow's reading");
  await press(page, "main");
  await expect(page.locator(".kicker")).toContainText("Day 2");
  await expect(page.locator(".card__ref")).toContainText("1 day streak");
});

test("the dictionary looks up the words of a verse", async ({ page }) => {
  await page.goto(`/read/genesis/2?v=8${LAUNCH}`);
  await expect(page.locator("#v8")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await state(page)).second).toBe("More…");
  await press(page, "second");
  await page.click(".sheet__item >> text=Look up in the dictionary");
  await expect(page).toHaveURL(/\/dictionary\?from=/);
  await expect(page.locator(".row__title", { hasText: "Eden" })).toBeVisible();
  await page.locator(".row", { has: page.locator(".row__title", { hasText: /^Eden$/ }) }).first().click();
  await expect(page.locator(".title")).toHaveText("Eden");
  await expect(page.locator(".dict p").first()).toContainText("Delight");
});

test("settings: theme, spacing and offline books", async ({ page }) => {
  await page.goto(`/settings${LAUNCH}`);
  await page.click('[role=tab] >> text=Sepia');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await page.click(".link >> text=Save a book");
  await page.click(".sheet__item >> text=Jude");
  await expect(page.locator(".pill--ok")).toHaveText("offline");
  const cached = await page.evaluate(async () => (await (await caches.open("cj-offline-v1")).keys()).length);
  expect(cached).toBeGreaterThanOrEqual(2);
});

test("search opens a typed reference, and the settings button opens settings", async ({ page }) => {
  await page.goto(`/search${LAUNCH}`);
  await page.fill("#q", "Isaiah 58:13");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/read\/isaiah\/58\?v=13/);
  await press(page, "settings");
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.locator("text=Daily verse")).toBeVisible();
});
