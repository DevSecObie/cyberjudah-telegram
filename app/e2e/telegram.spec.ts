import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
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
// The origin the app was built to read its data from (app/src/api/data.ts): stand-ins must sit
// there, or a build pointed elsewhere (VITE_DATA_ORIGIN, as local runs use) bypasses them.
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
// Search and full-library coverage runs separately against production every night. Pull
// requests remain deterministic and never depend on the current contents of the library.
const liveDataTest = process.env.RUN_LIVE_E2E ? test : test.skip;
/** Launch data signed with the local bot token (bot/.dev.vars), so the Worker's API accepts it. */
const BOT_TOKEN = process.env.BOT_TOKEN ?? "123456:ABC-DEF";
const signed = () => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
};
const LAUNCH = signed();

async function setup(page: Page) {
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
type S = { main: string | null; second: string | null; back: boolean; settings: boolean };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __tg: { state(): S } }).__tg.state()) as Promise<S>;
const press = (page: Page, which: "back" | "main" | "second" | "settings") => page.evaluate((w) => (window as unknown as { __tg: { press(w: string): void } }).__tg.press(w), which);
const cloud = (page: Page) => page.evaluate(() => (window as unknown as { __tg: { cloud: Record<string, string> } }).__tg.cloud);
/** A tap on a verse: Bible Strong waits 200 ms for a double tap before it counts. */
const tapVerse = async (page: Page, n: number) => { await page.click(`#verset-${n} .bs-num`); await page.waitForTimeout(400); };
const longPressVerse = async (page: Page, n: number) => { await page.locator(`#verset-${n} .bs-num`).evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300); const b = (await page.locator(`#verset-${n} .bs-num`).boundingBox())!; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); };
/** A long press that must end in the resources sheet: the runner's first press can land while the text is still reflowing, so try again before giving up. */
const openResources = async (page: Page, n: number) => { for (let i = 0; i < 3; i++) { await longPressVerse(page, n); if (await page.locator(".bs-resourcetabs").isVisible({ timeout: 4000 }).catch(() => false)) return; await page.waitForTimeout(500); } };
/** In-app navigation (a reload would reset the mock's cloud storage). */
const goInApp = (page: Page, to: string) => page.evaluate((t) => { history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, "", t); dispatchEvent(new PopStateEvent("popstate")); }, to);

test.beforeEach(async ({ page }) => setup(page));

test("note HTML is sanitized before it reaches the page", async ({ page }) => {
  await page.route(`${DATA_ORIGIN}/api/notes/classes/security-test.json`, (r) => r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ kind: "class", title: "Security test", url: "/classes/security-test", body: "## Safe heading\n\n<script>window.__noteXss = true</script><img src=x onerror=\"window.__noteXss=true\"><a href=\"javascript:window.__noteXss=true\">bad link</a>" }),
  }));
  await page.goto(`/note/classes/security-test${LAUNCH}`);
  await expect(page.locator(".note h2")).toHaveText("Safe heading");
  await expect(page.locator(".note script")).toHaveCount(0);
  await expect(page.locator(".note [onerror]")).toHaveCount(0);
  await expect(page.locator(".note a")).not.toHaveAttribute("href", /^javascript:/);
  expect(await page.evaluate(() => (window as unknown as { __noteXss?: boolean }).__noteXss)).not.toBe(true);
});

test("a deep link opens the Scripture in focus, 'Read whole chapter' expands it, the ✕ leaves focus", async ({ page }) => {
  await page.goto(`/?tgWebAppStartParam=john_3_16${LAUNCH}&tgWebAppStartParam=john_3_16`);
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16/);
  await expect(page.locator("#verset-16")).toBeVisible();
  await expect(page.locator(".bs-header__focus")).toHaveText("John 3:16 - KJV");
  await expect(page.locator(".bs-context__main")).toHaveText("Read whole chapter");
  await expect(page.locator("#verset-20")).toHaveCount(0);
  await page.click(".bs-context__main");
  await expect(page.locator(".bs-context__main")).toHaveText("Back to the Scripture");
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
  await page.click('.bs-colors__cell[aria-label="Highlight yellow"]');
  await expect(page.locator("#verset-1 > span").first()).toHaveCSS("background-color", "rgba(253, 203, 110, 0.9)");
  await expect(page.locator("#verset-2 > span").first()).toHaveCSS("background-color", "rgba(253, 203, 110, 0.9)");
  await expect(page.locator('.bs-colors__cell[aria-label="Highlight yellow"]')).toHaveAttribute("aria-pressed", "true");
  let c = await cloud(page);
  expect(JSON.parse(c.bs_h_psalms_23)["1"].color).toBe("color3");
  // A note becomes a relation under the last verse of the selection.
  await page.click(".bs-action >> text=Note");
  await page.fill(".bs-noteeditor__title", "The shepherd psalm.");
  await page.fill(".bs-noteeditor__desc", "He restoreth my soul.");
  await page.click(".bs-btn >> text=Save");
  await expect(page.locator("#verset-2 .rel-inline .rel-tag", { hasText: "The shepherd psalm." })).toBeVisible();
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
  await page.click('.tab[aria-label="Menu"]');
  await expect(page.locator(".drawer--more[data-open]")).toBeVisible();
  await page.click(".mcard__row >> text=Bookmarks, highlights");
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
  await expect(page.locator(".bs-picker__header b")).toHaveText("Books");
  await expect(page.locator(".bs-bookrow span", { hasText: /^John$/ })).toHaveCSS("font-weight", "700");
  // The book being read is scrolled into view, not left below the fold.
  await expect(page.locator(".bs-bookrow[data-current]")).toBeInViewport();
  await page.locator(".bs-bookrow", { hasText: /^Psalms$/ }).scrollIntoViewIfNeeded();
  await page.click(".bs-bookrow >> text=Psalms");
  await page.click('.bs-chaptertile[aria-label="Chapter 23"]');
  await expect(page).toHaveURL(/\/read\/psalms\/23/);
  await expect(page.locator(".bs-pill--book")).toHaveText("Psalms 23");
  await page.click(".bs-header__verses");
  await expect(page.locator(".bs-picker__header b")).toHaveText("Go to verse");
  await expect(page.locator(".bs-versetile")).toHaveCount(6);
  await page.click('.bs-versetile[aria-label="Verse 4"]');
  await expect(page.locator(".bs-picker")).toHaveCount(0);
  // Grid layout: three-letter books, New Testament in red.
  await page.click(".bs-pill--book");
  await page.click(".bs-filterbtn");
  await page.click('.bs-filter__opts button >> text=Grid');
  await expect(page.locator(".bs-bookshort >> text=Mat")).toHaveCSS("color", "rgb(237, 191, 196)");
  await page.click(".bs-bookshort >> text=Mat");
  await expect(page.locator(".bs-picker__header b")).toHaveText("Matthew");
  await page.click('.bs-chaptertile[aria-label="Chapter 5"]');
  await expect(page).toHaveURL(/\/read\/matthew\/5/);
});

test("header cards search, keep chapter navigation in place, and close with Telegram Back", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.click(".bs-pill--book");
  const card = page.getByRole("dialog", { name: "Books", exact: true });
  await expect(card).toBeVisible();
  // Measure the full border box after the opening scale animation has finished.
  await expect(card).toHaveCSS("transform", "none");
  const bounds = (await card.boundingBox())!;
  expect(bounds.y).toBeLessThan(130);
  expect(bounds.height).toBeLessThanOrEqual(530);
  await page.getByRole("textbox", { name: "Search books" }).fill("maccabees");
  await expect(page.locator(".bs-bookrow")).toHaveCount(2);
  await page.locator(".bs-bookrow").first().click();
  await expect(page.getByRole("dialog", { name: "1 Maccabees", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to books" }).click();
  await expect(page.getByRole("textbox", { name: "Search books" })).toHaveValue("maccabees");
  await press(page, "back");
  await expect(page.locator(".bs-picker")).toHaveCount(0);
  await expect(page.locator(".bs-pill--book")).toBeFocused();
  await page.click(".bs-pill--version");
  await expect(page.locator(".bs-versions__language")).toHaveText("English");
  await expect(page.locator(".bs-versionrow")).toHaveAttribute("aria-current", "true");
  await page.getByRole("textbox", { name: "Search versions" }).fill("unknown");
  await expect(page.getByText("No versions found.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-picker")).toHaveCount(0);
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
  await expect(page.getByRole("menu", { name: "Passage options" })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText(["Font and settings", "Search the Scriptures", "Recently viewed", "Add bookmark", "Export…", "Open in new tab"]);
});

test("Font and settings: night theme, verse mode, text size, fonts, all kept in the cloud", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
  await page.click(".bs-dropdown__item >> text=Font and settings");
  await expect(page.locator(".bs-params__row").first()).toContainText("Theme");
  await page.click('.bs-touchicon[aria-label="Day"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(252, 251, 247)");
  await page.click('.bs-touchicon[aria-label="Night"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(18, 45, 66)");
  await page.click('[role=radio][aria-label="Black"]');
  await expect(page.locator(".bs")).toHaveCSS("background-color", "rgb(9, 9, 11)");
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

test("the precepts a class lined up with a verse: a tag under the verse, and a Precepts tab in its resources", async ({ page }) => {
  await page.goto(`/read/isaiah/11${LAUNCH}`);
  await expect(page.locator("#verset-12")).toBeVisible();
  // The library's relation, drawn like the reader's own, under the last verse of the span.
  const tag = page.locator("#verset-12 .rel-tag").first();
  await expect(tag).toBeVisible();
  await longPressVerse(page, 11);
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Isaiah 11:11");
  await page.click('.bs-resourcetabs button >> text=Precepts');
  await expect(page.locator(".bs-sheet__titles small")).toHaveText("Precepts taught with this verse");
  const row = page.locator(".bs-precept").first();
  await expect(row).toBeVisible();
  await expect(row.locator("small")).toContainText(/\S/);
  await row.click();
  await expect(page).toHaveURL(/\/read\/[a-z0-9-]+\/\d+/);
});

test("a verse's precepts lead with one note, Precepts: why each is there, from the class", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  const note = page.locator("#verset-1 .rel-tag").first();
  await expect(note).toHaveText("Precepts");
  await note.click();
  await expect(page.locator(".bs-sheet__titles b")).toHaveText("Genesis 1:1");
  await expect(page.locator(".bs-sheet__titles small")).toHaveText("Precepts");
  const first = page.locator(".why__item").first();
  await expect(first.locator(".why__ref b")).toHaveText("2 Esdras 6:38");
  await expect(first.locator(".why__words")).toContainText("thou spakest from the beginning");
  await expect(first.locator(".why__reason")).toContainText("from the beginning of the creation");
  await expect(first.locator(".why__src")).toContainText("The Kingdom Of Adam");
  await first.locator(".why__ref").click();
  await expect(page).toHaveURL(/\/read\/2-esdras\/6\?v=38/);
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
  await expect(page.locator("#verset-11 .rel-inline .rel-tag", { hasText: "Psalms 23:1" })).toBeVisible();
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
  await expect(page.locator(".rel-empty p")).toHaveText("No precepts yet");
});

test("Link and Relation are their own verse actions: a link saved from Link shows under the verse", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await tapVerse(page, 1);
  await expect(page.locator(".bs-action >> text=Relation")).toBeVisible();
  await page.click(".bs-action >> text=Link");
  await page.fill('input[placeholder="https://"]', "https://www.youtube.com/watch?v=abc");
  await page.fill('input[placeholder="Untitled link"]', "The shepherd class");
  await page.click(".bs-sheet__actions button >> text=Save");
  await expect(page.locator("#verset-1 .rel-inline .rel-tag", { hasText: "The shepherd class" })).toBeVisible();
});

test("liquid glass: pressing the current section lifts its pill, dragging carries it along the bar, letting go opens where it lands", async ({ page }) => {
  await page.goto(`/search${LAUNCH}`);
  const dock = page.locator("nav.tabs");
  const from = await dock.locator(".tab[data-on]").boundingBox();
  const to = await dock.locator(".tab", { hasText: "Classes" }).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await expect(dock).toHaveAttribute("data-lift", "");
  for (let i = 1; i <= 8; i++) await page.mouse.move(from!.x + from!.width / 2 + ((to!.x - from!.x) * i) / 8, from!.y + from!.height / 2);
  await expect(dock).toHaveAttribute("data-drag", "");
  // Feedback is present but restrained, so icons stay inside their navigation targets.
  const magnification = Number(await dock.locator(".tab", { hasText: "Classes" }).evaluate((b) => b.style.getPropertyValue("--mag")));
  expect(magnification).toBeGreaterThan(1);
  expect(magnification).toBeLessThanOrEqual(1.06);
  if (process.env.SHOTS) await dock.screenshot({ path: `${process.env.SHOTS}/liquid-drag.png` });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/classes/);
  await expect(dock).not.toHaveAttribute("data-lift", "");
  await expect(dock.locator(".tab[data-on]")).toContainText("Classes");
  // A plain tap on another section still opens it.
  await dock.locator(".tab", { hasText: "Search" }).click();
  await expect(page).toHaveURL(/\/search/);
});

test("tabs are roots, detail screens push, and the back button walks them", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".hello h1")).toHaveText("What do you want to learn?");
  expect((await state(page)).back).toBe(false);
  await page.click('.tab[aria-label="Bible"]');
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
  // The menu is a drawer over the Bible, as in Bible Strong: the back button closes it first.
  await page.click('.tab[aria-label="Menu"]');
  await expect(page.locator(".drawer--more[data-open]")).toBeVisible();
  await expect.poll(async () => (await state(page)).back).toBe(true);
  await press(page, "back");
  await expect(page.locator(".drawer--more[data-open]")).toHaveCount(0);
  // A screen opened from it pushes, and the back button returns to the Bible.
  await page.click('.tab[aria-label="Menu"]');
  await page.click(".mcard__row >> text=Settings");
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.locator("h1.title")).toHaveText("Settings");
  await expect(page.locator(".drawer[data-open]")).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect.poll(async () => (await state(page)).back).toBe(true);
  await press(page, "back");
  await expect(page).toHaveURL(/\/(bible|read)/);
});

