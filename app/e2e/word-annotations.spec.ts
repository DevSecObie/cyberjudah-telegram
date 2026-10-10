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
  page.on("dialog", d => void d.accept());
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
async function tap(page: Page, verse: number, word: string) {
  const p = await wordPoint(page, verse, word);
  await page.mouse.click(p.x, p.y);
}
/** The words under the blue selection rects. */
const selectedWords = (page: Page) => page.evaluate(() => {
  const rects = [...document.querySelectorAll<HTMLElement>(".bs-hl--selection")].map(e => e.getBoundingClientRect());
  const text = document.querySelector(".bs-container")!;
  const words: string[] = [];
  for (const el of text.querySelectorAll<HTMLElement>(".bs-text")) {
    const node = el.firstChild as Text; const s = node.textContent!;
    for (const m of s.matchAll(/\S+/g)) {
      const r = document.createRange(); r.setStart(node, m.index!); r.setEnd(node, m.index! + m[0].length);
      const b = r.getBoundingClientRect(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      if (rects.some(q => cx >= q.left && cx <= q.right && cy >= q.top && cy <= q.bottom)) words.push(m[0]);
    }
  }
  return words.join(" ");
});
async function dragHandle(page: Page, which: "start" | "end", to: { x: number; y: number }) {
  const box = (await page.locator(`.bs-sel-handle--${which}`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
}
const toolbar = (page: Page) => page.getByRole("dialog", { name: "Free mode" });

test("a double tap enters free mode on the word; the handle extends it; a colour marks it and selects the mark", async ({ page }, info) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-text")).toBeVisible();
  await doubleTap(page, 1, "beginning");
  await expect(page.locator(".bs-header--annotating")).toContainText("Genesis 1 - KJV");
  await expect(toolbar(page)).toContainText("Genesis 1:1");
  await expect.poll(() => selectedWords(page)).toBe("beginning");
  await expect(page.getByRole("dialog", { name: /^Selected:/ })).toHaveCount(0);

  await dragHandle(page, "end", await wordPoint(page, 1, "created"));
  await expect.poll(() => selectedWords(page)).toBe("beginning God created");
  await page.screenshot({ path: info.outputPath("free-mode-selection.png") });

  await toolbar(page).getByRole("radio", { name: "Underline" }).click();
  await toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").nth(1).click();
  // The new mark is selected and the toolbar stays open on it.
  const mark = page.locator(".bs-hl--underline");
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute("data-selected", "");
  await expect(toolbar(page).getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(toolbar(page).getByRole("button", { name: "Note" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("free-mode-mark.png") });

  await page.getByRole("button", { name: "Exit annotation mode" }).click();
  await expect(toolbar(page)).toHaveCount(0);
  await expect(page.locator(".bs-header--annotating")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".bs-hl--underline")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("reading-mark.png") });
});

test("a selected mark changes kind in place, takes a note and tags, and its deletion is confirmed", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await doubleTap(page, 1, "heaven");
  await toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").first().click();
  await expect(page.locator(".bs-hl--background")).toHaveCount(1);
  // Choosing a kind arms it; the colour applies it to the selected mark.
  await toolbar(page).getByRole("radio", { name: "Circle" }).click();
  await toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").nth(2).click();
  await expect(page.locator(".bs-hl--circle")).toHaveCount(1);
  await expect(page.locator(".bs-hl--background")).toHaveCount(0);

  await toolbar(page).getByRole("button", { name: "Note" }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("The heavens");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).getByRole("button", { name: /^Tags/ }).click();
  await page.getByRole("textbox", { name: "Search tags" }).fill("creation");
  await page.getByRole("button", { name: "Create « creation »" }).click();
  await page.getByRole("dialog", { name: "Edit tags" }).getByRole("button", { name: "Close" }).click();
  await expect(toolbar(page).getByRole("button", { name: "Tags, 1" })).toBeVisible();

  const asked: string[] = [];
  page.removeAllListeners("dialog");
  page.on("dialog", d => { asked.push(d.message()); void d.accept(); });
  await toolbar(page).getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".bs-hl--circle")).toHaveCount(0);
  expect(asked[0]).toBe("This annotation has a note and tags attached. Do you really want to delete it?");
});

test("drawing over a mark replaces it, a tap ends the selection, and the selection spans verses", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await doubleTap(page, 1, "God");
  await toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").first().click();
  await expect(page.locator(".bs-hl--background")).toHaveCount(1);
  // A tap on a plain word lets the mark go and selects that word; a second tap ends the selection.
  await tap(page, 1, "earth");
  await expect.poll(() => selectedWords(page)).toBe("earth.");
  await tap(page, 2, "deep");
  await expect(page.locator(".bs-hl--selection")).toHaveCount(0);
  await expect(toolbar(page)).toContainText("Select text in the Bible");
  // Select from "beginning" to "form," across both verses, over the mark.
  await tap(page, 1, "beginning");
  await dragHandle(page, "end", await wordPoint(page, 2, "form"));
  await expect(toolbar(page)).toContainText("Genesis 1:1-2");
  await toolbar(page).getByRole("radio", { name: "Underline" }).click();
  await toolbar(page).getByRole("group", { name: "Mark colour" }).getByRole("button").nth(3).click();
  await expect(page.locator(".bs-hl--background")).toHaveCount(0);
  await expect(page.locator(".bs-hl--underline").first()).toBeVisible();
  // One mark over two verses: selecting it selects all of it.
  expect(await page.locator(".bs-hl--underline[data-selected]").count()).toBe(await page.locator(".bs-hl--underline").count());
});

test("a mouse drag over the text enters free mode with those words selected", async ({ page }) => {
  await page.goto("/read/genesis/1");
  const from = await wordPoint(page, 2, "darkness"), to = await wordPoint(page, 2, "upon");
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  // Slowly, as a reader selects (a fast flick turns the chapter).
  for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await page.waitForTimeout(40); }
  await page.mouse.up();
  await expect(toolbar(page)).toBeVisible();
  await expect.poll(() => selectedWords(page)).toBe("darkness was upon");
});
