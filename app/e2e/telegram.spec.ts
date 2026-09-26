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
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
}
type S = { main: string | null; second: string | null; back: boolean; settings: boolean };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __tg: { state(): S } }).__tg.state()) as Promise<S>;
const press = (page: Page, which: "back" | "main" | "second" | "settings") => page.evaluate((w) => (window as unknown as { __tg: { press(w: string): void } }).__tg.press(w), which);
const cloud = (page: Page) => page.evaluate(() => (window as unknown as { __tg: { cloud: Record<string, string> } }).__tg.cloud);
/** A tap on a verse: Bible Strong waits 200 ms for a double tap before it counts. */
const tapVerse = async (page: Page, n: number) => { await page.click(`#verset-${n} .bs-num`); await page.waitForTimeout(400); };
const longPressVerse = async (page: Page, n: number) => { await page.locator(`#verset-${n} .bs-num`).scrollIntoViewIfNeeded(); await page.waitForTimeout(300); const b = (await page.locator(`#verset-${n} .bs-num`).boundingBox())!; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); };
/** In-app navigation (a reload would reset the mock's cloud storage). */
const goInApp = (page: Page, to: string) => page.evaluate((t) => { history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, "", t); dispatchEvent(new PopStateEvent("popstate")); }, to);

test.beforeEach(async ({ page }) => setup(page));

test("a deep link opens the passage in focus, 'Read whole chapter' expands it, the ✕ leaves focus", async ({ page }) => {
  await page.goto(`/?tgWebAppStartParam=john_3_16${LAUNCH}&tgWebAppStartParam=john_3_16`);
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16/);
  await expect(page.locator("#verset-16")).toBeVisible();
  await expect(page.locator(".bs-header__focus")).toHaveText("John 3:16 - KJV");
  await expect(page.locator(".bs-context__main")).toHaveText("Read whole chapter");
  await expect(page.locator("#verset-20")).toHaveCount(0);
  await page.click(".bs-context__main");
  await expect(page.locator(".bs-context__main")).toHaveText("Back to passage");
  await expect(page.locator("#verset-20")).toBeVisible();
  await page.click(".bs-context__exit");
  await expect(page.locator(".bs-pill--book")).toHaveText("John 3");
  await expect(page.locator(".bs-pill--version")).toHaveText("KJV");
  // Telegram's own bottom buttons stay out of the way: the tab has Bible Strong's footer.
  expect(await state(page)).toMatchObject({ main: null, second: null });
  await page.click('.bs-chapterbtn[aria-label="Next chapter"]');
  await expect(page).toHaveURL(/\/read\/john\/4/);
});