test("Home is Bible Strong's drawer: it slides the app aside and closes with a swipe", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.click('.tab[aria-label="Home"]');
  const home = page.locator(".drawer--home[data-open]");
  await expect(home).toBeVisible();
  await expect(home.locator(".today-card header b")).toHaveText("Today");
  // The app moved aside with it.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector("#shell .route")!).transform)).not.toBe("none");
  // A swipe back toward its edge closes it (once it has finished sliding in).
  await expect.poll(async () => Math.round((await home.boundingBox())!.x)).toBe(0);
  const box = (await home.boundingBox())!;
  await page.mouse.move(box.x + box.width - 40, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 305, { steps: 6 }); await page.mouse.up();
  await expect(page.locator(".drawer--home[data-open]")).toHaveCount(0);
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
});

test("the reading plan ticks today's chapters and keeps a streak", async ({ page }) => {
  await page.goto(`/plan${LAUNCH}`);
  // Before a plan is started, its one action sits with the words it answers, not in Telegram's bottom buttons.
  const start = page.locator(".empty__act", { hasText: "Start the plan" });
  await expect(start).toBeVisible();
  expect((await state(page)).main).toBeNull();
  await start.click();
  await page.click(".sheet__item >> text=4 chapters a day");
  await expect(page.locator(".card__label")).toHaveText("Today");
  await expect(page.locator(".plan-row")).toHaveCount(4);
  for (let i = 0; i < 4; i++) await page.locator(".plan-row i").nth(i).click();
  await expect(page.locator(".plan-row[data-read]")).toHaveCount(4);
  await expect(page.locator(".pageaction").last()).toHaveText("Tomorrow's reading");
  await page.locator(".pageaction").last().click();
  await expect(page.locator(".kicker")).toContainText("Day 2");
  await expect(page.locator(".card__ref")).toContainText("1 day streak");
});

test("one theme: the Bible's day and night colours are the whole app's", async ({ page }) => {
  await page.goto(`/settings${LAUNCH}`);
  const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim());
  await page.click('[role=tab] >> text=Day');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "default");
  expect(await canvas()).toBe("#fcfbf7");
  await page.click(".row >> text=Day colour");
  await page.click(".row >> text=Day colour");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "nature");
  expect(await canvas()).toBe("#fdfffd");
  await page.click('[role=tab] >> text=Night');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "dark");
  expect(await canvas()).toBe("#122d42");
  const stored = await page.evaluate(() => localStorage.getItem("cj:palette"));
  expect(JSON.parse(stored!)["--canvas"]).toBe("#122d42");
});

liveDataTest("settings: theme, spacing and offline books", async ({ page }) => {
  await page.goto(`/settings${LAUNCH}`);
  await page.click('[role=tab] >> text=Day');
  await page.click(".row >> text=Day colour");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "sepia");
  await page.click(".link >> text=Save a book");
  await page.click(".sheet__item >> text=Jude");
  await expect(page.locator(".pill--ok")).toHaveText("offline");
  const cached = await page.evaluate(async () => (await (await caches.open("cj-offline-v1")).keys()).length);
  expect(cached).toBeGreaterThanOrEqual(1);
});

test("backup: everything kept goes to your chat as a file, and a file restores it", async ({ page }) => {
  let sent: { keys: Record<string, string> } | null = null;
  await page.route("**/api/backup", async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ json: { ok: true, entries: Object.keys(sent!.keys).length } }); });
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await tapVerse(page, 1);
  await page.click(".bs-colors__cell:nth-child(2)");
  await goInApp(page, "/settings");
  await page.click(".row >> text=Send a backup to your chat");
  await expect(page.locator("[role=status]")).toContainText(/Sent to your chat with the bot: \d+ entries\./);
  expect(Object.keys(sent!.keys)).toContain("bs_h_psalms_23");
  // Restore a file that holds a bookmark: it lands in the cloud storage.
  const file = { name: "cyberjudah-backup-2026-09-30.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "cyberjudah", version: 1, date: "2026-09-30", keys: { bs_bm: JSON.stringify([{ id: "b1", name: "Comfort", color: "#cc0000", book: "psalms", chapter: 23, verse: 4, date: 1 }]) } })) };
  await page.locator('input[aria-label="Backup file"]').setInputFiles(file);
  await expect(page.locator("[role=status]")).toContainText("Restored 1 entry.");
  const c = await cloud(page);
  expect(JSON.parse(c.bs_bm)[0].name).toBe("Comfort");
  // A file that is not a backup is refused.
  await page.locator('input[aria-label="Backup file"]').setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.locator("[role=status]")).toContainText("This file is not a CyberJudah backup.");
});

test("tabs as in Bible Strong: the Bible is a tab, a new tab offers every resource, the switcher shows and closes them, and groups keep their own tabs", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await page.evaluate(() => { localStorage.removeItem("cj:tabs"); localStorage.removeItem("cj:tabgroups"); });
  await page.goto(`/${LAUNCH}`);
  await page.click('.tab[aria-label="Bible"]');
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
  await page.click('.tab[aria-label^="Tabs"]');
  await expect(page).toHaveURL(/\/tabs/);
  await expect(page.locator(".tabcard")).toHaveCount(1);
  await expect(page.locator(".tabcard__title b").first()).toHaveText("Genesis 1 - KJV");
  await expect(page.locator(".tabcard__preview").first()).toContainText("In the beginning");
  // In the switcher the bottom bar is its controls: +, the group (the default group shows its count), OK.
  await expect(page.locator(".switcherbar__group")).toHaveText("1 tab");
  await page.click('[aria-label="Add a tab"]');
  await expect(page.locator(".nt-heading")).toHaveText("What would you like to explore?");
  await page.click(".nt-item >> text=Strong");
  await expect(page).toHaveURL(/\/lexicon/);
  await page.click('.tab[aria-label^="Tabs"]');
  await expect(page.locator(".tabcard")).toHaveCount(2);
  await expect(page.locator(".switcherbar__group")).toHaveText("2 tabs");
  await page.click('.tabcard__close[aria-label="Close Strong"]');
  await expect(page.locator(".tabcard")).toHaveCount(1);
  // A new group starts with its own New Tab page; the first group keeps its Bible tab.
  await page.click(".switcherbar__group");
  await page.click(".sheet__item >> text=New group");
  await page.locator(".sheet textarea").fill("Revelation");
  await page.click(".sheet button[type=submit]");
  await page.locator(".sheet .swatch").nth(2).click();
  await expect(page.locator(".switcherbar__group")).toHaveText("Revelation");
  await expect(page.locator(".tabcard__title b").first()).toHaveText("New tab");
  if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/tabs-groups.png` }); }
  await page.click(".switcherbar__group");
  await page.click(".sheet__item >> text=1 tab");
  await expect(page.locator(".switcherbar__group")).toHaveText("1 tab");
  await expect(page.locator(".tabcard__title b").first()).toHaveText("Genesis 1 - KJV");
  await expect(page.locator(".tabcard__preview").first()).toContainText("In the beginning");
  if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/tabs.png` }); }
  await page.click(".switcherbar__ok");
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
});

test("the new-tab search entry opens Search in that tab", async ({ page }) => {
  await page.goto(`/new${LAUNCH}`);
  await page.getByRole("button", { name: "A passage, a tab, a tool…" }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.locator('.tab[aria-label="Search"]')).toHaveAttribute("aria-current", "page");
});

test("the settings button opens settings", async ({ page }) => {
  await page.goto(`/search${LAUNCH}`);
  await press(page, "settings");
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.locator("text=Daily verse")).toBeVisible();
});

test("Home drawer starts with Today and six saved-content counts; Image and Links open their content", async ({ page }) => {
  const relation = { id: "same-link", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-1"], label: "Genesis 1:1" }, { type: "verse", verseKeys: ["john-1-1"], label: "John 1:1" }], createdAt: 1, updatedAt: 1 };
  await page.addInitScript((s) => { (window as unknown as { __cloud: unknown }).__cloud = s; }, {
    rel_genesis_1: JSON.stringify([relation]), rel_john_1: JSON.stringify([relation]),
    rel_psalms_23: JSON.stringify([{ ...relation, id: "note-link", endpoints: [{ type: "note", verseKey: "psalms-23-1", label: "My note" }, { type: "link", url: "https://cyberjudah.io", label: "CyberJudah" }] }]),
    bs_h_genesis_1: JSON.stringify({ "1": { color: "color3", date: 1 } }),
    bs_n_genesis_1: JSON.stringify({ "1": { id: "note1", title: "Beginning", description: "", date: 1 } }),
    plan: JSON.stringify({ startedAt: "2026-09-30", day: 1, streak: 0, perDay: 4 }),
  });
  await page.route("**/api/verse-of-day", (r) => r.fulfill({ json: { ref: "Genesis 1:1", slug: "genesis", chapter: 1, verse: 1, text: "In the beginning God created the heaven and the earth." } }));
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const home = page.locator(".drawer--home");
  await expect(home.locator(".today-card")).toContainText("Genesis 1:1");
  await expect(home.locator(".hello, .search-hero, .door__btn--ask")).toHaveCount(0);
  await expect(home.locator(".stats__cell small")).toHaveText(["Highlights", "Bookmarks", "Notes", "Studies", "Precepts", "Tags"]);
  await expect(home.locator('.stats__cell[href="/plan"] b')).toHaveText("1");
  await expect(home.locator('.stats__cell[href="/bookmarks?tab=highlights"] b')).toHaveText("1");
  await expect(home.locator('.stats__cell[href="/bookmarks?tab=notes"] b')).toHaveText("1");
  await expect(home.locator('.stats__cell[href="/relations"] b')).toHaveText("2");
  await home.getByRole("button", { name: "Image", exact: true }).click();
  const image = page.getByRole("dialog", { name: "Verse image" });
  await expect(image.locator("img")).toHaveJSProperty("naturalWidth", 1200);
  await expect(image.getByRole("link", { name: "Save image" })).toHaveAttribute("href", "/card/genesis/1/1.svg");
  await press(page, "back");
  await expect(image).toHaveCount(0);
  await expect(home).toHaveAttribute("data-open", "");
  await home.locator('.stats__cell[href="/relations"]').click();
  await expect(page).toHaveURL(/\/relations$/);
  await expect(page.locator(".nt-item")).toHaveCount(2);
  await page.locator(".nt-item").last().click();
  await expect(page).toHaveURL(/endpoint=note%3Apsalms-23-1/);
  await expect(page.locator(".rel-row")).toContainText("CyberJudah");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(page.locator(".mcard__head")).toHaveText(["Yours", "Resources", "The Law", "Settings", "CyberJudah"]);
});

test("Home is the front door: one field, search the classes or ask CyberJudah", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".shero__prompt[data-on]")).toBeVisible();
  // No plan yet: Meditate offers to start one (Bible Strong's PlanHome), and the study shelves are all in front.
  await expect(page.locator('.home a[href="/plan"]')).toHaveText(/Start a reading plan/);
  await expect(page.locator(".shelf")).toHaveText(["Learn", "Study", "Meditate", "Go further"]);
  await expect(page.locator(".widget")).toHaveCount(6);
  await expect(page.locator('.tools a[href="/lexicon"]')).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(7); // Home, Search, Bible, Classes, Ask, Tabs, and the menu
  await page.fill("#q", "Why do we keep the Passover?");
  await page.click(".door__btn--ask");
  await expect(page).toHaveURL(/\/ask/);
  await expect(page.locator(".msg--me .msg__bubble")).toHaveText("Why do we keep the Passover?");
  await page.goBack();
  await page.fill("#q", "Seattle");
  await page.press("#q", "Enter");
  await expect(page).toHaveURL(/\/search\?q=Seattle/);
  // Bible Strong's search: no title, the field and the collections in a strip on top.
  await expect(page.locator(".srch__bar #q")).toHaveValue("Seattle");
  await expect(page.locator(".srch__scope").first()).toHaveText("Top");
});

liveDataTest("a class opens like YouTube: the player pinned, the notes in a sheet beneath it", async ({ page }) => {
  await page.goto(`/note/classes/2026/2026-03-28-religion-the-false-prophet${LAUNCH}`);
  await expect(page.locator(".nsheet[data-open]")).toBeVisible();
  await expect(page.locator(".nsheet__head")).toContainText("Class notes");
  await expect(page.locator(".nsheet .note h2").first()).toBeVisible();
  await page.click(".nsheet__close");
  await expect(page.locator(".nsheet[data-open]")).toHaveCount(0);
  await expect(page.locator(".note-head h1")).toHaveText("Religion - The False Prophet");
  await page.click(".notes-open");
  await expect(page.locator(".nsheet[data-open]")).toBeVisible();
  await expect(page.locator(".player")).toBeVisible();
});

liveDataTest("the notes' grip drags them full screen; a playing recording shrinks to a corner picture; down docks them again", async ({ page }) => {
  await page.goto(`/note/classes/2026/2026-03-28-religion-the-false-prophet${LAUNCH}`);
  await expect(page.locator(".nsheet[data-open]")).toBeVisible();
  const docked = (await page.locator(".nsheet").boundingBox())!.y;
  expect(docked).toBeGreaterThan(150);
  const drag = async (dy: number) => {
    const g = (await page.locator(".nsheet__grip").boundingBox())!;
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy / 2); await page.mouse.move(x, y + dy); await page.mouse.up();
  };
  await drag(-120);
  await expect(page.locator(".nsheet[data-full]")).toBeVisible();
  await expect.poll(async () => (await page.locator(".nsheet").boundingBox())!.y).toBeLessThan(10);
  await expect(page.locator(".player[data-pip]")).toHaveCount(0); // not playing: the notes simply cover the thumbnail
  await drag(120);
  await expect(page.locator(".nsheet[data-full]")).toHaveCount(0);
  await expect.poll(async () => (await page.locator(".nsheet").boundingBox())!.y).toBeGreaterThan(150);
  // Playing, the recording goes to the corner when the notes go full, and comes back with its button.
  // (The drag is done by a tap here: the harness cannot drag a captured pointer across the recording's frame.)
  await page.click(".nsheet__close");
  await page.click(".player .watch");
  await expect(page.locator(".player iframe")).toBeAttached();
  await page.click(".notes-open");
  await expect(page.locator(".nsheet[data-open]")).toBeVisible();
  await page.waitForTimeout(400);
  await page.click(".nsheet__grip"); // a tap on the grip toggles too
  await expect(page.locator(".player[data-pip]")).toBeVisible();
  const pip = (await page.locator(".player[data-pip]").boundingBox())!;
  expect(pip.width).toBeLessThan(300); expect(pip.y).toBeGreaterThan(300);
  await page.click(".player__expand");
  await expect(page.locator(".player[data-pip]")).toHaveCount(0);
  await expect(page.locator(".nsheet[data-full]")).toHaveCount(0);
  await expect(page.locator(".player iframe")).toBeAttached();
});

