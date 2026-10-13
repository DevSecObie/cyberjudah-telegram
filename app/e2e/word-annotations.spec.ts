import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { DATA_ORIGIN, LAUNCH, setup, goInApp } from "./telegram-harness";

test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
const verses = [
  { verse: 1, text: "In the beginning God created the heaven and the earth." },
  { verse: 2, text: "And the earth was without form, and void; and darkness was upon the face of the deep." },
  { verse: 3, text: "And God said, Let there be light: and there was light." },
];
const toolbar = (page: Page) => page.getByRole("dialog", { name: "Free mode", exact: true });
const marked = (page: Page) => page.locator(".bs-word-mark");
test.beforeEach(async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(`${DATA_ORIGIN}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 2, verses: 6, chapterIds: [1, 2] }] });
    const chapter = /\/api\/kjv\/genesis\/(\d+)\.json/.exec(path);
    if (chapter) return r.fulfill({ json: { book: "Genesis", chapter: +chapter[1], translation: "KJV", verses } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress", textDisplay: "block" }));
  });
  page.on("dialog", d => void d.accept());
});
async function open(page: Page) {
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1 .bs-text")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
type Point = { x: number; y: number };
/** Real browser text geometry, including the spans of already-saved marks. */
async function wordPoint(page: Page, verse: number, word: string): Promise<Point> {
  return page.locator(`#verset-${verse} .bs-text`).evaluate((el, word) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = ` ${n.textContent} `.search(new RegExp(`[^A-Za-z]${word}[^A-Za-z]`));
      if (i < 0) continue;
      const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + word.length);
      const r = range.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    throw new Error(`${word} not found`);
  }, word);
}
async function hold(page: Page, p: Point) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await page.waitForTimeout(500);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}
async function selectWord(page: Page, verse = 1, word = "beginning") {
  await hold(page, await wordPoint(page, verse, word));
  await expect(toolbar(page)).toBeVisible();
  await expect(page.locator(".bs-sel-handle")).toHaveCount(2);
}
async function drag(page: Page, from: Point, to: Point, steps = 5) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    for (let i = 1; i <= steps; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally { await cdp.detach(); }
}
async function handle(page: Page, which: "start" | "end", verse: number, word: string) {
  const box = (await page.locator(`.bs-sel-handle--${which}`).boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await wordPoint(page, verse, word));
}
/** Assert what is actually painted under the words, not just internal selection state. */
const selectedWords = (page: Page) => page.evaluate(() => {
  const rects = [...document.querySelectorAll(".bs-hl--selection")].map(el => el.getBoundingClientRect());
  const words: string[] = [];
  for (const el of document.querySelectorAll(".bs-text")) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const m of n.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange(); range.setStart(n, m.index!); range.setEnd(n, m.index! + m[0].length);
      const b = range.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (rects.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) words.push(m[0]);
    }
  }
  return words.join(" ");
});
async function done(page: Page) {
  await toolbar(page).getByRole("button", { name: "Done", exact: true }).tap();
  await expect(toolbar(page)).toHaveCount(0);
}

test("1: long press selects one word; both handles extend, shrink and cross into the next verse", async ({ page }) => {
  await open(page); await selectWord(page);
  await expect.poll(() => selectedWords(page)).toBe("beginning");
  await handle(page, "end", 1, "created");
  await expect.poll(() => selectedWords(page)).toBe("beginning God created");
  await handle(page, "end", 1, "God");
  await expect.poll(() => selectedWords(page)).toBe("beginning God");
  await handle(page, "start", 1, "the");
  await expect.poll(() => selectedWords(page)).toBe("the beginning God");
  await handle(page, "start", 1, "God");
  await expect.poll(() => selectedWords(page)).toBe("God");
  // Crossing the handles must not swap the end a later drag controls.
  await handle(page, "start", 1, "created");
  await expect.poll(() => selectedWords(page)).toBe("God created");
  await handle(page, "end", 1, "heaven");
  await expect.poll(() => selectedWords(page)).toBe("God created the heaven");
  await handle(page, "end", 2, "earth");
  await expect.poll(() => selectedWords(page)).toBe("God created the heaven and the earth. And the earth");
  await toolbar(page).getByRole("radio", { name: "Highlight", exact: true }).tap();
  await expect(marked(page)).toHaveText(["God created the heaven and the earth.", "And the earth"]);
});