test("tapping verses selects them, the sheet highlights, notes, tags and bookmarks them", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await tapVerse(page, 1);
  await expect(page.locator(".bs-header__center")).toHaveText("Psalms 23:1");
  await expect(page.locator(".bs-selected")).toBeVisible();
  await expect(page.locator(".bs-tabsfooter__tab")).toHaveText(["Annotate", "Study", "Share"]);
  await tapVerse(page, 2);
  await expect(page.locator(".bs-header__center")).toHaveText("Psalms 23:1-2");
  // Colour 3 (yellow) on both verses.
  await page.click('.bs-colors__cell[aria-label="Color 3"]');
  await expect(page.locator("#verset-1 > span").first()).toHaveCSS("background-color", "rgba(253, 203, 110, 0.9)");
  await expect(page.locator("#verset-2 > span").first()).toHaveCSS("background-color", "rgba(253, 203, 110, 0.9)");
  await expect(page.locator('.bs-colors__cell[aria-label="Color 3"]')).toHaveAttribute("aria-pressed", "true");
  let c = await cloud(page);
  expect(JSON.parse(c.bs_h_psalms_23)["1"].color).toBe("color3");
  // A note becomes a relation under the last verse of the selection.
  await page.click(".bs-action >> text=Note");
  await page.fill(".bs-noteeditor__title", "The shepherd psalm.");
  await page.fill(".bs-noteeditor__desc", "He restoreth my soul.");
  await page.click(".bs-btn >> text=Save");
  await expect(page.locator("#verset-2 .rel-inline .rel-tag")).toContainText("The shepherd psalm.");
  c = await cloud(page);
  expect(JSON.parse(c.bs_n_psalms_23)["1/2"].title).toBe("The shepherd psalm.");
  expect(JSON.parse(c.rel_psalms_23)[0].endpoints[1].type).toBe("note");
  // Tags: a new tag on the highlight shows as a chip under the last verse of the group.
  await tapVerse(page, 1);
  await page.click(".bs-action >> text=Tag");
  await page.fill(".bs-search input", "promises");
  await page.click(".bs-tagrow--create");
  await expect(page.locator(".bs-tagrow[role=checkbox]")).toHaveAttribute("aria-checked", "true");
  await page.mouse.click(195, 60); // the backdrop dismisses the sheet
  await expect(page.locator("#verset-2 .bs-inline-item")).toContainText("promises");
  // A bookmark on the verse: the ribbon appears before its text.
  await page.click(".bs-action >> text=Bookmark");
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Bookmark");
  await page.fill('.bs-input[aria-label="Bookmark name"]', "Comfort");
  await page.click(".bs-btn >> text=Save");
  await expect(page.locator("#verset-1 .bs-bm")).toBeVisible();
  c = await cloud(page);
  expect(JSON.parse(c.bs_bm)[0]).toMatchObject({ name: "Comfort", book: "psalms", chapter: 23, verse: 1 });
  // Tapping the last selected verse again empties the selection; the sheet goes with it.
  await expect(page.locator(".bs-selected")).toBeVisible();
  await tapVerse(page, 1);
  await expect(page.locator(".bs-selected")).toHaveCount(0);
  await expect(page.locator(".bs-pill--book")).toHaveText("Psalms 23");
  // The lists: bookmarks, highlights with the tag, notes.
  await page.click(".tab >> text=More");
  await page.click(".row >> text=Bookmarks, highlights");
  await expect(page.locator(".row__title").first()).toHaveText("Comfort");
  await page.click('[role=tab] >> text=Highlights');
  await expect(page.locator(".row__title").first()).toHaveText("Psalms 23");
  await page.click(".chip >> text=promises");
  await expect(page.locator(".row__sub").first()).toContainText("Verses 1");
  await page.click('[role=tab] >> text=Notes');
  await expect(page.locator(".row__title").first()).toHaveText("The shepherd psalm.");
});

test("the book pill opens Books; a chapter tile opens the chapter; the chevrons jump to a verse", async ({ page }) => {
  await page.goto(`/read/john/3${LAUNCH}`);
  await page.click(".bs-pill--book");
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Books");
  await expect(page.locator(".bs-bookrow span", { hasText: /^John$/ })).toHaveCSS("font-weight", "700");
  await page.click(".bs-bookrow >> text=Psalms");
  await page.click('.bs-chaptertile[aria-label="Chapter 23"]');
  await expect(page).toHaveURL(/\/read\/psalms\/23/);
  await expect(page.locator(".bs-pill--book")).toHaveText("Psalms 23");
  await page.click(".bs-header__verses");
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Go to verse");
  await expect(page.locator(".bs-versetile")).toHaveCount(6);
  await page.click('.bs-versetile[aria-label="Verse 4"]');
  await expect(page.locator(".bs-sheet")).toHaveCount(0);
  // Grid layout: three-letter books, New Testament in red.
  await page.click(".bs-pill--book");
  await page.click(".bs-filterbtn");
  await page.click('.bs-filter__opts button >> text=Grid');
  await expect(page.locator(".bs-bookshort >> text=Mat")).toHaveCSS("color", "rgb(194, 40, 57)");
  await page.click(".bs-bookshort >> text=Mat");
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Matthew");
  await page.click('.bs-chaptertile[aria-label="Chapter 5"]');
  await expect(page).toHaveURL(/\/read\/matthew\/5/);
});