test("what was on the screen: a frame lands in the notes where the teacher pointed at it, a tap from playing there", async ({ page }) => {
  // A storyboard the Worker would serve (one level, 5x5 cells, a frame every 10 s) and two moments the captions flagged.
  const board = { ok: true, duration: 9557, levels: [{ level: 2, w: 160, h: 90, frames: 956, rows: 5, cols: 5, sheets: 39, interval: 10 }] };
  await page.route(`${DATA_ORIGIN}/api/notes/classes/2026/2026-09-26-the-art-of-war-rules-of-engagement.json`, (r) => r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ kind: "class", title: "The Art of War - Rules of Engagement", url: "/classes/2026/2026-09-26-the-art-of-war-rules-of-engagement", date: "2026-09-26", teacher: "Captain Joel", videoId: "eNMvid6j-qk", body: "## Scriptures Opened\n\n**[Deuteronomy 30:11-13](/bible/deuteronomy/30#v11):** *[[10:37](https://www.youtube.com/watch?v=eNMvid6j-qk&t=637s)]*\n\nThe commandment is not beyond the sea.\n\n**[Isaiah 11:10-12](/bible/isaiah/11#v10):** *[[24:08](https://www.youtube.com/watch?v=eNMvid6j-qk&t=1448s)]*\n\nThe remnant is gathered." }),
  }));
  await page.route("**/api/frames/*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(board) }));
  await page.route("**/api/visuals/*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, visuals: [{ t: 700, said: 695, text: "Look at this map right here." }, { t: 5, said: 0, text: "Pull that up." }] }) }));
  await page.route("**/frames/**/*.jpg", (r) => r.fulfill({ contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64") }));
  await page.goto(`/note/classes/2026/2026-09-26-the-art-of-war-rules-of-engagement${LAUNCH}`);
  const shown = page.locator(".nsheet figure.shown");
  await expect(shown.first()).toBeVisible();
  // 700 s is frame 70: sheet 2, row 4, column 0. It follows the Deuteronomy 30 block (10:37) and precedes Isaiah 11 (24:08).
  const fig = page.locator(".nsheet figure.shown[data-t=\"695\"]");
  // A library rebuild may already have placed an <img>; otherwise the app composes the
  // matching storyboard cell. Both are the same user-visible frame and must remain present.
  const frame = fig.locator(".shown__frame, img").first();
  await expect(frame).toBeVisible();
  const frameSource = `${await frame.getAttribute("style") ?? ""} ${await frame.getAttribute("src") ?? ""}`;
  expect(frameSource).toMatch(/frames\/eNMvid6j-qk\/(?:2\/2\.jpg|[^\s"']+\.jpg)/);
  await expect(fig.locator("figcaption")).toHaveText("11:35");
  const order = await page.locator(".nsheet .note").evaluate((el) => { const h = el.innerHTML; return [h.indexOf("Deuteronomy 30:11-13"), h.indexOf('data-t="695"'), h.indexOf("Isaiah 11:10-12")]; });
  expect(order[0]).toBeLessThan(order[1]); expect(order[1]).toBeLessThan(order[2]);
  // A moment before any scripture goes to "Shown in class" at the end.
  await expect(page.locator(".nsheet .shown-all figure.shown[data-t=\"0\"]")).toBeAttached();
  await fig.click();
  await expect(page.locator(".nsheet")).not.toHaveAttribute("data-open", "");
  // A timestamp in the notes plays the recording from there, inside the app: the sheet closes, nothing opens outside.
  await page.click(".notes-open");
  await expect(page.locator(".nsheet")).toHaveAttribute("data-open", "");
  const url = page.url();
  await page.locator(".nsheet .moment__at").first().click();
  await expect(page.locator(".nsheet")).not.toHaveAttribute("data-open", "");
  expect(page.url()).toBe(url);
  // A passage of the notes, not only its time, goes to its place in the recording: one that
  // follows a timestamp (the breakdown of that scripture) plays from that timestamp.
  await page.click(".notes-open");
  const follows = page.locator(".nsheet .note [data-at]:not(:has(.moment__at))").first();
  const t = await follows.getAttribute("data-at");
  const owner = page.locator(`.nsheet .note .moment__at[data-t="${t}"]`).first();
  await expect(owner).toBeAttached();
  await follows.dispatchEvent("click");
  await expect(page.locator(".nsheet")).not.toHaveAttribute("data-open", "");
  await expect(page.locator(".player iframe")).toHaveAttribute("src", new RegExp(`[?&]start=${t}(&|$)`));
  expect(page.url()).toBe(url);
  const opened = await page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.filter((l) => l[0] === "openLink"));
  expect(opened).toEqual([]);
});

liveDataTest("the recordings search works as the site's: matches lit, a moment to watch, notes alongside", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await page.fill("#q", "Most High");
  await page.press("#q", "Enter");
  await expect(page).toHaveURL(/\/search\?q=Most%20High/);
  await expect(page.locator(".hint").first()).toContainText(/Results 1–\d+ for/);
  await expect(page.locator(".rec mark").first()).toHaveText(/most|high/i);
  await expect(page.locator(".rec__meta b").first()).toHaveText(/\d+:\d\d/);
  await page.click(".chip >> text=Sabbath class");
  await expect(page).toHaveURL(/feed=classes/);
  await expect(page.locator(".rec__meta").first()).toContainText("Sabbath class");
  await page.click(".rec >> nth=0");
  await expect(page).toHaveURL(/\/(watch|note)\//);
  await expect(page.locator(".watch")).toContainText("Watch from");
});

liveDataTest("a quoted phrase in the recordings search is exact", async ({ page }) => {
  await page.goto(`/search?q=%22most%20high%22${LAUNCH}`);
  await expect(page.locator(".rec").first()).toBeVisible();
  await expect(page.locator(".rec__excerpt").first()).toContainText(/most high/i);
});

test("reading progress: read chapters in the book picker, the day strip and catching up, marking a chapter read", async ({ page }) => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const seed = { read: JSON.stringify({ genesis: "1-4,6" }), plan: JSON.stringify({ startedAt: day(3), day: 1, streak: 1, perDay: 4, lastDone: day(3) }) };
  await page.addInitScript((s) => { (window as unknown as { __cloud: unknown }).__cloud = s; }, seed);
  const shot = (n: string) => (process.env.SHOTS ? page.screenshot({ path: `${process.env.SHOTS}/${n}.png` }) : Promise.resolve());

  // The plan: two days behind, a strip of days, a chip to catch up.
  await page.goto(`/plan${LAUNCH}`);
  await expect(page.locator(".daystrip__day[aria-current]")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".daystrip__day[data-done]")).toHaveCount(1);
  await expect(page.locator(".catchup")).toHaveText("Catch up · 11 chapters");
  await shot("tracker-plan");
  await page.locator(".daystrip__day").nth(2).click();
  await expect(page.locator(".section__head h2").first()).toContainText("Day 3 · ");
  await page.click(".catchup");
  await page.click(".sheet__item >> text=Start the schedule from today");
  await expect(page.locator(".catchup")).toHaveCount(0);

  // The book picker: Genesis 5 of 50, chapters read filled.
  await goInApp(page, "/read/genesis/5");
  await page.locator(".bs-chapterend").scrollIntoViewIfNeeded();
  await expect(page.locator(".bs-markread")).toHaveText("Mark as read");
  await expect(page.locator(".bs-chapterend__plan")).toContainText("Day 2 · 1 of 4 read");
  await shot("tracker-end");
  await page.click(".bs-markread");
  await expect(page.locator(".bs-markread")).toHaveAttribute("aria-pressed", "true");
  expect(JSON.parse((await cloud(page)).read).genesis).toBe("1-6");
  await page.click(".bs-pill--book");
  await expect(page.locator(".bs-bookprog").first()).toHaveAttribute("aria-label", "6 of 50 chapters read");
  await page.click('.bs-bookrow:has-text("Genesis")');
  await expect(page.locator(".bs-chaptertile[data-read]")).toHaveCount(6);
  await shot("tracker-books");
});

test("the Bible: the Apocrypha in the 1611 order, and a search that goes to a reference or finds the words", async ({ page }) => {
  await page.route("**/api/search?**", (r) => r.fulfill({ json: { ok: true, q: "", mode: "strict", counts: {}, ms: 1, hits: [
    { kind: "verse", title: "John 1:4", url: "/bible/john/1#v4", sub: "", snippet: "In him was life; and the life was the light of men." },
    { kind: "verse", title: "Sirach 43:9", url: "/bible/sirach/43#v9", sub: "", snippet: "The beauty of heaven, the glory of the stars, an ornament giving light in the highest places of the Lord." },
  ] } }));
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.click(".bs-pill--book");
  await expect(page.locator('.bs-bookrow:has-text("2 Maccabees")')).toBeVisible();
  const apoc = await page.locator(".bs-bookrow > span:first-child").allTextContents();
  if (process.env.SHOTS) { await page.locator('.bs-bookrow:has-text("Tobit")').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS}/apocrypha.png` }); }
  const from = apoc.indexOf("1 Esdras");
  expect(apoc.slice(from, from + 15)).toEqual(["1 Esdras", "2 Esdras", "Tobit", "Judith", "Rest of Esther", "Wisdom of Solomon", "Ecclesiasticus", "Baruch", "Epistle of Jeremiah", "Song of the Three Holy Children", "History of Susanna", "Bel and the Dragon", "Prayer of Manasses", "1 Maccabees", "2 Maccabees"]);
  await press(page, "back");
  await page.keyboard.press("Escape");

  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
  await page.click(".bs-dropdown__item >> text=Search the Scriptures");
  await page.fill(".bs-search__field input", "jn 3:16");
  await expect(page.locator(".bs-search__go b")).toHaveText("Go to John 3:16");
  await page.fill(".bs-search__field input", "light of men");
  await expect(page.locator(".bs-search__hit")).toHaveCount(2);
  await expect(page.locator(".bs-search__hit b").nth(1)).toHaveText("Ecclesiasticus 43:9");
  await expect(page.locator(".bs-search__hit mark").first()).toHaveText("light");
  // Bible Strong's filters: the canon, then one book.
  await page.click('.bs-search__filters .bs-chip:has-text("Apocrypha")');
  await expect(page.locator(".bs-search__hit")).toHaveCount(1);
  await expect(page.locator(".bs-search__count")).toHaveText("1 verse in the Apocrypha");
  await page.selectOption(".bs-chip--select", "tobit");
  await expect(page.locator(".bs-search__hit")).toHaveCount(0);
  await expect(page.locator(".bs-search__hint")).toContainText("No verse has those words in Tobit. 2 elsewhere.");
  await page.click('.bs-search__filters .bs-chip:has-text("All")');
  await page.selectOption(".bs-chip--select", "");
  await expect(page.locator(".bs-search__hit")).toHaveCount(2);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/bible-search.png` });
  await page.locator(".bs-search__hit").first().click();
  await expect(page).toHaveURL(/\/read\/john\/1\?v=4/);
});

test("a verse links to each class that read it, on YouTube at that moment", async ({ page }) => {
  await page.goto(`/read/genesis/4${LAUNCH}`);
  const tag = page.locator("#verset-3 .rel-tag", { hasText: "Raising Cain" });
  await expect(tag).toBeVisible();
  if (process.env.SHOTS) { await tag.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${process.env.SHOTS}/watch-links.png` }); }
  await tag.click();
  const opened = await page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.filter((l) => l[0] === "openLink"));
  expect(opened.at(-1)?.[1]).toBe("https://www.youtube.com/watch?v=36emQd9wjts&t=3633s");
  // In this chapter (Bible Strong's ChapterEntities): the people named, as a stack of avatars at the end of the text.
  const stack = page.locator(".bs-entities__stack");
  await stack.scrollIntoViewIfNeeded();
  await expect(page.locator(".bs-entities__title")).toHaveText("In This Chapter");
  await expect(stack).toHaveAttribute("aria-label", /^People in this chapter: Cain, /);
  await expect(stack.locator("[data-person-stack]")).toHaveCount(3);
  // A tap spreads everyone over the page; Escape puts them back; a person opens their page.
  await stack.click();
  const people = page.getByRole("dialog", { name: "People in this chapter" });
  await expect(people.locator(".bs-people__item").first()).toContainText("Cain");
  await page.keyboard.press("Escape");
  await expect(people).toHaveCount(0);
  await stack.click();
  await people.getByRole("button", { name: "Open Cain" }).click();
  await expect(page).toHaveURL(/\/person\/cain-gen-4-1/);
});

test("a verse's Comments hold each class's own breakdown of it, and watch from that moment", async ({ page }) => {
  await page.goto(`/read/genesis/4${LAUNCH}`);
  await expect(page.locator("#verset-5")).toBeVisible();
  await longPressVerse(page, 5);
  await page.click('.bs-resourcetabs button >> text=Comments');
  const card = page.locator(".bs-comment", { hasText: "Bitterness: The Hidden Leaven" }).first();
  await expect(card.locator(".bs-comment__points li").first()).toContainText("Cain was very wroth, and his countenance fell");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/comments.png` });
  await card.locator(".bs-comment__watch").click();
  const opened = await page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.filter((l) => l[0] === "openLink"));
  expect(opened.at(-1)?.[1]).toBe("https://www.youtube.com/watch?v=rBRp1JXmK6U&t=2035s");
});

