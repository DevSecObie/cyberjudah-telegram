import { expect, test, type Page } from "@playwright/test";
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const verses = [
  { verse: 1, text: "In the beginning God created the heaven and the earth." },
  { verse: 2, text: "And the earth was without form, and void; and darkness was upon the face of the deep." },
];
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, verses: 2, chapterIds: [1] }] });
    if (/\/api\/kjv\/genesis\/1.json/.test(path)) return r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses } });
    return r.fulfill({ status: 404, body: "" });
  });
});

/** The centre of a word in a verse, in page coordinates. */
async function wordPoint(page: Page, verse: number, word: string) {
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
async function doubleTap(page: Page, verse: number, word: string) {
  const p = await wordPoint(page, verse, word);
  await page.mouse.dblclick(p.x, p.y);
}
const selectedText = (page: Page) => page.locator(".phrase-selecting").evaluateAll(els => els.map(e => e.textContent).join(""));

test("a double tap selects a word, the handle extends it, and a colour marks it", async ({ page }, info) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-text")).toBeVisible();
  await doubleTap(page, 1, "beginning");
  const toolbar = page.getByRole("dialog", { name: "Annotate: Genesis 1:1" });
  await expect(toolbar).toBeVisible();
  await expect.poll(() => selectedText(page)).toBe("beginning");
  // No verse selection opens alongside the word selection.
  await expect(page.getByRole("dialog", { name: /^Selected:/ })).toHaveCount(0);

  // Drag the end handle along the line to "created".
  const handle = page.locator(".bs-sel-handle--end"), box = (await handle.boundingBox())!;
  const target = await wordPoint(page, 1, "created");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(target.x, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => selectedText(page)).toBe("beginning God created");
  await page.screenshot({ path: info.outputPath("word-selection.png") });

  await toolbar.getByRole("radio", { name: "Underline" }).click();
  await toolbar.getByRole("group", { name: "Mark colour" }).getByRole("button").nth(1).click();
  await expect(toolbar).toBeHidden();
  const mark = page.locator("#verset-1 .phrase-underline");
  await expect(mark).toHaveText("beginning God created");
  expect(await mark.evaluate(el => getComputedStyle(el).textDecorationColor)).toBe("rgb(255, 118, 117)");
  await page.screenshot({ path: info.outputPath("word-mark.png") });

  await page.reload();
  await expect(page.locator("#verset-1 .phrase-underline")).toHaveText("beginning God created");

  // Erasing the middle word keeps the words either side of it marked.
  await doubleTap(page, 1, "God");
  await page.getByRole("button", { name: "Erase marks in the selection" }).click();
  await expect(page.locator("#verset-1 .phrase-underline")).toHaveText(["beginning", "created"]);
});

test("the word selection spans verses and a tap on the text ends it", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await doubleTap(page, 1, "earth");
  const handle = page.locator(".bs-sel-handle--end"), box = (await handle.boundingBox())!;
  const target = await wordPoint(page, 2, "form");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  // Aim the finger at the word's line: the handle aims 12 px above its top.
  await page.mouse.move(target.x, target.y + (box.y + box.height / 2) - (box.y - 12), { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Annotate: Genesis 1:1-2" })).toBeVisible();
  await expect.poll(() => selectedText(page)).toBe("earth.And the earth was without form,");
  const deep = await wordPoint(page, 2, "deep"); await page.mouse.click(deep.x, deep.y);
  await expect(page.locator(".phrase-selecting")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /^Annotate/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /^Selected:/ })).toHaveCount(0);
});