test("Font and settings: night theme, verse mode, text size, fonts, all kept in the cloud", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await page.click('.bs-iconbtn[aria-label="Passage options"]');
  await page.click(".bs-menu__item >> text=Font and settings");
  await expect(page.locator(".bs-params__row").first()).toContainText("Theme");
  await page.click('.bs-touchicon[aria-label="Day"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.click('.bs-touchicon[aria-label="Night"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(18, 45, 66)");
  await page.click('[role=radio][aria-label="Black"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await page.click('.bs-touchicon[aria-label="Increase text size"]');
  await expect(page.locator(".bs-params__value >> text=110%")).toBeVisible();
  await page.click('.bs-touchicon[aria-label^="Verse mode"]');
  await expect(page.locator("#verset-2")).toHaveCSS("display", "block");
  await page.click(".bs-params__link >> text=Fonts");
  await page.click(".bs-fontrow >> text=Georgia");
  await expect(page.locator("#verset-1 > span").first()).toHaveCSS("font-family", /Georgia/);
  const c = await cloud(page);
  expect(JSON.parse(c.bs)).toMatchObject({ preferredColorScheme: "dark", preferredDarkTheme: "black", fontSizeScale: 1, textDisplay: "block", fontFamily: "Georgia" });
});

test("a long press opens the verse's resources: dictionary, references, comments", async ({ page }) => {
  await page.goto(`/read/genesis/2${LAUNCH}`);
  await expect(page.locator("#verset-8")).toBeVisible();
  await longPressVerse(page, 8);
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Genesis 2:8");
  await expect(page.locator(".bs-sheet__titles small")).toHaveText("Dictionary");
  await expect(page.locator(".bs-resrow b", { hasText: /^Eden$/ })).toBeVisible();
  await page.click('.bs-resourcetabs button >> text=References');
  await expect(page.locator(".bs-resources .xref__chip").first()).toBeVisible();
  await page.click('.bs-resourcetabs button >> text=Dictionary');
  await page.locator(".bs-resrow", { has: page.locator("b", { hasText: /^Eden$/ }) }).click();
  await expect(page).toHaveURL(/\/dictionary\/eden/);
  await expect(page.locator(".dict p").first()).toContainText("Delight");
});

test("relations: a verse linked to a passage shows as a tag under the verse, with edit and delete", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await tapVerse(page, 1);
  await page.click(".bs-action >> text=Relation");
  await page.fill("#rel-q", "John 10:11");
  await expect(page.locator(".rel-result__title", { hasText: "John 10:11" })).toBeVisible();
  await expect(page.locator(".rel-result__desc").first()).toContainText("good shepherd");
  await page.click(".rel-result");
  const tag = page.locator("#verset-1 .rel-inline .rel-tag");
  await expect(tag).toHaveCount(1);
  await expect(tag).toContainText("John 10:11");
  const c = await cloud(page);
  expect(JSON.parse(c.rel_psalms_23)[0].type).toBe("linked");
  expect(JSON.parse(c.rel_john_10)[0].id).toBe(JSON.parse(c.rel_psalms_23)[0].id);
  await tag.click();
  await expect(page).toHaveURL(/\/read\/john\/10\?v=11/);
  await expect(page.locator("#verset-11 .rel-inline .rel-tag")).toContainText("Psalms 23:1");
  // The relations screen reads "is linked to"; edit and delete there.
  await goInApp(page, "/relations?endpoint=psalms-23-1");
  await expect(page.locator(".rel-row__title")).toContainText("is linked to");
  await page.click('.rel-row .icon-btn[aria-label="Options"]');
  await page.click(".sheet__item >> text=Edit");
  await page.click(".sheet__item >> text=refers to");
  await page.click(".sheet__item >> nth=0");
  await page.fill("#sheet-text", "The shepherd");
  await page.click(".sheet__form button[type=submit]");
  await expect(page.locator(".rel-row__title")).toContainText("refers to");
  await page.click('.rel-row .icon-btn[aria-label="Options"]');
  await page.click(".sheet__item >> text=Remove");
  await expect(page.locator(".rel-empty p")).toHaveText("No relations");
});

test("tabs are roots, detail screens push, and the back button walks them", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".hello h1")).toHaveText("CyberJudah");
  expect((await state(page)).back).toBe(false);
  await page.click(".tab >> text=Bible");
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
  await page.click(".tab >> text=More");
  await page.click(".row >> text=Settings");
  expect((await state(page)).back).toBe(true);
  await press(page, "back");
  await expect(page).toHaveURL(/\/more/);
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

test("settings: theme, spacing and offline books", async ({ page }) => {
  await page.goto(`/settings${LAUNCH}`);
  await page.click('[role=tab] >> text=Sepia');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await page.click(".link >> text=Save a book");
  await page.click(".sheet__item >> text=Jude");
  await expect(page.locator(".pill--ok")).toHaveText("offline");
  const cached = await page.evaluate(async () => (await (await caches.open("cj-offline-v1")).keys()).length);
  expect(cached).toBeGreaterThanOrEqual(1);
});

test("search opens a typed reference, and the settings button opens settings", async ({ page }) => {
  await page.goto(`/search${LAUNCH}`);
  await page.fill("#q", "Isaiah 58:13");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/read\/isaiah\/58\?v=13/);
  await expect(page.locator("#verset-13")).toBeVisible();
  await press(page, "settings");
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.locator("text=Daily verse")).toBeVisible();
});