test("in the Bible, an open sheet shows Telegram's back button and closes with it, its ✕ or a swipe down", async ({ page }) => {
  await page.goto(`/read/genesis/4${LAUNCH}`);
  await expect(page.locator("#verset-5")).toBeVisible();
  expect((await state(page)).back).toBe(false);
  // Back button closes the open sheet, and hides again.
  await longPressVerse(page, 5);
  await page.click('.bs-resourcetabs button >> text=Comments');
  await expect(page.locator("[data-sheet-open]")).toHaveCount(1);
  await expect.poll(async () => (await state(page)).back).toBe(true);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/sheet-close.png` });
  await press(page, "back");
  await expect(page.locator("[data-sheet-open]")).toHaveCount(0);
  await expect.poll(async () => (await state(page)).back).toBe(false);
  await expect(page).toHaveURL(/\/read\/genesis\/4/);
  // The ✕ closes it.
  await page.click(".bs-pill--book");
  await page.click('.bs-picker [aria-label="Close"]');
  await expect(page.locator("[data-sheet-open]")).toHaveCount(0);
  // Other controls remain sheets: a swipe down closes Font and settings; a short one springs back.
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
  await page.getByRole("menuitem", { name: "Font and settings", exact: true }).click();
  const handle = page.getByRole("dialog", { name: "Font and settings", exact: true }).locator(".bs-sheet__handle");
  const swipe = async (dy: number) => { await page.waitForTimeout(350); const b = (await handle.boundingBox())!; const y = b.y + b.height / 2; await page.mouse.move(b.x + b.width / 2, y); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, y + dy, { steps: 8 }); await page.mouse.up(); };
  await swipe(30);
  await expect(page.locator("[data-sheet-open]")).toHaveCount(1);
  await swipe(200);
  await expect(page.locator("[data-sheet-open]")).toHaveCount(0);
  // A swipe up opens a half sheet to full height: the verse's tags.
  await tapVerse(page, 1);
  await page.locator(".bs-selected .bs-action", { hasText: /^Tags?$/ }).first().click();
  const note = page.locator(".bs-sheet").filter({ has: page.locator(".bs-sheet__titles") }).last();
  const before = (await note.boundingBox())!.height;
  await page.waitForTimeout(350);
  const t = (await note.locator(".bs-sheet__titles").boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + 10); await page.mouse.down(); await page.mouse.move(t.x + t.width / 2, t.y - 120, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await note.boundingBox())!.height).toBeGreaterThan(before + 40);
});

test("a verse's comment opens the note right where that passage is broken down", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-7")).toBeVisible();
  await longPressVerse(page, 7);
  await page.click('.bs-resourcetabs button >> text=Comments');
  const card = page.locator(".bs-comment", { hasText: "The firmament is the sky" });
  await expect(card).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/comment-g17.png` });
  await card.locator(".bs-comment__class").click();
  await expect(page).toHaveURL(/#p-genesis-1-6-8$/);
  const head = page.locator("#p-genesis-1-6-8");
  await expect(head).toBeInViewport();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/comment-g17-note.png` });
});

test("People: who is named in a verse, a page per person with family, the classes' teaching and every verse", async ({ page }) => {
  await page.goto(`/read/genesis/12${LAUNCH}`);
  await expect(page.locator("#verset-5")).toBeVisible();
  await openResources(page, 5);
  await page.click('.bs-resourcetabs button >> text=People');
  await expect(page.locator(".bs-resrow b")).toHaveText(["Abraham", "Lot", "Sarah"]);
  await page.locator(".bs-resrow", { hasText: "Abraham" }).click();
  await expect(page).toHaveURL(/\/person\/abraham-gen-11-26/);
  await expect(page.locator(".entity__name")).toHaveText("Abraham");
  await expect(page.locator(".entity__summary .entity__eyebrow")).toHaveText("Man · Early Patriarch");
  await expect(page.locator(".entity__aka")).toContainText("Abram");
  await expect(page.getByRole("region", { name: "What the classes taught" }).locator(".scard").first()).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/person.png` });
  // The family graph (Bible Strong's relationship graph): walk it, page it, go back, start again, open a profile.
  const graph = page.locator(".fg");
  await expect(graph.getByRole("button", { name: "Father, Terah" })).toBeVisible();
  await expect(graph.getByRole("button", { name: "Wife, Sarah" })).toBeVisible();
  await expect(graph.locator(".fg__foot")).toContainText("1 / 3");
  await graph.getByRole("button", { name: "Next page" }).click();
  await graph.getByRole("button", { name: /^(Son|Child), Isaac$/ }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("Isaac");
  await expect(graph.getByRole("button", { name: "Back to Abraham" })).toBeVisible();
  await expect(graph.getByRole("button", { name: "Wife, Rebekah" })).toBeVisible();
  await graph.getByRole("button", { name: "Back", exact: true }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("Abraham");
  await expect(graph.locator(".fg__foot")).toContainText("2 / 3");
  await graph.getByRole("button", { name: /^(Son|Child), Isaac$/ }).click();
  await graph.getByRole("button", { name: "Wife, Rebekah" }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("Rebekah");
  await graph.getByRole("button", { name: "Start again from Abraham" }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("Abraham");
  await expect(graph.locator(".fg__foot")).toContainText("1 / 3");
  await graph.getByRole("button", { name: "Father, Terah" }).click();
  await expect(graph.locator(".fg__label--center b")).toHaveText("Terah");
  await graph.getByRole("button", { name: "View Terah's profile" }).click();
  await expect(page).toHaveURL(/\/person\/terah-gen-11-24/);
  await expect(page.locator(".entity__name")).toHaveText("Terah");
  // Search the Scriptures finds a person by name.
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
  await page.click(".bs-dropdown__item >> text=Search the Scriptures");
  await page.fill(".bs-search__field input", "abra");
  await expect(page.locator(".bs-search__go", { hasText: "Abraham" })).toBeVisible();
});

for (const viewport of [{ width: 390, height: 780 }, { width: 1280, height: 860 }]) {
  test(`People: a person as Bible Strong shows one, scripture cards that go to their verse, and back to the same place (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/people${LAUNCH}`);
    await page.fill("#people-q", "abraham");
    // Filtering is debounced; wait for its result before the list changes under a click.
    await expect(page.getByRole("heading", { name: "1 person", exact: true })).toBeVisible();
    await page.locator(".row", { hasText: "Abraham" }).first().click();
    await expect(page).toHaveURL(/\/person\/abraham-gen-11-26/);
    // The summary card: what they are, the name, their Strong's number (to the word study), who they were.
    await expect(page.locator(".entity__summary .entity__eyebrow")).toHaveText("Man · Early Patriarch");
    await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
    await expect(page.locator(".entity__code").first()).toHaveText("H87");
    await expect(page.locator(".entity__desc")).toContainText("Patriarchs");
    await expect(page.getByRole("region", { name: "Relationships" }).locator(".fg")).toBeVisible();
    // Scripture cards: the reference and the King James text.
    const verses = page.getByRole("region", { name: "Verses" });
    await expect(verses.locator(".entity__note")).toHaveText("First named in Genesis 11:26");
    const first = verses.locator(".scard").first();
    await expect(first.locator(".scard__ref")).toHaveText("Genesis 11:26");
    await expect(first.locator(".scard__text")).toHaveText(/^And Terah lived seventy years, and begat Abram, Nahor, and Haran\.\s*$/);
    const taught = page.getByRole("region", { name: "What the classes taught" });
    await expect(taught.locator(".scard").first().locator(".scard__text")).toHaveText(/\w{3,}/);
    await expect(taught.locator(".scard").first().locator(".scard__src a")).toHaveAttribute("href", /\/note\/classes\//);
    // More verses, then one of them in the reader, picked out.
    await verses.getByRole("button", { name: /^Show 10 more/ }).click();
    await expect(verses.locator(".scard")).toHaveCount(15);
    const card = verses.locator(".scard").nth(11);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".scard__text")).toHaveText(/\w{3,}/);
    const ref = await card.locator(".scard__ref").innerText();
    const [, c, v] = /(\d+):(\d+)$/.exec(ref)!;
    const y = await page.evaluate(() => Math.round(scrollY));
    expect(y).toBeGreaterThan(200);
    await card.getByRole("link", { name: /^Go to verse/ }).click();
    await expect(page).toHaveURL(new RegExp(`/read/[a-z0-9-]+/${c}\\?v=${v}$`));
    await expect(page.locator(`#verset-${v}`)).toBeVisible();
    await expect(page.locator(`#verset-${+v + 3}`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Read whole chapter" })).toBeVisible();
    // Back: the same person, the same cards open, the same place.
    await press(page, "back");
    await expect(page).toHaveURL(/\/person\/abraham-gen-11-26/);
    await expect(verses.locator(".scard")).toHaveCount(15);
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(y - 40);
    expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(y + 40);
    // A relative's profile from the graph, and back again.
    await page.getByRole("region", { name: "Relationships" }).getByRole("button", { name: "Father, Terah" }).click();
    await page.getByRole("button", { name: "View Terah's profile" }).click();
    await expect(page).toHaveURL(/\/person\/terah-gen-11-24/);
    await expect(page.getByRole("heading", { level: 1, name: "Terah" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeLessThan(5);
    await press(page, "back");
    await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
    // Back to everyone: the search is as it was.
    await press(page, "back");
    await expect(page.locator("#people-q")).toHaveValue("abraham");
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/people-${viewport.width}.png` });
  });
}

test("People: a Strong's number opens its word study, a class card opens the class, a person who does not load says so", async ({ page }) => {
  await page.goto(`/person/abraham-gen-11-26${LAUNCH}`);
  await page.locator(".entity__code", { hasText: "H87" }).click();
  await expect(page).toHaveURL(/\/lexicon\/H87$/);
  await press(page, "back");
  const taught = page.getByRole("region", { name: "What the classes taught" }).locator(".scard").first();
  const watch = taught.getByRole("button", { name: /^Watch/ });
  if (await watch.count()) {
    await watch.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.some((r) => r[0] === "openLink" && /youtube\.com\/watch\?v=/.test(String(r[1]))))).toBe(true);
  }
  await taught.locator(".scard__src a").click();
  await expect(page).toHaveURL(/\/note\/classes\//);
  await page.route("**/api/people/nobody-here.json", (r) => r.fulfill({ status: 500, body: "" }));
  await page.goto(`/person/nobody-here${LAUNCH}`);
  await expect(page.getByText("This person did not load")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "browse everyone" })).toHaveAttribute("href", "/people");
});

for (const viewport of [{ width: 390, height: 780 }, { width: 1280, height: 860 }]) {
  test(`Case studies: era by era, a case in sections with its people and scripture, every link and the way back (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/cases${LAUNCH}`);
    await expect(page.getByRole("region", { name: "Primeval" }).locator(".caserow__name").first()).toHaveText("Adam and Eve");
    await page.fill("#case-q", "abraham");
    await expect(page.getByRole("region", { name: "Patriarchal" })).toBeVisible();
    await page.locator(".caserow", { hasText: /^Abraham/ }).first().click();
    await expect(page).toHaveURL(/\/cases\/02-patriarchal\/abraham$/);
    await expect(page.locator(".case__eyebrow")).toHaveText("Blessing · Patriarchal · C011");
    await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
    await expect(page.locator(".case__verdict")).toHaveText("Kept the law");
    await expect(page.locator(".case__charge")).toContainText("Obeying the Lord’s voice");
    for (const t of ["People in this case", "The obedience", "The blessing", "Scripture", "The law", "Precepts", "Related cases", "Taught in"]) await expect(page.getByRole("region", { name: t })).toBeVisible();
    // A reference in the writing opens its verse; back returns to the same place.
    const ref = page.getByRole("region", { name: "The obedience" }).getByRole("link", { name: "Genesis 12:1", exact: true });
    await ref.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => Math.round(scrollY));
    await ref.click();
    await expect(page).toHaveURL(/\/read\/genesis\/12\?v=1$/);
    await expect(page.locator("#verset-1")).toBeVisible();
    await press(page, "back");
    await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(y - 40);
    // Scripture cards: the text, all the verses of a long one, and the verse in the reader.
    const scripture = page.getByRole("region", { name: "Scripture" });
    const card = scripture.locator(".scard").first();
    await expect(card.locator(".scard__ref")).toHaveText("Genesis 12:1-4");
    await expect(card.locator(".scard__text")).toContainText("Now the Lord had said unto Abram, Get thee out of thy country");
    const before = await scripture.locator(".scard").count();
    await scripture.getByRole("button", { name: /^Show \d+ more/ }).click();
    await expect.poll(() => scripture.locator(".scard").count()).toBeGreaterThan(before);
    const expanded = await scripture.locator(".scard").count();
    await card.getByRole("link", { name: /^Go to verse/ }).click();
    await expect(page).toHaveURL(/\/read\/genesis\/12\?v=1-4$/);
    await expect(page.locator("#verset-4")).toBeVisible();
    await expect(page.locator("#verset-6")).toHaveCount(0);
    await press(page, "back");
    await expect(scripture.locator(".scard")).toHaveCount(expanded);
    // Its people, and back from them; a related case.
    await page.getByRole("region", { name: "People in this case" }).getByRole("link", { name: /Abraham/ }).click();
    await expect(page).toHaveURL(/\/person\/abraham-gen-11-26$/);
    const related = page.getByRole("region", { name: "Related case studies" });
    await expect(related.locator(".ccard__name")).toContainText(["Abraham", "Rebekah and Abraham’s servant"]);
    await expect(related.locator(".ccard").first().locator(".ccard__preview")).toContainText("Called alone out of Ur");
    await press(page, "back");
    await expect(page).toHaveURL(/\/cases\/02-patriarchal\/abraham$/);
    const rel = page.getByRole("region", { name: "Related cases" }).locator(".ccard").first();
    const relName = await rel.locator(".ccard__name").innerText();
    await rel.click();
    await expect(page.getByRole("heading", { level: 1, name: relName })).toBeVisible();
    await press(page, "back");
    await press(page, "back");
    await expect(page.locator("#case-q")).toHaveValue("abraham");
  });
}

test("Case studies: a person's related case opens it, and the case links back; a case that does not load says so", async ({ page }) => {
  await page.goto(`/person/rachel-gen-29-6${LAUNCH}`);
  const related = page.getByRole("region", { name: "Related case studies" });
  await related.locator(".ccard", { hasText: "Rachel and the stolen teraphim" }).getByText("Open case study").click();
  await expect(page).toHaveURL(/\/cases\/[a-z0-9-]+\/rachel-and-the-teraphim$/);
  await expect(page.locator(".case__eyebrow")).toContainText("Judgment");
  await page.getByRole("region", { name: "People in this case" }).getByRole("link", { name: /Rachel/ }).click();
  await expect(page).toHaveURL(/\/person\/rachel-gen-29-6$/);
  await page.route("**/api/cases/nothing-here.json", (r) => r.fulfill({ status: 500, body: "" }));
  await page.goto(`/cases/01-primeval/nothing-here${LAUNCH}`);
  await expect(page.getByText("This case did not load")).toBeVisible();
  await expect(page.getByRole("link", { name: "browse every case" })).toHaveAttribute("href", "/cases");
});

test("the collapsed bar keeps the section or Menu beside the fixed Search circle", async ({ page }) => {
  await page.goto(`/cases/02-patriarchal/abraham${LAUNCH}`);
  await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
  const bar = page.locator("nav.tabs");
  await page.mouse.move(195, 400);
  for (let i = 0; i < 8 && !(await bar.getAttribute("data-mini")); i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
  await expect(bar).toHaveAttribute("data-mini", "");
  await expect.poll(() => bar.evaluate((n) => { const r = n.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })).toBe("105x48");
  const kept = bar.locator(".tab[data-kept]");
  await expect(kept).toHaveCount(1);
  await expect(kept).toHaveAttribute("aria-label", "Menu");
  const box = await kept.boundingBox(), outer = await bar.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(outer!.width).toBeGreaterThan(box!.width);
  await expect(bar.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await kept.click();
  await expect(bar).not.toHaveAttribute("data-mini");
});

for (const viewport of [{ width: 390, height: 780 }, { width: 1280, height: 860 }]) {
  test(`The Law: parts and sections, a section's laws with their scripture, its cases, and the way back (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/law${LAUNCH}`);
    await expect(page.getByRole("region", { name: "The Ten Commandments" })).toBeVisible();
    await page.fill("#law-q", "obedience");
    await page.locator(".laws__part .lawlink", { hasText: "Obedience and Submission" }).click();
    await expect(page).toHaveURL(/\/law\/02-relationship-to-god\/2h$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("2H Obedience and Submission");
    // A law: its words as the title, then its scripture set apart, the first chosen.
    const first = page.getByRole("article", { name: "Law 2H.1", exact: true });
    await expect(first.getByRole("heading", { level: 2 })).toHaveText("You shall obey the voice of the LORD your God.");
    await expect(first.locator(".lawcard__cite")).toHaveText(/^Exodus 15:26/);
    await expect(first.locator("blockquote")).toContainText("If thou wilt diligently hearken to the voice of the Lord thy God");
    // Eight scriptures: three shown, the rest a tap away.
    await expect(first.getByRole("tab")).toHaveCount(3);
    await first.getByRole("button", { name: "+5 more" }).click();
    await expect(first.getByRole("tab")).toHaveCount(8);
    // Another of its scriptures, then that verse in the reader, and back to the same place.
    await first.getByRole("tab", { name: "Deuteronomy 13:4" }).click();
    await expect(first.getByRole("tab", { name: "Deuteronomy 13:4" })).toHaveAttribute("aria-selected", "true");
    await expect(first.locator(".lawcard__cite")).toHaveText(/^Deuteronomy 13:4/);
    await expect(first.locator("blockquote")).toContainText("Ye shall walk after the Lord your God");
    const y = await page.evaluate(() => Math.round(scrollY));
    await first.getByRole("link", { name: "Go to verse: Deuteronomy 13:4" }).click();
    await expect(page).toHaveURL(/\/read\/deuteronomy\/13\?v=4$/);
    await expect(page.locator("#verset-4")).toBeVisible();
    await press(page, "back");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("2H Obedience and Submission");
    await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBeGreaterThan(y - 40);
    // The cases judged under it, all of them, one opened.
    const cases = page.getByRole("region", { name: "Cases under this law" });
    await expect(cases.locator(".ccard")).toHaveCount(4);
    await cases.getByRole("button", { name: /^Show all 39/ }).click();
    await expect(cases.locator(".ccard")).toHaveCount(39);
    await cases.locator(".ccard", { hasText: "Enoch" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Enoch" })).toBeVisible();
    await press(page, "back");
    await expect(cases.locator(".ccard")).toHaveCount(39);
    // Related laws, verified by the handbook's own "see also".
    await expect(page.getByRole("region", { name: "Related laws" }).locator(".lawlink", { hasText: "Judgment and Punishment" })).toBeVisible();
    // Its part, and back to the handbook with the search as it was.
    await page.getByRole("link", { name: "Part 2 · Relationship to God" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Relationship to God" })).toBeVisible();
    await press(page, "back");
    await press(page, "back");
    await expect(page.locator("#law-q")).toHaveValue("obedience");
  });
}

test("The Law: a law found by its words opens in its section, brought into view; a part narrows the handbook and Reset clears it", async ({ page }) => {
  await page.goto(`/law${LAUNCH}`);
  await page.fill("#law-q", "usury");
  const hits = page.getByRole("region", { name: "Laws that say this" });
  await expect(hits.locator(".lawlink").first()).toBeVisible();
  const hit = hits.locator(".lawlink").first();
  const id = (await hit.locator(".lawlink__code").innerText()).trim();
  await expect(hit).toContainText(/usury/i);
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`#${id.replace(".", "\\.")}$`));
  const card = page.getByRole("article", { name: `Law ${id}`, exact: true });
  await expect(card).toHaveAttribute("data-flash", "");
  await expect(card).toBeInViewport();
  await press(page, "back");
  await expect(page.locator("#law-q")).toHaveValue("usury");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.locator("#law-q")).toHaveValue("");
  // One part only.
  await page.getByRole("button", { name: "Part: every part" }).click();
  await page.locator(".sheet__item", { hasText: "9. Feasts and observances" }).click();
  await expect(page.locator(".laws__part")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Feasts and observances" })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("region", { name: "The Ten Commandments" })).toBeVisible();
});

test("Classes: a feed of posts with the series, filters and search, kept on the way back from a class", async ({ page }) => {
  await page.goto(`/classes${LAUNCH}`);
  const series = page.getByRole("group", { name: "Series" });
  await expect(series.getByRole("button", { name: /^All\s?[\d,]+$/ })).toHaveAttribute("aria-pressed", "true");
  await series.getByRole("button", { name: /^Captains\s?[\d,]+$/ }).click();
  await expect(page).toHaveURL(/feed=captains/);
  const post = page.locator("article.post").first();
  await expect(post.locator(".post__who b")).toHaveText(/^Captain /);
  await expect(post.locator(".post__who time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  await page.fill("#class-q", "passover");
  // A series changed with a search typed keeps the search.
  await series.getByRole("button", { name: /^All\s?[\d,]+$/ }).click();
  await expect(page).not.toHaveURL(/feed=/);
  await expect(page.locator("#class-q")).toHaveValue("passover");
  const title = (await post.locator(".post__title").innerText()).trim();
  await post.locator(".post__title a").click();
  await expect(page).toHaveURL(/\/note\//);
  await expect(page.getByText("Class notes", { exact: true }).first()).toBeVisible();
  await press(page, "back");
  await expect(page).toHaveURL(/\/classes(\?|$)/);
  await expect(page.locator("#class-q")).toHaveValue("passover");
  await expect(page.locator("article.post").first().locator(".post__title")).toHaveText(title);
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.locator("#class-q")).toHaveValue("");
});

test("Classes: a class in a series is labelled by it, and the series opens in order", async ({ page }) => {
  await page.goto(`/classes${LAUNCH}`);
  await page.fill("#class-q", "Navigating Through Paul");
  const post = page.locator("article.post").first();
  const name = post.getByRole("button", { name: "Navigating Through Paul's Letters", exact: true });
  await expect(name).toBeVisible();
  await expect(post.locator(".post__who")).not.toContainText("Sabbath class");
  await name.click();
  await expect(page).toHaveURL(/series=Navigating/);
  const posts = page.locator("article.post");
  await expect.poll(() => posts.count()).toBeGreaterThan(1);
  // Oldest first, as the series was taught.
  const dates = await page.locator("article.post .post__who time").evaluateAll((els) => els.map((e) => e.getAttribute("datetime") ?? ""));
  expect(dates).toEqual([...dates].sort());
  // Leaving the series shows every class again.
  await page.getByRole("button", { name: /^Series: Navigating/ }).click();
  await expect(page).not.toHaveURL(/series=/);
});

test("Classes: one recording plays at a time, a preview reads on, the scripture opens, and a class is saved", async ({ page }) => {
  // Exercise a written class, not whichever new upload the live channel currently puts first.
  const classes = Array.from({ length: 14 }, (_, i) => ({
    title: `Class fixture ${i + 1}`, url: `/classes/fixture-${i + 1}`, date: "2026-01-01", year: "2026",
    teacher: "Test teacher", thumb: "", books: ["Genesis"], videoId: String(i).padStart(11, "a"),
    intro: "The class opens the Scriptures and reads the passage in its context. ".repeat(12),
    opens: [{ label: "Genesis 1", slug: "genesis", chapter: 1 }],
  }));
  await page.route(`${DATA_ORIGIN}/search/classes.json`, r => r.fulfill({ json: classes }));
  await page.route(`${DATA_ORIGIN}/search/captains.json`, r => r.fulfill({ json: [] }));
  await page.route(`${DATA_ORIGIN}/api/history/index.json`, r => r.fulfill({ json: [] }));
  await page.route("**/api/recent", r => r.fulfill({ json: { videos: [] } }));
  await page.goto(`/classes${LAUNCH}`);
  const posts = page.locator("article.post");
  await expect(posts).toHaveCount(12);
  const [a, b] = [posts.nth(0), posts.nth(1)];
  // Nothing plays until asked; then only the one asked for.
  await expect(page.locator("article.post iframe")).toHaveCount(0);
  await a.getByRole("button", { name: "Watch" }).click();
  await expect(a.locator("iframe")).toHaveCount(1);
  // Bring the next control into view before click's stability checks run.
  await b.getByRole("button", { name: "Watch" }).scrollIntoViewIfNeeded();
  await b.getByRole("button", { name: "Watch" }).click();
  await expect(b.locator("iframe")).toHaveCount(1);
  await expect(a.locator("iframe")).toHaveCount(0);
  await b.getByRole("button", { name: "Stop" }).click();
  await expect(page.locator("article.post iframe")).toHaveCount(0);
  // The preview is cut at three lines with Read more; read on, the full notes are a tap away. The
  // newest class may not have its notes yet (they are written after it airs), so this uses the
  // first class in the feed that has them.
  const c = posts.filter({ has: page.locator(".post__intro") }).first();
  const intro = c.locator(".post__intro");
  const short = await intro.evaluate((e) => e.clientHeight);
  await c.getByRole("button", { name: "Read more" }).click();
  await expect(intro).toHaveAttribute("data-open", "");
  expect(await intro.evaluate((e) => e.clientHeight)).toBeGreaterThan(short);
  await expect(c.getByRole("link", { name: "Read the full notes" })).toHaveAttribute("href", /^\/note\//);
  // The chapters the class opened, in order, each to the reader.
  await c.getByRole("button", { name: /^Scripture/ }).click();
  const ref = c.locator(".post__ref").first();
  await expect(ref).toHaveAttribute("href", /^\/read\/[a-z0-9-]+\/\d+$/);
  // Saved to the bookmarks, and unsaved.
  await c.getByRole("button", { name: "Save", exact: true }).click();
  await expect(c.getByRole("button", { name: "Remove from saved" })).toHaveAttribute("aria-pressed", "true");
  await c.getByRole("button", { name: "Remove from saved" }).click();
  // More posts come as the feed nears its end, none twice.
  await page.locator(".cfeed__more").scrollIntoViewIfNeeded();
  await expect.poll(() => posts.count()).toBeGreaterThan(12);
  const urls = await page.locator("article.post .post__title a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(new Set(urls).size).toBe(urls.length);
});

for (const width of [320, 390, 820, 1280]) {
  test(`Classes, the Law and Ask fit their screens: no sideways scroll (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    for (const path of ["/classes", "/law", "/law/02-relationship-to-god/2h"]) {
      await page.goto(`${path}${LAUNCH}`);
      await expect(page.locator("article.post, .laws__part, .lawcard").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(0);
    }
    await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false, unlimited: false, balance: {}, perQuestion: 1, freeDaily: 0, plan: {}, packs: [] } }));
    const wide = "A long answer.\n\n| Scripture | Read for |\n| --- | --- |\n| Genesis 12:1 | The call |\n\n```\n" + "x".repeat(300) + "\n```\n\nhttps://cyberjudah.io/" + "y".repeat(200) + " and Abrahamicpromisecovenantseedblessinglandnationsfamiliesearth.";
    await page.route("**/api/ask", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson({ delta: wide }, { done: true, answer: wide, sources: [SOURCE] }) }));
    await page.goto(`/ask${LAUNCH}`);
    await page.fill('textarea[aria-label="Your question"]', "Why? ".repeat(80));
    await page.keyboard.press("Enter");
    await expect(page.locator(".msg--ai .msg__text pre")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "/ask").toBeLessThanOrEqual(0);
    // The last of the conversation clears the composer.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const actions = await page.locator(".msg__actions").last().boundingBox();
    const composer = await page.locator(".composer2").boundingBox();
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(composer!.y + 1);
  });
}

test("Ask: scripture in an answer opens the verse, and a source card shows its words", async ({ page }) => {
  await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false, unlimited: false, balance: {}, perQuestion: 1, freeDaily: 0, plan: {}, packs: [] } }));
  const answer = "The Lord called him alone (Genesis 12:1), and Isaiah 51:2 says the same [1].";
  await page.route("**/api/ask", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson({ delta: answer }, { done: true, answer, followups: [], sources: [{ ...SOURCE, text: "Look unto Abraham your father, and unto Sarah that bare you" }] }) }));
  await page.goto(`/ask${LAUNCH}`);
  await page.fill('textarea[aria-label="Your question"]', "Why was Abraham called alone?");
  await page.keyboard.press("Enter");
  const text = page.locator(".msg--ai .msg__text");
  await expect(text.getByRole("link", { name: "Isaiah 51:2" })).toBeVisible();
  await expect(page.locator(".msg--ai .srccard__text")).toContainText("Look unto Abraham your father");
  await text.getByRole("link", { name: "Genesis 12:1" }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/12\?v=1$/);
  await expect(page.locator("#verset-1")).toBeVisible();
  await press(page, "back");
  await expect(page.locator(".msg--ai .msg__text")).toContainText("called him alone");
});

test("Library: The Lost Tribes a Myth, page by page with its scans and maps, and the classes that read it", async ({ page }) => {
  await page.goto(`/more${LAUNCH}`);
  await page.locator('a[href$="/books"]').first().click();
  await expect(page).toHaveURL(/\/books$/);
  await page.locator("a", { hasText: "The Lost Tribes a Myth" }).click();
  await expect(page.locator("h1.title")).toHaveText("The Lost Tribes a Myth");
  await expect(page.locator(".book__figures .book__figure")).toHaveCount(3);
  await expect(page.locator(".book__read").first()).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book.png` });
  // A map opens full screen and closes.
  await page.locator(".book__figures .book__figure").first().click();
  await expect(page.locator(".pv")).toBeVisible();
  // The classes that showed the map, with their words, under the picture.
  await expect(page.locator(".pv__class").first()).toBeVisible();
  await expect(page.locator(".pv .said__line").first()).toBeVisible();
  await page.click('.pv [aria-label="Zoom in"]');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-map.png` });
  // The handle under the picture drags: up, the words take the whole screen and the picture shrinks to a corner; down, the picture comes back; down again, the words tuck away.
  const dragGrab = async (dy: number) => {
    await page.waitForTimeout(450); // let the panel settle where it is going
    const g = (await page.locator(".pv__grabbar").boundingBox())!;
    const x = g.x + g.width / 2, y = g.y + g.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + dy / 2); await page.mouse.move(x, y + dy); await page.mouse.up();
  };
  await expect(page.locator(".pv--words")).toBeVisible();
  await dragGrab(-100);
  await expect(page.locator(".pv--full")).toBeVisible();
  await expect(page.locator(".pv__mini")).toBeVisible();
  await expect(page.locator(".pv__grab svg")).toHaveCount(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-map-words-full.png` });
  await dragGrab(100);
  await expect(page.locator(".pv--words")).toBeVisible();
  await expect(page.locator(".pv__mini")).toHaveCount(0);
  await dragGrab(100);
  await expect(page.locator(".pv--words")).toHaveCount(0);
  await expect(page.locator(".pv__stage img")).toBeVisible();
  await page.click(".pv__grabbar"); // a tap brings the words back
  await expect(page.locator(".pv--words")).toBeVisible();
  await page.click('.pv [aria-label="Next picture"]');
  await expect(page.locator(".pv__title b")).toContainText("From Asia Minor");
  await page.click('.pv [aria-label="Close"]');
  await expect(page.locator(".pv")).toHaveCount(0);
  // Chapter X, page by page, with the classes that read each page.
  await page.locator("a", { hasText: "Berber, Moorish, and Negro Jews" }).click();
  await expect(page.locator("#pg-246 .bookpage__read").first()).toBeVisible();
  await page.locator("#pg-246 .bookpage__scan").click();
  await expect(page.locator("#pg-246 img.bookpage__img")).toHaveAttribute("src", /archive\.org\/download\/losttribesmythsu00godb\/page\/n\d+_w1200\.jpg/);
  await expect(page.locator(".book__figure--wide")).toBeVisible();
  // A page link from a class lands on that page.
  await page.goto(`/books/lost-tribes-a-myth/p/1-246${LAUNCH}`);
  await expect(page).toHaveURL(/\/books\/lost-tribes-a-myth\/\d+\?p=246/);
  await expect(page.locator("#pg-246")).toHaveClass(/bookpage--at/);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-page.png` });
  // The class note names the book and its pages.
  await page.goto(`/note/classes/2026/2026-07-12-raising-up-the-tabernacle-of-david-that-fell${LAUNCH}`);
  await expect(page.locator(".readfrom", { hasText: "The Lost Tribes a Myth" })).toBeVisible();
  // A book of several volumes: its chapters grouped by volume, and a picture opens from a page.
  await page.goto(`/books${LAUNCH}`);
  // Covers load from the data set.
  await expect.poll(() => page.locator(".row__thumb img").first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/library.png` });
  await page.locator("a", { hasText: "The Two Babylons" }).click();
  await expect(page.locator(".book__figures .book__figure").first()).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-babylons.png` });
  await page.locator(".list a", { hasText: "Objects of Worship" }).click();
  await expect(page.locator(".bookpage__fig").first()).toBeVisible();
  await page.locator(".bookpage__fig").first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".bookpage__fig img").first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-figure-page.png` });
  // A page's reading opens to the words spoken as it was read.
  await page.locator(".bookpage__readhead").first().click();
  await expect(page.locator(".bookpage__said .said__line").first()).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-said.png` });
  await page.locator(".bookpage__fig").first().click();
  await expect(page.locator(".pv")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/book-figure-words.png` });
});

test("Strong's: a verse's words open the Hebrew or Greek behind them, with every verse that uses it", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await longPressVerse(page, 1);
  await page.click('.bs-resourcetabs button >> text=Words');
  await expect(page.locator(".bs-words__w", { hasText: "God" }).first()).toContainText("H430");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/strongs-words.png` });
  await page.locator(".bs-words__w", { hasText: "God" }).first().click();
  await expect(page.locator(".bs-word__lemma")).toHaveText("אֱלֹהִים");
  await expect(page.locator(".bs-word__meta b")).toHaveText("ʼĕlôhîym");
  await expect(page.locator(".bs-word__book").first()).toBeVisible();
  if (process.env.SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOTS}/strongs-word.png` }); }
  // A verse in the concordance opens in the reader.
  await page.locator(".bs-word__book").first().locator(".bs-word__bookhead").click();
  await page.locator(".bs-word__book li button").nth(1).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2/);
});