test("2: word selection offers only the requested styles, colours, Note, Delete and Done", async ({ page }) => {
  await open(page); await selectWord(page);
  await expect(toolbar(page).getByRole("radio")).toHaveCount(3);
  for (const name of ["Highlight", "Underline", "Circle"]) await expect(toolbar(page).getByRole("radio", { name, exact: true })).toBeVisible();
  await expect(toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button")).toHaveCount(5);
  for (const name of ["Note", "Delete", "Done"]) await expect(toolbar(page).getByRole("button", { name, exact: true })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: /Tags|Relations|More colours/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /^Selected:/ })).toHaveCount(0);
});

test("3: each style saves exactly its word immediately and survives reload and chapter navigation", async ({ page }) => {
  await open(page);
  for (const [word, style] of [["beginning", "Highlight"], ["God", "Underline"], ["created", "Circle"]]) {
    await selectWord(page, 1, word);
    await toolbar(page).getByRole("radio", { name: style, exact: true }).tap();
    await expect(marked(page).filter({ hasText: new RegExp(`^${word}$`) })).toHaveClass(new RegExp(`phrase-${style.toLowerCase()}`));
    await done(page);
  }
  await page.reload();
  await expect(marked(page)).toHaveText(["beginning", "God", "created"]);
  await page.getByRole("button", { name: "Next chapter", exact: true }).tap();
  await expect(page).toHaveURL(/\/read\/genesis\/2/); await expect(marked(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Previous chapter", exact: true }).tap();
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  await expect(marked(page)).toHaveText(["beginning", "God", "created"]);
});

test("4: tapping a saved mark selects it for restyling, colour, a persistent note and deletion", async ({ page }) => {
  await open(page); await selectWord(page);
  await toolbar(page).getByRole("radio", { name: "Highlight", exact: true }).tap();
  await expect(marked(page)).toHaveText("beginning"); await done(page);
  await marked(page).tap(); await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole("radio", { name: "Circle", exact: true }).tap();
  await expect(marked(page)).toHaveClass(/phrase-circle/);
  const color = toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").nth(1);
  await color.tap(); await expect(color).toHaveAttribute("aria-pressed", "true");
  const ink = await marked(page).evaluate(el => getComputedStyle(el).borderColor);
  await toolbar(page).getByRole("button", { name: "Note", exact: true }).tap();
  const note = page.getByRole("dialog", { name: "Note", exact: true });
  await note.getByLabel("Title", { exact: true }).fill("Creation");
  await note.getByLabel("Description", { exact: true }).fill("A note on this word.");
  await note.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(toolbar(page)).toBeVisible(); await done(page);
  await page.reload(); await expect(marked(page)).toHaveText("beginning");
  await expect(marked(page)).toHaveCSS("border-color", ink);
  await marked(page).tap(); await toolbar(page).getByRole("button", { name: "Note", exact: true }).tap();
  await expect(note.getByLabel("Title", { exact: true })).toHaveValue("Creation");
  await expect(note.getByLabel("Description", { exact: true })).toHaveValue("A note on this word.");
  await note.getByRole("button", { name: "Cancel", exact: true }).tap();
  await toolbar(page).getByRole("button", { name: "Delete", exact: true }).tap();
  await expect(marked(page)).toHaveCount(0);
  await page.reload(); await expect(marked(page)).toHaveCount(0);
});

test("5: outside tap, outside long press, both Done controls and Telegram Back end word selection", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __cloud: Record<string, string> }).__cloud = { bs_bm: JSON.stringify([{ id: "existing-bookmark", name: "Creation", book: "genesis", chapter: 1, verse: 1, color: "#0984e3", date: 1 }]) }; });
  await open(page);
  for (const exit of ["outside tap", "outside hold", "Done", "header", "Telegram"]) {
    await test.step(exit, async () => {
      await selectWord(page);
      if (exit === "outside tap") await page.touchscreen.tap(3, 160);
      if (exit === "outside hold") await hold(page, { x: 3, y: 160 });
      if (exit === "Done") await toolbar(page).getByRole("button", { name: "Done", exact: true }).tap();
      if (exit === "header") await page.getByRole("button", { name: "Exit annotation mode", exact: true }).tap();
      if (exit === "Telegram") await page.evaluate(() => (window as unknown as { __tg: { press(s: string): void } }).__tg.press("back"));
      await expect(toolbar(page)).toHaveCount(0); await expect(page.locator(".bs-sel-handle")).toHaveCount(0);
      await expect(page).toHaveURL(/\/read\/genesis\/1/);
    });
  }
  await selectWord(page);
  const bookmark = page.locator("#verset-1 .bs-bm");
  const box = (await bookmark.boundingBox())!;
  await hold(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  // Inline content controls are outside verse text too.
  await expect(page.locator(".bs-sel-handle")).toHaveCount(0);
  await expect(marked(page)).toHaveCount(0);
});

