import { expect, test, type Page } from "@playwright/test";

// Bible Strong's route form sheets: an entry opened in the app slides up over the page it came
// from (app/(explore): 45% then full, the page behind usable at 45%; app/strong: full height).
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/strongs/index.json"
    ? r.fulfill({ json: [{ n: "H1", lemma: "אָב", xlit: "ʼâb", def: "father", count: 1215 }] })
    : r.fulfill({ status: 404, body: "" }));
  await page.route("**/api/dictionary?*", r => r.fulfill({ json: { count: 2, page: 1, pages: 1, rows: [{ slug: "aaron", term: "Aaron" }, { slug: "abel", term: "Abel" }], related: [], total: 3963 } }));
  await page.route("**/api/dictionary/aaron", r => r.fulfill({ json: { slug: "aaron", term: "Aaron", definitions: ["The eldest son of Amram and Jochebed, a daughter of Levi. See Abel."] } }));
  await page.route("**/api/dictionary/abel", r => r.fulfill({ json: { slug: "abel", term: "Abel", definitions: ["Breath, or vanity."] } }));
}

test("a dictionary word opens as a sheet at 45% over the list, which stays usable, and closes back to it", async ({ page }) => {
  await setup(page);
  await page.goto("/dictionary?q=a");
  await page.getByRole("link", { name: "Aaron", exact: true }).click();
  await expect(page).toHaveURL(/\/dictionary\/aaron$/);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // Bible Strong's route Header: the word in 14 px bold, the dictionary under it, no back on the first screen.
  const title = sheet.getByRole("heading", { name: "Aaron", exact: true });
  await expect(title).toHaveCSS("font-size", "14px");
  await expect(sheet.getByText("Easton's Bible Dictionary", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  // The native grabber shows over the header, as on every Bible Strong sheet.
  const grabber = sheet.getByRole("button", { name: "Expand sheet" });
  await expect(grabber).toBeVisible();
  expect(await grabber.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); })).toBe(true);
  const max = 844 - 8;
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(.45 * max));
  // The list is still there behind, not dimmed.
  await expect(page.locator(".bs-scrim--clear")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Abel", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dictionary\?q=a$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("after a sheet closes, the page under it still goes back with its own ←", async ({ page }) => {
  await setup(page);
  await page.goto("/dictionary?q=a");
  await page.getByRole("link", { name: "Aaron", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Aaron" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dictionary\?q=a$/);
  await page.locator(".head__back").click();
  await expect(page).not.toHaveURL(/\/dictionary/);
});

test("the sheet does not move the tab: the tab stays on the page behind it", async ({ page }) => {
  await setup(page);
  await page.goto("/dictionary?q=a");
  await page.getByRole("link", { name: "Aaron", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Aaron" })).toBeVisible();
  const place = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cj:tabgroups") ?? "null"); const g = s.groups.find((x: { id: string }) => x.id === s.group); return g.tabs.find((t: { id: string }) => t.id === g.current).path; });
  await expect.poll(place).toBe("/dictionary?q=a");
});

test("an entry opened from outside the app is a page, as before", async ({ page }) => {
  await setup(page);
  await page.goto("/dictionary/aaron");
  await expect(page.getByRole("heading", { name: "Aaron", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a Strong's entry opens at full height, dimmed, as Bible Strong's strong sheet", async ({ page }) => {
  await setup(page);
  await page.goto("/lexicon?letter=f");
  await page.locator('a[href="/lexicon/H1"]').first().click();
  await expect(page).toHaveURL(/\/lexicon\/H1$/);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveClass(/bs-sheet--full/);
  await expect(page.locator(".bs-scrim--clear")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/lexicon\?letter=f$/);
});

// A native sheet moves with its content: pushed up it grows to its next detent, pulled down from
// the top of its scroll it goes back, then closes. Several moves in one touch, as a finger makes.
async function swipe(page: Page, sheet: ReturnType<Page["getByRole"]>, from: number, to: number) {
  await sheet.locator(".bs-sheet__body").evaluate(async (body, [from, to]) => {
    const r = body.getBoundingClientRect(), x = r.x + r.width / 2, target = body.querySelector("button, div") ?? body;
    const fire = (type: string, y: number) => { const t = new Touch({ identifier: 7, target, clientX: x, clientY: y }); target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] })); };
    fire("touchstart", r.y + from);
    for (let i = 1; i <= 8; i++) { fire("touchmove", r.y + from + ((to - from) * i) / 8); await new Promise(res => requestAnimationFrame(() => res(null))); }
    fire("touchend", r.y + to);
  }, [from, to] as const);
}
test("a sheet follows a finger on its content through the whole drag: up grows it, down from the top closes it", async ({ page }) => {
  await setup(page);
  await page.route(`${DATA}/api/kjv/**`, r => new URL(r.request().url()).pathname.endsWith("books.json")
    ? r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, verses: 31, chapterIds: [1] }] })
    : r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }] } }));
  await page.goto("/read/genesis/1");
  await page.getByRole("button", { name: "Scripture options" }).click();
  await page.getByRole("menuitem", { name: "Font and settings", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Font and settings", exact: true });
  await expect(sheet).not.toHaveClass(/bs-sheet--full/);
  await page.waitForTimeout(600);
  await swipe(page, sheet, 120, 20);
  await expect(sheet).toHaveClass(/bs-sheet--full/);
  await expect(sheet).not.toHaveAttribute("style", /translateY/);
  await swipe(page, sheet, 40, 200);
  await expect(sheet).not.toHaveClass(/bs-sheet--full/);
  await swipe(page, sheet, 40, 200);
  await expect(sheet).toHaveCount(0);
});