test("a verse's Comments list every class that read it aloud, from the transcripts, each opening the class at that second", async ({ page }) => {
  await page.goto(`/read/isaiah/61${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await longPressVerse(page, 1);
  await page.click('.bs-resourcetabs button >> text=Comments');
  await expect(page.locator(".bs-resources__sub", { hasText: /^Read in / })).toBeVisible();
  const rows = page.locator(".bs-readin__row");
  await expect(rows.first()).toBeVisible();
  await expect(rows.first().locator(".bs-readin__ts")).toContainText(/\d+:\d\d/);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/read-in-class.png` });
  await rows.first().click();
  await expect(page).toHaveURL(/\/(watch|note)\/.*[?&]t=\d+/);
});

test("Side by side puts a verse beside its precepts and its cross references, each written out", async ({ page }) => {
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await tapVerse(page, 1);
  await page.click(".bs-tabsfooter__tab >> text=Study");
  await page.click(".bs-action >> text=Side by side");
  await expect(page.locator(".bs-compare__verse")).toContainText("The Lord is my shepherd");
  await page.click('.bs-compare__lanes button >> text=Cross references');
  await expect(page.locator(".bs-compare__item").first()).toBeVisible();
  await expect(page.locator(".bs-compare__item .bs-compare__text").first()).not.toBeEmpty();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/compare.png` });
  await page.locator(".bs-compare__ref").first().click();
  await expect(page).toHaveURL(/\/read\//);
});

test("a topic's thread strings the scriptures its classes opened, in Bible order, with the classes and precepts under each", async ({ page }) => {
  await page.goto(`/topics/captivity${LAUNCH}`);
  await expect(page.locator(".thread__stop").first()).toBeVisible();
  const refs = await page.locator(".thread__ref b").allTextContents();
  expect(refs.length).toBeGreaterThan(3);
  await page.locator(".thread__head").first().click();
  await expect(page.locator(".thread__stop--open .thread__class").first()).toBeVisible();
  await expect(page.locator(".thread__stop--open .thread__read")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/thread.png` });
});

