import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const verses = Array.from({ length: 31 }, (_, i) => ({ verse: i + 1, text: i === 0 ? "In the beginning God created the heaven and the earth." : `Verse ${i + 1}: And God said, Let there be light: and there was light.` }));
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [
      { book: "Genesis", slug: "genesis", chapters: 2, verses: 62, chapterIds: [1, 2] },
      { book: "John", slug: "john", chapters: 3, verses: 93, chapterIds: [1, 2, 3] },
      { book: "Wisdom of Solomon", slug: "wisdom-of-solomon", chapters: 1, verses: 31, chapterIds: [1] },
    ] });
    const chapter = /\/api\/kjv\/([^/]+)\/(\d+).json/.exec(path);
    if (chapter) return r.fulfill({ json: { book: chapter[1], chapter: +chapter[2], translation: "KJV", verses } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/verse-of-day*", r => r.fulfill({ json: { ref: new URL(r.request().url()).searchParams.has("date") ? "Genesis 1:2" : "Genesis 1:1", slug: "genesis", chapter: 1, verse: new URL(r.request().url()).searchParams.has("date") ? 2 : 1, text: "In the beginning God created the heaven and the earth." } }));
  await page.addInitScript(() => {
    if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress" }));
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "bible-one", tabs: [{ id: "bible-one", path: "/read/genesis/1" }, { id: "bible-two", path: "/read/john/3?v=16-18" }] }] }));
  });
}
async function menu(page: Page, action: string) {
  await page.getByRole("button", { name: "Scripture options", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function overview(page: Page) {
  if (await page.locator("nav.tabs[data-mini]").count()) await page.locator("nav.tabs .tab[data-kept]").click();
  await page.getByRole("button", { name: /\d+ Tabs open/ }).click();
  await expect(page.getByRole("main", { name: "Your tabs" })).toBeVisible();
}
test.beforeEach(async ({ page }) => setup(page));

async function gestureClock(page: Page) {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-2 .bs-num")).toBeVisible();
  await page.clock.install({ time: new Date("2026-10-08T18:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-08T18:00:01Z"));
}
async function touchVerse(page: Page, type: string, fingers: number, verse = 1, offsetY = 0) {
  await page.locator(`#verset-${verse} .bs-num`).evaluate((el, { type, fingers, offsetY }) => {
    const r = el.getBoundingClientRect();
    const point = { identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 + offsetY };
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      touches: { value: Array.from({ length: fingers }, (_, i) => ({ ...point, identifier: i + 1, clientX: point.clientX + i * 20 })) },
      changedTouches: { value: [point] },
    });
    el.dispatchEvent(event);
  }, { type, fingers, offsetY });
}

for (const input of ["mouse", "touch"] as const) test(`reader rapid ${input} taps retain each distinct verse selection`, async ({ page }) => {
  await gestureClock(page);
  for (const n of [1, 2]) {
    if (input === "touch") {
      await touchVerse(page, "touchstart", 1, n);
      await touchVerse(page, "touchend", 0, n);
    } else {
      const b = (await page.locator(`#verset-${n} .bs-num`).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
    await page.clock.runFor(50);
  }
  await page.clock.runFor(250);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(2);
  await expect(page.getByRole("dialog", { name: "Selected: Genesis 1:1-2", exact: true })).toBeVisible();
});

test("reader cancelled touch cannot select a verse on a later release", async ({ page }) => {
  await gestureClock(page);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(100);
  await touchVerse(page, "touchcancel", 0);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(600);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
});

test("reader adding a second finger cancels the pending long press", async ({ page }) => {
  await gestureClock(page);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(100);
  await touchVerse(page, "touchstart", 2);
  await page.clock.runFor(500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await touchVerse(page, "touchend", 1);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(500);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator(".bs-resourcetabs")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Words", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
});

test("reader focus loss cancels a held press and the next click still works", async ({ page }) => {
  await gestureClock(page);
  const b = (await page.locator("#verset-1 .bs-num").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.clock.runFor(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(500);
  await page.mouse.up();
  await page.clock.runFor(250);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.clock.runFor(250);
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
});

test("reader pressing a verse shows no touch light, as in Bible Strong", async ({ page }) => {
  await gestureClock(page);
  const lit = () => page.locator("#verset-1 .bs-text").evaluate(el => getComputedStyle(el.parentElement!).backgroundColor);
  const before = await lit();
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(200);
  expect(await lit()).toBe(before);
  await touchVerse(page, "touchend", 1);
});

test("reader chapter changes stay in place: Back leaves the reader and a collapsed header holds", async ({ page }) => {
  // Long chapters, so the reader can scroll far enough to collapse its header.
  const long = Array.from({ length: 40 }, (_, i) => ({ verse: i + 1, text: "And the light shineth in darkness; and the darkness comprehended it not. ".repeat(3) }));
  await page.route(`${DATA}/api/kjv/john/*.json`, r => r.fulfill({ json: { book: "john", chapter: +/(\d+)\.json/.exec(r.request().url())![1], translation: "KJV", verses: long } }));
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  // A jump from the book picker is its own step in history, as before.
  await page.locator(".bs-pill--book").click();
  await page.locator(".bs-picker").getByRole("button", { name: "John", exact: true }).click();
  await page.getByRole("button", { name: "Chapter 1", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/john\/1$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.click('.bs-chapterbtn[aria-label="Next chapter"]');
  await expect(page).toHaveURL(/\/read\/john\/2$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  // Scrolling fast collapses the header, as Bible Strong's SWIPE_DOWN does (after the reader's
  // 600 ms settle following a chapter change).
  await page.waitForTimeout(800);
  await page.locator(".bs-scroll").evaluate(async el => { for (const top of [40, 120, 600]) { el.scrollTop = top; await new Promise(r => setTimeout(r, 30)); } });
  await expect(page.locator(".bs-header__summary")).toBeVisible();
  // A swipe to the next chapter keeps it collapsed: one fullscreen state, as upstream's atom.
  const y = 400;
  await page.mouse.move(340, y);
  await page.mouse.down();
  await page.mouse.move(60, y, { steps: 4 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/read\/john\/3$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeAttached();
  await expect(page.locator(".bs-header__summary")).toBeVisible();
  // Paging chapters left no trail: Back returns to the passage before John.
  await page.goBack();
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
});

test("book picker long press opens the chapter in a new tab, as Bible Strong's web picker does", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await expect(page.getByRole("button", { name: "2 Tabs open", exact: true })).toBeVisible();
  await page.locator(".bs-pill--book").click();
  await page.locator(".bs-picker").getByRole("button", { name: "John", exact: true }).click();
  const tile = page.getByRole("button", { name: "Chapter 2", exact: true });
  const t = (await tile.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await expect(page).toHaveURL(/\/read\/john\/2$/);
  await expect(page.getByRole("button", { name: "3 Tabs open", exact: true })).toBeVisible();
  await expect(page.locator(".bs-picker")).toHaveCount(0);
});

test("reader v opens Go to verse and jumps to a valid verse, as Bible Strong's web reader does", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.keyboard.press("v");
  const dialog = page.getByRole("dialog", { name: "Go to verse" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Verse" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Verse" }).fill("99");
  await expect(dialog.getByRole("button", { name: "Go" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Verse" }).fill("28");
  await dialog.getByRole("button", { name: "Go" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#verset-28")).toBeInViewport();
  // Typing in a field never opens it.
  await page.locator(".bs-pill--book").click();
  await page.getByRole("textbox", { name: "Search books" }).press("v");
  await expect(page.getByRole("dialog", { name: "Go to verse" })).toHaveCount(0);
});

test("reader press preference still swaps resources and verse selection", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await menu(page, "Font and settings");
  await page.getByRole("button", { name: "Showing strongs: Long press", exact: true }).click();
  await page.getByRole("dialog", { name: "Font and settings" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#verset-1 .bs-num").click();
  await expect(page.locator(".bs-resourcetabs")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Words", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  const b = (await page.locator("#verset-1 .bs-num").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true })).toBeVisible();
  await expect(page.locator(".bs-resourcetabs")).toHaveCount(0);
});

test("reader selections and expanded passage context belong to their own tabs", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await page.locator("#verset-1 .bs-text").click();
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("John"); await page.keyboard.press("Enter");
  await expect(page.locator(".bs-verse")).toHaveCount(3);
  await expect(page.locator("#verset-15")).toHaveCount(0);
  await page.locator(".bs-context__main").click();
  await expect(page.locator(".bs-verse")).toHaveCount(31);
  await overview(page); await page.getByRole("button", { name: "Open Genesis 1 - KJV", exact: true }).click();
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("John"); await page.keyboard.press("Enter");
  await expect(page.locator(".bs-context__main")).toHaveText("Back to the Scripture");
  await expect(page.locator("#verset-1")).not.toHaveAttribute("data-selected");
});

test("new Bible tab stays selected and carries its focused passage", async ({ page }) => {
  await page.goto("/read/genesis/1?v=1-2");
  await menu(page, "Open in new tab");
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1-2/);
  await expect.poll(() => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cj:tabgroups")!); return s.groups[0].current; })).not.toBe("bible-one");
  await expect(page.getByRole("button", { name: "3 Tabs open", exact: true })).toBeVisible();
  await expect(page.locator(".bs-verse")).toHaveCount(2);
});

test("export saves the chosen scope and notes, and supports a whole book", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1/2": { id: "n", title: "Creation", description: "My saved note", date: 1 }, "7": { id: "other", title: "Unrelated note", description: "Do not include", date: 1 } })));
  await page.goto("/read/genesis/1"); await page.locator("#verset-1 .bs-text").click();
  const selected = page.getByRole("dialog", { name: /^Selected:/ });
  await selected.getByRole("tab", { name: "Share", exact: true }).click();
  await selected.getByRole("button", { name: "Export", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Export passage" });
  await expect(sheet.locator("pre")).toContainText("My saved note");
  const download = page.waitForEvent("download"); await sheet.getByRole("button", { name: "Save text file" }).click();
  const text = await fs.readFile((await (await download).path())!, "utf8");
  expect(text).toContain("1. In the beginning"); expect(text).toContain("My saved note"); expect(text).toContain("outside this selection"); expect(text).not.toContain("Unrelated note");
  await sheet.getByRole("switch", { name: "Notes", exact: true }).click();
  await expect(sheet.locator("pre")).not.toContainText("My saved note");
  await sheet.getByLabel("Export scope").selectOption("book");
  await expect(sheet.locator("pre")).toContainText("Genesis 1");
  const whole = page.waitForEvent("download"); await sheet.getByRole("button", { name: "Save text file" }).click();
  expect(await fs.readFile((await (await whole).path())!, "utf8")).toContain("Genesis 2 · Scripture");
});

test("search applies filters on the server, pages, sorts, and preserves a typed verse range", async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await page.route("**/bs/v1/bibles/KJV/search?*", r => {
    const q = new URL(r.request().url()).searchParams; queries.push(q);
    const offset = Number(q.get("offset")), book = Number(q.get("book") || (q.get("section") === "apoc" ? 72 : 1));
    return r.fulfill({ json: { count: 52, results: Array.from({ length: offset ? 2 : 50 }, (_, i) => ({ book, chapter: Math.floor((i + offset) / 31) + 1, verse: (i + offset) % 31 + 1, text: `God created ${offset + i}` })) } });
  });
  await page.goto("/read/genesis/1"); await menu(page, "Search the Scriptures");
  const sheet = page.getByRole("dialog", { name: "Search the Scriptures", exact: true });
  await sheet.getByRole("searchbox").fill("God created");
  await expect(sheet.locator(".bs-search__hit")).toHaveCount(50);
  await sheet.getByRole("button", { name: "More verses" }).click();
  await expect(sheet.locator(".bs-search__hit")).toHaveCount(52);
  await sheet.getByLabel("One book").selectOption("john");
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("John");
  expect(queries.at(-1)?.get("book")).toBe("43"); expect(queries.at(-1)?.get("offset")).toBe("0");
  await sheet.getByRole("button", { name: "Apocrypha", exact: true }).click();
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("Wisdom of Solomon");
  expect(queries.at(-1)?.get("section")).toBe("apoc");
  await sheet.getByLabel("Result order").selectOption("book");
  await expect.poll(() => queries.at(-1)?.get("sortOrder")).toBe("book");
  await sheet.getByRole("searchbox").fill("John 3:16-18");
  await sheet.getByRole("button", { name: /Go to John 3:16-18/ }).click();
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await expect(page.locator(".bs-verse")).toHaveCount(3);
});

test("reader verse numbers can be hidden without hiding them from assistive technology", async ({ page }) => {
  await page.goto("/read/genesis/1"); await menu(page, "Font and settings");
  await page.getByRole("switch", { name: "Verse numbers", exact: true }).click();
  await page.getByRole("dialog", { name: "Font and settings" }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("#verset-1 .bs-num")).toHaveCount(0);
  await expect(page.locator("#verset-1 .sr-only")).toHaveText("1");
  await page.reload(); await expect(page.locator("#verset-1")).toBeVisible();
  await expect(page.locator("#verset-1 .bs-num")).toHaveCount(0);
});

test("daily verses have five days, sharing and images on Home", async ({ page, browserName }) => {
  await page.route(`${DATA}/search/{classes,captains}.json`, r => r.fulfill({ json: [] }));
  await page.route(`${DATA}/api/strongs/index.json`, r => r.fulfill({ json: [
    { n: "G1", lemma: "Α", xlit: "alpha", def: "Alpha", count: 100 },
    { n: "G2", lemma: "Ἀαρών", xlit: "Aaron", def: "Aaron", count: 10 },
  ] }));
  await page.goto("/");
  const card = page.getByRole("region", { name: "Daily scripture" });
  await expect(card).toContainText("Genesis 1:1");
  await expect(card.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "Previous day's scripture" }).click();
  await expect(card).toContainText("Yesterday"); await expect(card).toContainText("Genesis 1:2");
  await card.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Verse image" }).getByRole("img")).toHaveAttribute("src", "/card/genesis/1/2.svg");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await card.getByRole("button", { name: "Today's scripture", exact: true }).click();
  await expect(card).toContainText("Genesis 1:1");

  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const home = page.locator(".drawer--home");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const stack = home.getByRole("region", { name: "Daily scripture" });
  const active = stack.locator(".today-card[data-active]");
  const touch = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
  const swipe = async (right: boolean) => {
    const b = (await stack.boundingBox())!;
    const x = b.x + b.width * (right ? .2 : .8), end = b.x + b.width * (right ? .8 : .2), y = b.y + 110;
    if (touch) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let n = 1; n <= 12; n++) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (end - x) * n / 12, y }] });
        await page.waitForTimeout(25);
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(end, y, { steps: 12 }); await page.mouse.up();
    }
  };
  await expect(stack.locator(".today-card[inert]")).toHaveCount(4);
  for (const day of ["Yesterday", "Two days ago", "Three days ago", "Four days ago", "Four days ago"]) {
    await swipe(true); await expect(active.locator("header b")).toHaveText(day);
    await expect(home).toHaveAttribute("data-open", "");
    await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  }
  for (const day of ["Three days ago", "Two days ago", "Yesterday", "Today", "Today"]) {
    await swipe(false); await expect(active.locator("header b")).toHaveText(day);
  }
  await touch?.detach();
  await stack.press("ArrowRight"); await expect(active.locator("header b")).toHaveText("Yesterday");
  await active.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Verse image" }).getByRole("img")).toHaveAttribute("src", "/card/genesis/1/2.svg");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const word = home.locator(".widget").first();
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G1");
  await page.evaluate(() => { Math.random = () => .99; });
  await word.getByRole("button", { name: "Another one" }).click();
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G2");
  const shelf = home.locator(".widgets");
  await expect(home.locator(".feed__card--skel")).toHaveCount(0);
  await shelf.evaluate(el => { el.scrollIntoView({ block: "center" }); el.scrollLeft = 200; });
  await expect.poll(() => shelf.evaluate(el => el.scrollLeft)).toBeGreaterThan(20);
  const position = await home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft]);
  await home.getByRole("button", { name: "Close Home" }).click();
  await expect(home).toHaveAttribute("inert", "");
  // Stay away beyond the closing animation, which used to discard Home's state.
  await page.waitForTimeout(500);
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchmove", 1, 1, 160);
  await expect(home.locator(".pull")).toHaveCSS("height", "0px");
  await touchVerse(page, "touchend", 0, 1, 160);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(active.locator("header b")).toHaveText("Yesterday");
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G2");
  await expect.poll(() => home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft])).toEqual(position);
  // A chapter first saved while Home is closed must join its displayed totals on reopening.
  const highlights = home.locator(".stats__cell").filter({ hasText: "Highlights" }).locator("b");
  await expect(highlights).toHaveText("0");
  await home.getByRole("button", { name: "Close Home" }).click();
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchend", 0);
  await page.locator(".bs-colors__cell").nth(1).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(highlights).toHaveText("1");
});

test("keyboard palette switches to an existing tab and opens a passage with its range", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Find a tab or tool" });
  await input.fill("John"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await expect(page.getByRole("button", { name: "2 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k"); await input.fill("Genesis 1:2-3"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2-3/);
  await expect(page.getByRole("button", { name: "3 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Alt+w"); await expect(page.getByRole("button", { name: "2 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k"); await input.fill("study");
  await expect(page.getByRole("option", { name: /My studies/ })).toBeVisible();
  await input.press("Enter"); await expect(page).toHaveURL(/\/studies$/);
  await page.keyboard.press("Control+k");
  await input.fill("Bible"); await input.press("Tab");
  const dialog = page.getByRole("dialog", { name: "Find a tab or tool" });
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden(); await expect(page).toHaveURL(/\/studies$/);
});

test("plan completion can be corrected by keyboard and its read action stays inside the app", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cj:plan", JSON.stringify({ startedAt: new Date().toISOString().slice(0, 10), day: 0, streak: 0, perDay: 1, books: ["john"], name: "John" }));
    localStorage.setItem("cj:read", JSON.stringify({ genesis: "1-2" }));
  });
  const base = (process.env.CYBERJUDAH_APP_BASE ?? "/").replace(/\/$/, "");
  await page.goto(`${base}/plan`);
  await expect(page.locator(".card__ref")).toContainText("0% of this plan");
  const check = page.getByRole("button", { name: "John 1 read", exact: true });
  await check.focus(); await page.keyboard.press("Space"); await expect(check).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space"); await expect(check).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Read John 1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/read/john/1$`));
  await expect(page.locator("#verset-1")).toBeVisible();
});

test("restarting a selected plan keeps its books and resets its streak date", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:plan", JSON.stringify({ startedAt: "2026-10-01", day: 1, streak: 3, lastDone: "2026-10-07", perDay: 1, books: ["john"], name: "John" })));
  await page.goto("/plan");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByRole("link", { name: "John · Change plan", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "John 1", exact: true })).toBeVisible();
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem("cj:plan")!));
  expect(plan).toMatchObject({ day: 0, streak: 0, books: ["john"], name: "John" });
  expect(plan.lastDone).toBeUndefined();
});

test("the reading guide is reachable from Settings and has usable tab shortcuts", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Help & reading guide", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/help$/);
  await expect(page.getByRole("heading", { name: "Keyboard controls", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My studies", exact: true })).toHaveAttribute("href", "/studies");
});

test("Mac shortcuts cycle recent tabs and do not interrupt a note editor", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }));
  await page.goto("/read/genesis/1");
  await page.keyboard.down("Control"); await page.keyboard.press("q");
  await expect(page.getByRole("dialog", { name: "Recent tabs", exact: true })).toBeVisible();
  await page.keyboard.up("Control");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await page.keyboard.press("Meta+Alt+n"); await expect(page).toHaveURL(/\/new$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("Genesis"); await page.keyboard.press("Enter");
  await page.locator("#verset-1 .bs-text").click();
  const selected = page.getByRole("dialog", { name: /^Selected:/ });
  await selected.getByRole("tab", { name: "Annotate", exact: true }).click();
  await selected.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Keep my writing");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Find a tab or tool" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep my writing");
});
