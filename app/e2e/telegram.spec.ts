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

test("note HTML is sanitized before it reaches the page", async ({ page }) => {
  await page.route("https://data.cyberjudah.io/api/notes/classes/security-test.json", (r) => r.fulfill({
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
  await page.click('.bs-iconbtn[aria-label="Scripture options"]');
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
  await expect(first.locator(".why__reason")).toContainText("brought a light out of his treasures");
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
  await expect(page.locator(".hello h1")).toHaveText("What do you want to learn?");
  expect((await state(page)).back).toBe(false);
  await page.click(".tab >> text=Bible");
  await expect(page.locator(".bs-pill--book")).toContainText("Genesis 1");
  await page.click(".tab >> text=More");
  await page.click(".row >> text=Settings");
  await expect.poll(async () => (await state(page)).back).toBe(true);
  await press(page, "back");
  await expect(page).toHaveURL(/\/more/);
});

test("the reading plan ticks today's chapters and keeps a streak", async ({ page }) => {
  await page.goto(`/plan${LAUNCH}`);
  await expect.poll(async () => (await state(page)).main).toBe('Start the plan');
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

liveDataTest("settings: theme, spacing and offline books", async ({ page }) => {
  await page.goto(`/settings${LAUNCH}`);
  await page.click('[role=tab] >> text=Sepia');
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  await page.click(".link >> text=Save a book");
  await page.click(".sheet__item >> text=Jude");
  await expect(page.locator(".pill--ok")).toHaveText("offline");
  const cached = await page.evaluate(async () => (await (await caches.open("cj-offline-v1")).keys()).length);
  expect(cached).toBeGreaterThanOrEqual(1);
});

test("the settings button opens settings", async ({ page }) => {
  await page.goto(`/search${LAUNCH}`);
  await press(page, "settings");
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.locator("text=Daily verse")).toBeVisible();
});

test("Home is the front door: one field, search the classes or ask CyberJudah", async ({ page }) => {
  await page.goto(`/${LAUNCH}`);
  await expect(page.locator(".hero__prompt[data-on]")).toBeVisible();
  await expect(page.locator('.home a[href="/plan"]')).toHaveCount(0);
  await expect(page.locator(".tab")).toHaveCount(5);
  await page.fill("#q", "Why do we keep the Passover?");
  await page.click(".door__btn--ask");
  await expect(page).toHaveURL(/\/ask/);
  await expect(page.locator(".msg--me .msg__bubble")).toHaveText("Why do we keep the Passover?");
  await page.goBack();
  await page.fill("#q", "Seattle");
  await page.press("#q", "Enter");
  await expect(page).toHaveURL(/\/search\?q=Seattle/);
  await expect(page.locator(".head .title")).toHaveText("Search");
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

test("what was on the screen: a frame lands in the notes where the teacher pointed at it, a tap from playing there", async ({ page }) => {
  // A storyboard the Worker would serve (one level, 5x5 cells, a frame every 10 s) and two moments the captions flagged.
  const board = { ok: true, duration: 9557, levels: [{ level: 2, w: 160, h: 90, frames: 956, rows: 5, cols: 5, sheets: 39, interval: 10 }] };
  await page.route("https://data.cyberjudah.io/api/notes/classes/2026/2026-09-26-the-art-of-war-rules-of-engagement.json", (r) => r.fulfill({
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
  await page.click('.bs-bookrow:has-text("Genesis")');
  await expect(page.locator(".bs-bookprog").first()).toHaveAttribute("aria-label", "6 of 50 chapters read");
  await expect(page.locator(".bs-chaptertile[data-read]")).toHaveCount(6);
  await shot("tracker-books");
});