test("Home shows what landed lately: passes, books and classes", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".whatsnew__card").first()).toBeVisible();
  await expect(page.locator(".whatsnew__card[data-kind='book']").first()).toBeVisible();
  // Precept passes are working data behind the verse notes; Home does not list them.
  await expect(page.locator(".whatsnew__card[data-kind='pass']")).toHaveCount(0);
});

test("an Apocrypha verse shows its Greek from Swete's Septuagint where the 66 books show Strong's", async ({ page }) => {
  await page.goto(`/read/tobit/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await longPressVerse(page, 1);
  await page.click('.bs-resourcetabs button >> text=Words');
  await expect(page.locator(".bs-greek__text")).toContainText("ΒΙΒΛΟΣ");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/greek.png` });
});

test("the Library searches inside every book, page by page", async ({ page }) => {
  await page.route("**/api/search?**", (r) => r.fulfill({ json: { ok: true, q: "Falasha", mode: "strict", counts: { book: 2 }, ms: 3, hits: [
    { kind: "book", title: "The Lost Tribes a Myth", url: "/books/lost-tribes-a-myth/p/1-256", sub: "p. 256 · Yemen Jews and Falashas", snippet: "…the Falashas of Abyssinia keep the Sabbath…" },
    { kind: "book", title: "The Jewish Encyclopedia", url: "/books/jewish-encyclopedia/p/5-12", sub: "vol. 5, p. 12 · FALASHAS", snippet: "…FALASHAS: Ethiopian Jews…" },
  ] } }));
  await page.goto(`/books${LAUNCH}`);
  await page.fill("#book-q", "Falasha");
  await page.press("#book-q", "Enter");
  await expect(page.locator(".section__head h2", { hasText: "2 pages" })).toBeVisible();
  await page.locator('a[href="/books/lost-tribes-a-myth/p/1-256"]').click();
  await expect(page).toHaveURL(/\/books\/lost-tribes-a-myth\//); // the page link lands in its chapter, at the page
});

test("Reader: the classes that taught a verse are a deck after it; it spreads into a gallery and plays the class in place", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator(".bs-deck").first()).toBeVisible();
  // Verse 28 was taught by several classes: a fanned deck of up to three, inside the verse, after its text.
  const deck = page.locator("#verset-28 .bs-deck");
  await expect(deck).toHaveAttribute("aria-label", /classes? taught this/);
  const cards = deck.locator(".bs-deck__card");
  expect(await cards.count()).toBeGreaterThan(1);
  expect(await cards.count()).toBeLessThanOrEqual(3);
  expect(await cards.first().evaluate((el) => el.style.transform)).toContain("rotate(-5deg)");
  await deck.click();
  const gallery = page.locator(".bs-gallery");
  await expect(gallery).toBeVisible();
  const items = gallery.locator(".bs-gallery__item");
  await expect(items.first()).toBeVisible();
  // The Bishops' teaching comes first, each with the moment's time on its picture.
  await expect(items.first().locator("small")).toContainText(/Bishop|Deacon/);
  await expect(items.first().locator(".bs-gallery__badge")).toHaveText(/^\d+:\d{2}(:\d{2})?$/);
  // Its close sits at the bottom centre, where the Home drawer keeps its own.
  const x = await gallery.locator(".bs-gallery__close").boundingBox();
  const vp = page.viewportSize()!;
  expect(Math.abs(x!.x + x!.width / 2 - vp.width / 2)).toBeLessThan(2);
  expect(x!.y).toBeGreaterThan(vp.height * 0.8);
  await page.waitForTimeout(700);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/class-gallery.png` });
  // A card plays the class right there, at that moment, without leaving the chapter.
  await items.first().locator(".bs-gallery__btn").click();
  const frame = gallery.locator(".bs-player__box iframe");
  await expect(frame).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?.*start=\d+/);
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  if (process.env.SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.SHOTS}/class-playing.png` }); }
  // Its notes are one tap away.
  await gallery.locator(".bs-player__actions button", { hasText: "Class notes" }).click();
  await expect(page).toHaveURL(/[?&]t=\d+/);
});

test("Reader: the chapter ends with a deck of every class that taught it", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.locator("#verset-31").scrollIntoViewIfNeeded();
  const deck = page.locator('.bs-deck:not(#verset-31 *)').last();
  await deck.scrollIntoViewIfNeeded();
  await expect(deck).toBeVisible();
  await deck.click();
  // The classes whose notes teach it first, then every other class the transcripts find reading it.
  const heads = page.locator(".bs-gallery__sections h2");
  await expect(heads.first()).toContainText("Taught from Genesis 1");
  await expect(heads.nth(1)).toContainText("Read in class");
  // Escape (or Telegram's back button) closes the gallery.
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-gallery")).toHaveCount(0);
});

/** The notes-request API as the worker serves it, kept in the page: CI's worker has no bot token to check the reader with. */
async function mockNoteRequests(page: Page) {
  const asked: { video: string; title: string }[] = [];
  await page.route("**/api/requests/*", (r) => {
    const video = r.request().url().split("/").pop()!.split("?")[0];
    if (r.request().method() === "POST") { asked.push({ video, title: (r.request().postDataJSON() as { title: string }).title }); return r.fulfill({ json: { ok: true, count: 3, mine: true, added: true } }); }
    return r.fulfill({ json: { ok: true, count: 2, mine: false } });
  });
  return asked;
}

test("Reader: a class read in the chapter without notes plays in place, and its notes can be requested", async ({ page }) => {
  const asked = await mockNoteRequests(page);
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.locator("#verset-31").scrollIntoViewIfNeeded();
  const deck = page.locator('.bs-deck:not(#verset-31 *)').last();
  await deck.scrollIntoViewIfNeeded();
  await deck.click();
  const read = page.locator(".bs-gallery__sections section").nth(1);
  await expect(read.locator("h2")).toContainText("Read in class");
  // Many classes read Genesis 1: the gallery shows the first of them, the rest on request.
  const more = read.locator(".bs-gallery__more");
  if (await more.count()) { const before = await read.locator(".bs-gallery__item").count(); await more.click(); expect(await read.locator(".bs-gallery__item").count()).toBeGreaterThan(before); }
  await read.locator(".bs-gallery__btn").first().click();
  const ask = page.locator(".bs-player__actions .request-notes");
  await expect(ask).toBeVisible();
  await expect(page.locator(".bs-player__actions button", { hasText: "Class notes" })).toHaveCount(0);
  await expect(ask).toHaveText("Request notes · 2 asked");
  await ask.click();
  await expect(ask).toHaveText("Notes requested · you and 2 others");
  await expect(ask).toBeDisabled();
  expect(asked).toHaveLength(1);
  expect(asked[0].title).not.toBe("");
});