test("6: a tap still selects the verse; a chapter swipe works only outside word selection", async ({ page }) => {
  await open(page);
  const p = await wordPoint(page, 1, "beginning"); await page.touchscreen.tap(p.x, p.y);
  await expect(page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true })).toBeVisible();
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
  await page.evaluate(() => (window as unknown as { __tg: { press(s: string): void } }).__tg.press("back"));
  await expect(page.locator(".bs-selected")).toHaveCount(0);
  await selectWord(page);
  const start = await wordPoint(page, 2, "without");
  await drag(page, start, { x: 20, y: start.y }, 3);
  await expect(page).toHaveURL(/\/read\/genesis\/1/); await expect(toolbar(page)).toBeVisible();
  await done(page);
  await drag(page, { x: 330, y: 350 }, { x: 40, y: 350 }, 3);
  await expect(page).toHaveURL(/\/read\/genesis\/2/);
});

const oldMark = { id: "fe47a55e-15f4-42db-8a95-809b314b3c11", verseKey: "genesis-1-1", start: 7, end: 20, quote: "beginning God", style: "underline", created: "2026-10-08T18:00:00.000Z" };
async function restore(page: Page, annotations: unknown[]) {
  await page.locator('input[type="file"]').setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "cyberjudah-studies", version: 1, studies: [], annotations })) });
  await expect(page.getByText("Restored 0 studies as new copies. Existing work is unchanged.")).toBeVisible();
}
async function backup(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export all personal studies", exact: true }).click();
  return JSON.parse(await fs.readFile((await (await download).path())!, "utf8"));
}
test("a pre-change backup with no optional fields still restores and keeps the original mark", async ({ page }) => {
  await page.goto("/settings/account"); await restore(page, [oldMark]);
  const exported = await backup(page);
  expect(exported.annotations).toHaveLength(1);
  const { id, ...restored } = exported.annotations[0]; expect(id).toBeTruthy();
  expect(restored).toEqual(Object.fromEntries(Object.entries(oldMark).filter(([key]) => key !== "id")));
  await goInApp(page, "/read/genesis/1");
  await expect(page.locator(".phrase-underline")).toHaveText("beginning God");
});
test("a mark with color, note, tags and group round-trips through backup and restore", async ({ page }) => {
  const full = { ...oldMark, color: "color2", note: { title: "Creation", description: "Keep every field", date: 1 }, tags: { creation: true }, group: "creation-group" };
  await page.goto("/settings/account"); await restore(page, [full]);
  const first = await backup(page);
  await page.getByText("Delete personal studies on this device", { exact: true }).click();
  await expect(page.getByText("Personal studies and phrase marks were removed from this device.")).toBeVisible();
  await restore(page, first.annotations);
  const second = await backup(page);
  expect(second.annotations).toHaveLength(1);
  expect(second.annotations[0]).toEqual({ ...full, id: expect.any(String) });
  await goInApp(page, "/read/genesis/1");
  await expect(page.locator(".phrase-underline")).toHaveText("beginning God");
});