test("Ask is on the bottom bar: it opens Ask CyberJudah in its own tab", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  const ask = page.locator('.tab[aria-label="Ask"]');
  await expect(ask).toBeVisible();
  await ask.click();
  await expect(page).toHaveURL(/\/ask/);
  await expect(ask).toHaveAttribute("aria-current", "page");
  if (process.env.SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.SHOTS}/ask-tab.png` }); }
  // The Bible is still its own tab to go back to.
  await page.click('.tab[aria-label="Bible"]');
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
});

test("an opened class keeps the tab bar, with its actions floating above it", async ({ page }) => {
  await page.route(`${DATA_ORIGIN}/api/notes/classes/2026/2026-09-26-keep-the-bar.json`, (r) => r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ kind: "class", title: "Keep the bar", url: "/classes/2026/2026-09-26-keep-the-bar", date: "2026-09-26", teacher: "Captain Joel", videoId: "eNMvid6j-qk", body: "## Scriptures Opened\n\nThe remnant is gathered." }),
  }));
  await page.goto(`/note/classes/2026/2026-09-26-keep-the-bar${LAUNCH}`);
  await expect(page.locator(".pageactions")).toBeVisible();
  await expect(page.locator(".tabs").first()).toBeVisible();
  await expect(page.locator('.tabs .tab[aria-label="Ask"]')).toBeVisible();
  expect(await state(page)).toMatchObject({ main: null, second: null });
  const actions = await page.locator(".pageactions").boundingBox();
  const bar = await page.locator(".tabs").first().boundingBox();
  expect(actions!.y + actions!.height).toBeLessThanOrEqual(bar!.y + 1);
});

test("the bottom bar sits above the Bible, and each reader chooses its buttons", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  // Nothing covers the bar: the topmost element at its top edge and at its middle is the bar.
  const bar = (await page.locator(".tabs").boundingBox())!;
  for (const y of [bar.y + 2, bar.y + bar.height / 2]) {
    expect(await page.evaluate(([x, yy]) => !!document.elementFromPoint(x, yy)?.closest(".tabs"), [bar.x + bar.width / 2, y])).toBe(true);
  }
  await expect(page.locator('.tab[aria-label="Classes"]')).toBeVisible();
  // A long press opens the editor.
  const home = (await page.locator('.tab[aria-label="Home"]').boundingBox())!;
  await page.mouse.move(home.x + home.width / 2, home.y + home.height / 2);
  await page.mouse.down(); await page.waitForTimeout(750); await page.mouse.up();
  await expect(page).toHaveURL(/\/settings\/bar/);
  await expect(page.getByRole("button", { name: "Remove Search", exact: true })).toHaveCount(0);
  await page.click('[aria-label="Add Library"]');
  await page.click('[aria-label="Move Library up"]');
  await expect(page.locator(".tabs .tab")).toHaveCount(8);
  const labels = await page.locator(".tabs .tab").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(labels).toEqual(["Home", "Bible", "Classes", "Ask", "Library", expect.stringMatching(/^Tabs/), "Menu", "Search"]);
  // Scrolling the editor may have shrunk the bar to its capsule: a tap on it opens it first.
  if (await page.locator("nav.tabs[data-mini]").count()) await page.locator("nav.tabs .tab[data-on]").click();
  await page.click('.tab[aria-label="Library"]');
  await expect(page).toHaveURL(/\/books/);
  // The choice is kept with the reader's other settings, in Telegram's cloud.
  expect(JSON.parse((await cloud(page)).nav)).toEqual(["home", "bible", "classes", "ask", "library", "tabs"]);
});

test("a back step from the first screen stays in the app instead of going to a blank page", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  // A phone's back gesture or Telegram Desktop's back walks the page's history.
  for (let i = 0; i < 3; i++) { await page.goBack().catch(() => {}); await page.waitForTimeout(250); }
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  await expect(page.locator("#verset-1")).toBeVisible();
  await expect(page.locator(".tabs")).toBeVisible();
});

// ── Ask CyberJudah and saved chats ──────────────────────────────────────────────────────────
const ndjson = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
const SOURCE = { n: 1, kind: "class", title: "Passover class", url: "/classes/2026/passover", sub: "Why we keep it", text: "…" };

test("Ask: a question streams in its answer with sources, saved to the chat it names, and a retry replaces it", async ({ page }) => {
  const bodies: { q: string; chat: string; retry: boolean; history: unknown[] }[] = [];
  await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false, unlimited: false, balance: {}, perQuestion: 1, freeDaily: 0, plan: {}, packs: [] } }));
  await page.route("**/api/ask", async (r) => {
    bodies.push(r.request().postDataJSON());
    await r.fulfill({ contentType: "application/x-ndjson", body: ndjson({ status: "Searching the library" }, { delta: "It is commanded [1]." }, { done: true, answer: "It is commanded [1].", followups: ["When is it kept?"], sources: [SOURCE] }) });
  });
  await page.goto(`/ask${LAUNCH}`);
  await page.fill('textarea[aria-label="Your question"]', "Why do we keep the Passover?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg--ai .msg__text")).toContainText("It is commanded");
  await expect(page.locator(".msg--ai .srccard")).toHaveCount(1);
  await expect(page.locator(".followup")).toHaveText(["When is it kept?"]);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].chat).toMatch(/^[a-z0-9]{8,40}$/);
  // Retry asks again in the same chat and tells the server to replace the exchange.
  await page.click('.msg__action[aria-label="Ask again"]');
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ q: "Why do we keep the Passover?", chat: bodies[0].chat, retry: true });
  await expect(page.locator(".msg--me")).toHaveCount(1);
  // Wait for the retried answer to settle before checking that it survives a reload.
  await expect(page.getByRole("button", { name: "Ask again", exact: true })).toBeVisible();
  await expect(page.locator(".msg--ai .msg__text")).toContainText("It is commanded");
  await page.reload();
  await expect(page.locator(".msg--ai .msg__text")).toContainText("It is commanded");
});

test("Ask: every failure says what happened, with a way on", async ({ page }) => {
  await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false } }));
  const cases: [number, unknown, RegExp][] = [
    [400, { error: "too-short" }, /fuller question/],
    [401, { error: "unauthorized", reason: "missing" }, /Open CyberJudah from Telegram/],
    [429, { error: "limit" }, /hundred questions today/],
  ];
  for (const [status, body, text] of cases) {
    await page.unroute("**/api/ask");
    await page.route("**/api/ask", (r) => r.fulfill({ status, contentType: "application/x-ndjson", body: ndjson(body) }));
    await page.goto(`/ask${LAUNCH}`);
    // The conversation is kept per account (cj:ask:<user id>); user 1 signs LAUNCH.
    await page.evaluate(() => localStorage.removeItem("cj:ask:1"));
    await page.reload();
    await page.fill('textarea[aria-label="Your question"]', "Who was Melchizedek?");
    await page.keyboard.press("Enter");
    await expect(page.locator(".msg__error")).toContainText(text);
  }
  // A failure after part of the answer keeps the part and says it was cut off.
  await page.unroute("**/api/ask");
  await page.route("**/api/ask", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson({ delta: "Melchizedek was king of Salem" }, { error: "unavailable" }) }));
  await page.fill('textarea[aria-label="Your question"]', "Who was Melchizedek?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg__cut")).toBeVisible();
  await expect(page.locator(".msg--ai").last()).toContainText("king of Salem");
  await expect(page.locator('.msg__action[aria-label="Ask again"]')).toBeVisible();
});

test("Ask: an answer left mid-way is fetched back from the saved chat", async ({ page }) => {
  await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false } }));
  await page.route("**/api/chats/chatrecover01", (r) => r.fulfill({ json: { ok: true, chat: { id: "chatrecover01", title: "Q", updated: new Date().toISOString(), turns: [{ role: "user", content: "Who are the twelve tribes?" }, { role: "assistant", content: "The children of Israel [1].", sources: [SOURCE] }] } } }));
  await page.goto(`/ask${LAUNCH}`);
  // The app closed while the answer was being written: only the question was kept on the device.
  await page.evaluate(() => localStorage.setItem("cj:ask:1", JSON.stringify({ chatId: "chatrecover01", turns: [{ role: "user", content: "Who are the twelve tribes?" }] })));
  await page.reload();
  await expect(page.locator(".msg--ai .msg__text")).toContainText("The children of Israel");
});

test("Saved chats: listed, reopened with their history, deleted only when the server confirms", async ({ page }) => {
  let chats = [
    { id: "chataaaa01", title: "Why keep the Passover?", updated: new Date().toISOString(), count: 2 },
    { id: "chatbbbb02", title: "Who was Melchizedek?", updated: new Date().toISOString(), count: 1 },
  ];
  let failDelete = true;
  await page.route("**/api/ask/account", (r) => r.fulfill({ json: { metered: false } }));
  await page.route("**/api/chats", (r) => r.fulfill({ json: { ok: true, chats } }));
  await page.route("**/api/chats/chataaaa01", (r) => r.fulfill({ json: { ok: true, chat: { id: "chataaaa01", title: "Why keep the Passover?", updated: chats[0].updated, turns: [
    { role: "user", content: "Why keep the Passover?" }, { role: "assistant", content: "It is commanded.", sources: [] },
    { role: "user", content: "When?" }, { role: "assistant", content: "The fourteenth day.", sources: [] },
  ] } } }));
  await page.route("**/api/chats/chatbbbb02", (r) => {
    if (r.request().method() !== "DELETE") return r.fulfill({ status: 404, json: { ok: false } });
    if (failDelete) return r.fulfill({ status: 500, json: { ok: false } });
    chats = chats.filter((c) => c.id !== "chatbbbb02");
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(`/ask${LAUNCH}`);
  await page.click('[aria-label="Your chats"]');
  await expect(page.locator(".chats__open b")).toHaveText(["Why keep the Passover?", "Who was Melchizedek?"]);
  await page.click(".chats__open >> text=Why keep the Passover?");
  await expect(page.locator(".msg--me .msg__bubble")).toHaveText(["Why keep the Passover?", "When?"]);
  await expect(page.locator(".msg--ai .msg__text").last()).toContainText("The fourteenth day");
  // A failed delete keeps the chat and says so; a confirmed one removes it.
  await page.click('[aria-label="Your chats"]');
  page.on("dialog", (d) => void d.accept());
  await page.click('[aria-label="Delete Who was Melchizedek?"]');
  await expect(page.locator(".chats__why")).toContainText("was not deleted");
  await expect(page.locator(".chats__open b")).toHaveCount(2);
  failDelete = false;
  await page.click('[aria-label="Delete Who was Melchizedek?"]');
  await expect(page.locator(".chats__open b")).toHaveText(["Why keep the Passover?"]);
});

// ── Search ──────────────────────────────────────────────────────────────────────────────────
test("Search: results come in as you type, grouped, a reference opens the Bible, and the keyboard works it", async ({ page }) => {
  await page.route("**/api/search?**", (r) => r.fulfill({ json: { ok: true, q: "", mode: "strict", counts: { class: 1, verse: 2 }, ms: 1, hits: [
    { kind: "class", title: "The Superiority of the Chosen People", url: "/classes/2026/superiority", sub: "Scriptures Opened", snippet: "And Melchizedek king of Salem brought forth bread and wine" },
    { kind: "verse", title: "Genesis 14:18", url: "/bible/genesis/14#v18", sub: "", snippet: "And Melchizedek king of Salem brought forth bread and wine" },
    { kind: "verse", title: "Hebrews 7:1", url: "/bible/hebrews/7#v1", sub: "", snippet: "For this Melchisedec, king of Salem" },
  ] } }));
  await page.route("**/api/teachings?**", (r) => r.fulfill({ json: { ok: true, q: "", feed: "", page: 0, hits: [], more: false } }));
  await page.goto(`/search${LAUNCH}`);
  await expect(page.locator(".srch__try button").first()).toBeVisible();
  await page.fill("#q", "Melchizedek");
  // No Enter needed: the results follow the words.
  await expect(page.locator(".srch__group h2").first()).toContainText("Sabbath classes");
  await expect(page.locator(".srch__hit mark").first()).toHaveText(/Melchizedek/i);
  await expect(page.locator('.srch__scope[aria-selected="true"]')).toHaveText("Top");
  await expect(page.locator(".srch__scope", { hasText: "Scripture" }).locator(".srch__count")).toHaveText("2");
  // The keyboard: down into the results, through them, Escape back to the field.
  await page.focus("#q");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".srch__hit").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".srch__hit").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#q")).toBeFocused();
  // A scope narrows the results.
  await page.click(".srch__scope >> text=Scripture");
  await expect(page.locator(".srch__hit .srch__title")).toHaveText(["Genesis 14:18", "Hebrews 7:1"]);
  // A reference offers the Bible itself, first under Top.
  await page.click(".srch__scope >> text=Top");
  await page.fill("#q", "John 3:16");
  await expect(page.locator(".srch__ref")).toContainText("John 3:16");
  // Nothing found says so, with what to try.
  await page.unroute("**/api/search?**");
  await page.route("**/api/search?**", (r) => r.fulfill({ json: { ok: true, q: "", mode: "strict", counts: {}, ms: 1, hits: [] } }));
  await page.fill("#q", "zzqxw");
  await expect(page.locator(".srch__none")).toContainText("Nothing found");
});


test("audio chips set device pitch and speed; Stop stays stopped with Repeat enabled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { text: string; rate = 1; pitch = 1; constructor(text: string) { this.text = text; } } });
    const calls: { rate: number; pitch: number }[] = [];
    let current: SpeechSynthesisUtterance | null = null;
    const voice = { name: "Test English", lang: "en-GB", localService: true };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [voice], addEventListener() {}, removeEventListener() {},
      speak(u: SpeechSynthesisUtterance) { current = u; calls.push({ rate: u.rate, pitch: u.pitch }); u.onstart?.({} as SpeechSynthesisEvent); },
      cancel() { current = null; }, pause() {}, resume() {}, paused: false,
    } });
    (window as unknown as { __speech: unknown }).__speech = { calls, finish: () => current?.onend?.({} as SpeechSynthesisEvent) };
  });
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback" }).click();
  await expect(page.locator(".bs-audio__top").getByRole("button", { name: "Return to current passage" })).toHaveText("Psalms 23:1 KJV");
  await expect(page.locator(".bs-audio__chips button")).toHaveText(["Stop", "Voice", "Speed 1x", "Pitch 1x", "Ambient", "Repeat"]);
  await page.getByRole("button", { name: "Pitch 1x", exact: true }).click();
  await page.getByRole("dialog", { name: "Pitch", exact: true }).getByRole("radio", { name: "1.5x", exact: true }).click();
  await page.getByRole("button", { name: "Speed 1x", exact: true }).click();
  await page.getByRole("dialog", { name: "Speed", exact: true }).getByRole("radio", { name: "1.25x", exact: true }).click();
  const spoken = () => page.evaluate(() => (window as unknown as { __speech: { calls: {rate:number;pitch:number}[] } }).__speech.calls);
  await expect.poll(async () => (await spoken()).at(-1)).toEqual({ rate: 1.25, pitch: 1.5 });
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByRole("button", { name: "Stop audio playback" }).click();
  const count = (await spoken()).length;
  await expect(page.locator(".bs-audio").getByRole("button", { name: "Start audio playback" })).toBeVisible();
  await page.waitForTimeout(250);
  expect((await spoken()).length).toBe(count);
  await expect(page.getByRole("button", { name: "Repeat", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".bs-audio").getByRole("button", { name: "Start audio playback" }).click();
  // Intro plus six verses: a natural completion still repeats the chapter.
  await page.evaluate(() => { const speech = (window as unknown as { __speech: { finish(): void } }).__speech; for (let i = 0; i < 7; i++) speech.finish(); });
  await expect(page.getByRole("button", { name: "Stop audio playback" })).toBeVisible();
  await expect.poll(async () => (await spoken()).length).toBeGreaterThan(count + 7);
});

test("Stop cancels a pending device voice lookup", async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks: (() => void)[] = [];
    const state = { calls: 0, ready: false, load: () => { state.ready = true; callbacks.forEach((f) => f()); } };
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => state.ready ? [{ name: "Test English", lang: "en-GB", localService: true }] : [],
      addEventListener(_: string, cb: () => void) { callbacks.push(cb); }, removeEventListener() {},
      speak() { state.calls++; }, cancel() {}, pause() {}, resume() {}, paused: false,
    } });
    (window as unknown as { __pendingSpeech: unknown }).__pendingSpeech = state;
  });
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback" }).click();
  await page.getByRole("button", { name: "Stop audio playback" }).click();
  await page.evaluate(() => (window as unknown as { __pendingSpeech: { load(): void } }).__pendingSpeech.load());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __pendingSpeech: { calls: number } }).__pendingSpeech.calls)).toBe(0);
});

test("Books opens on the book being read even when the book list arrives late", async ({ page }) => {
  await page.route("**/api/kjv/books.json", async (r) => { const res = await r.fetch(); await new Promise((ok) => setTimeout(ok, 2500)); await r.fulfill({ response: res }); });
  await page.goto(`/read/john/3${LAUNCH}`);
  await page.click(".bs-pill--book");
  await expect(page.locator(".bs-bookrow[data-current]")).toBeInViewport({ timeout: 8000 });
});


test("the bar follows the reading: a capsule while scrolling down, back on scroll up or a tap, the current section named", async ({ page }) => {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-3")).toBeVisible();
  const bar = page.locator("nav.tabs");
  // The current section sits on the pill, with its name.
  await expect(bar.locator(".tab[data-on] .tab__label")).toHaveText("Bible");
  await expect(bar.locator(".tab[data-on] .tab__label")).toBeVisible();
  await expect(bar).not.toHaveAttribute("data-mini");
  // Scrolling down into the chapter shrinks it to the Bible beside the fixed Search control.
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 600);
  await expect(bar).toHaveAttribute("data-mini", "");
  await expect(bar.getByRole("button", { name: "Search" })).toBeVisible();
  // Scrolling back up brings it back.
  await page.mouse.wheel(0, -150);
  await expect(bar).not.toHaveAttribute("data-mini");
  // Down again, then a tap on the capsule opens it rather than navigating.
  await page.mouse.wheel(0, 600);
  await expect(bar).toHaveAttribute("data-mini", "");
  await bar.locator(".tab[data-on]").click();
  await expect(bar).not.toHaveAttribute("data-mini");
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  // Another section: the pill and the name move to it.
  await bar.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(bar.locator(".tab[data-on] .tab__label")).toHaveText("Search");
});

test("a class without notes says so on its page, and its notes can be requested", async ({ page }) => {
  const asked = await mockNoteRequests(page);
  await page.goto(`/watch/UJ0nRIVRPls?t=339${LAUNCH}`);
  const wanted = page.locator(".notes-wanted");
  await expect(wanted).toContainText("No notes for this class yet");
  const ask = wanted.locator(".request-notes");
  await ask.click();
  await expect(ask).toHaveText("Notes requested · you and 2 others");
  expect(asked).toEqual([{ video: "UJ0nRIVRPls", title: expect.any(String) }]);
});

test("admins see the classes most asked for, copy their ids for the draft-notes workflow, and mark them done", async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ json: { user: { id: 1, first_name: "Test" }, subscribed: false, premium: false, admin: true, canEdit: false } }));
  let rows = [{ video: "UJ0nRIVRPls", title: "The Concept Of Time", count: 3, last: "2026-10-01T00:00:00.000Z" }, { video: "QxWHRujbdpg", title: "Transforming From Immorality", count: 1, last: "2026-09-30T00:00:00.000Z" }];
  await page.route("**/api/requests", (r) => r.fulfill({ json: { ok: true, requests: rows } }));
  await page.route("**/api/requests/*", (r) => { if (r.request().method() === "DELETE") { rows = rows.filter((x) => !r.request().url().endsWith(x.video)); return r.fulfill({ json: { ok: true } }); } return r.continue(); });
  await page.goto(`/settings${LAUNCH}`);
  await page.getByText("Requested notes").click();
  await expect(page).toHaveURL(/\/settings\/requests/);
  await expect(page.locator(".nreq__main b")).toHaveText(["The Concept Of Time", "Transforming From Immorality"]);
  await expect(page.locator(".nreq__main small").first()).toContainText("3 requests");
  await page.getByRole("button", { name: "Mark The Concept Of Time done" }).click();
  await expect(page.locator(".nreq__main b")).toHaveText(["Transforming From Immorality"]);
});


// Regression (324ac1a): the note editor grew with the page instead of the phone, ran off the
// bottom and Save could not be reached. With a long text typed, Save stays on screen.
test("an admin's note editor fits the phone: a long note keeps Save on screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.route("**/api/me", (r) => r.fulfill({ json: { user: { id: 1, first_name: "Test" }, subscribed: false, premium: false, admin: true, canEdit: true } }));
  await page.route("**/api/notes/source*", (r) => r.fulfill({ json: { ok: true, sha: "abc", text: "---\ntitle: Religion\n---\n\n" + "The whole note as written.\n\n".repeat(200) } }));
  await page.goto(`/note/classes/2026/2026-03-28-religion-the-false-prophet${LAUNCH}`);
  await page.locator('.nsheet button[aria-label="Edit this note"]').click();
  await page.getByLabel("Reason for this edit").fill("Correct wording from the source.");
  const text = page.locator(".edit__text");
  await expect(text).toBeVisible();
  await text.click();
  await text.press("End");
  await text.pressSequentially(" One more line.");
  const save = page.locator(".edit__footer .btn", { hasText: "Save" });
  await expect(save).toBeEnabled();
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(640);
  expect(box.y).toBeGreaterThanOrEqual(0);
});

// Regression (#75, fixed in #76): the verse-selection sheet became a tall floating card (about
// 330 px at 390x844, with an empty band above the tabs). It keeps Bible Strong's size: the six
// Annotate actions on one row, the sheet no taller than 280 px (Bible Strong's is about 212),
// and the selected verse above it.
test("the verse-selection sheet keeps Bible Strong's size: one row of actions, the verse in view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await tapVerse(page, 1);
  const sheet = page.locator(".bs-sheet.bs-selected");
  await expect(sheet).toBeVisible();
  await page.locator(".bs-tabsfooter__tab", { hasText: "Annotate" }).click();
  const actions = sheet.locator(".bs-page:not([aria-hidden=true]) .bs-action");
  await expect(actions).toHaveCount(6);
  const tops = new Set(await actions.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
  expect(tops.size).toBe(1);
  const s = (await sheet.boundingBox())!;
  expect(s.height).toBeLessThanOrEqual(280);
  const v = (await page.locator("#verset-1").boundingBox())!;
  expect(v.y + v.height).toBeLessThanOrEqual(s.y);
});

// The selection sheet for keyboard and screen-reader users: no focus ring drawn round the sheet
// itself on open (it showed as a cyan outline), tabs tied to their panels and moved with arrows
// and Home/End, every tab a 48 px target, and the dock hidden under the sheet out of Tab's reach.
test("the verse-selection sheet works by keyboard: no ring on the sheet, tabs with panels, the dock out of reach", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/read/psalms/23${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await tapVerse(page, 1);
  const sheet = page.locator(".bs-sheet.bs-selected");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  await expect(page.locator("nav.tabs")).toHaveJSProperty("inert", true);
  const tabs = page.locator(".bs-tabsfooter__tab");
  for (let i = 0; i < 3; i++) {
    const id = await tabs.nth(i).getAttribute("aria-controls");
    await expect(page.locator(`#${id}`)).toHaveAttribute("role", "tabpanel");
    const box = await tabs.nth(i).evaluate((el) => { const r = el.getBoundingClientRect(); const a = getComputedStyle(el, "::after"); return { w: r.width, h: r.height + parseFloat(a.top) * -1 + parseFloat(a.bottom) * -1 }; });
    expect(box.w).toBeGreaterThanOrEqual(48);
    expect(box.h).toBeGreaterThanOrEqual(48);
  }
  await tabs.nth(0).click();
  await page.keyboard.press("End");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.locator("nav.tabs")).toHaveJSProperty("inert", false);
});

test("Glossary: each word with its scripture, its entry and the moments it is taught; a linked word is brought into view", async ({ page }) => {
  const entry = (term: string, slug: string) => ({
    term, slug, aliases: term === "Amalek" ? ["Amalekites"] : [], definition: `${term}, as the classes teach it.`, url: `/glossary#${slug}`,
    scripture: [{ label: "Exodus 17:16", url: "/bible/exodus/17#v16" }],
    see: [{ title: "Esau and Edom", url: "/encyclopedia/esau-and-edom" }],
    taught: [{ title: "Iran Is Not Amalek", video: "7dszBxZaO8E", seconds: 2205, url: "https://www.youtube.com/watch?v=7dszBxZaO8E&t=2205s" }],
  });
  const words = ["Amalek", "Babylon", "Covenant", "Edom", "Gentile", "Hebrew", "Israel", "Judah", "Levite", "Messiah", "Nazarite", "Priesthood", "Sabbath", "Zion"];
  await page.route("**/api/glossary/index.json", (r) => r.fulfill({ json: { about: "The words the classes use.", entries: words.map((w) => entry(w, w.toLowerCase())) } }));
  await page.goto(`/glossary${LAUNCH}`);
  const amalek = page.locator("#gl-amalek");
  await expect(amalek).toContainText("also Amalekites");
  await expect(amalek.locator('a[href="/read/exodus/17?v=16"]')).toBeVisible();
  await expect(amalek.locator('a[href="/note/encyclopedia/esau-and-edom"]')).toHaveText("See Esau and Edom");
  await expect(amalek.locator('a[href="/watch/7dszBxZaO8E?t=2205"]')).toContainText("36:45");
  await page.fill("#gl-q", "amalekites");
  await expect(page.locator(".glossary")).toHaveCount(1);
  await page.fill("#gl-q", "");
  // A link into the glossary ("/glossary#zion"), followed inside the app, lands on the word.
  await page.goto("/glossary#zion");
  await expect(page.locator("#gl-zion")).toBeInViewport();
});

test("Concordance: books with how much of each is cited; a book lists each chapter's citations by shelf with the verses", async ({ page }) => {
  await page.route("**/api/concordance/index.json", (r) => r.fulfill({ json: [
    { book: "Genesis", slug: "genesis", testament: "Old Testament", url: "/concordance/genesis", chapters: 50, cited: [1, 3], citations: 4 },
    { book: "Obadiah", slug: "obadiah", testament: "Old Testament", url: "/concordance/obadiah", chapters: 1, cited: [], citations: 0 },
    { book: "John", slug: "john", testament: "New Testament", url: "/concordance/john", chapters: 21, cited: [3], citations: 1 },
  ] }));
  await page.route("**/api/concordance/genesis.json", (r) => r.fulfill({ json: {
    book: "Genesis", slug: "genesis", testament: "Old Testament", url: "/concordance/genesis", chapters: 50, cited: [1, 3], citations: 4,
    chapterRows: [
      { chapter: 1, url: "/bible/genesis/1", cited_by: [{ kind: "note", label: "Genesis 1-4", url: "/study/genesis/1", verses: ["1-2", "1", "5"] }] },
      { chapter: 3, url: "/bible/genesis/3", cited_by: [
        { kind: "note", label: "The Serpent's Seed", url: "/classes/2026/serpents-seed", verses: ["15"] },
        { kind: "law", label: "2H.4", url: "/law/2/h#2H.4", verses: [] },
        { kind: "precept", label: "Sin", url: "/precepts/sin", verses: ["6-7"] },
      ] },
    ],
  } }));
  await page.goto(`/concordance${LAUNCH}`);
  await expect(page.locator('a[href="/concordance/obadiah"]')).toContainText("none");
  await expect(page.locator('a[href="/concordance/genesis"]')).toContainText("2 of 50");
  await page.fill("#conc-q", "john");
  await expect(page.locator('a[href="/concordance/genesis"]')).toHaveCount(0);
  await page.goto(`/concordance/genesis${LAUNCH}`);
  await expect(page.locator("#conc-ch-1 h2 a")).toHaveAttribute("href", "/read/genesis/1");
  await expect(page.locator("#conc-ch-1")).toContainText("v. 1-2, 5");
  const ch3 = page.locator("#conc-ch-3");
  await expect(ch3).toContainText("Notes and classes");
  await expect(ch3).toContainText("Laws");
  await expect(ch3).toContainText("v. 6-7");
});
