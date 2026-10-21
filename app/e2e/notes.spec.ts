import { expect, test, type Page } from "@playwright/test";

// Bible Strong's BibleVerseNotesScreen: the filter button (Search, Order, Tags, kept between
// visits), a BibleNoteItem per note with its tags and relations, and its options (View in Bible,
// Open in new tab, Remove).
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOOKS = [
  { book: "Psalms", slug: "psalms", chapters: 150, verses: 2461, testament: "Old Testament", url: "/bible/psalms", chapterIds: [23] },
  { book: "John", slug: "john", chapters: 21, verses: 879, testament: "New Testament", url: "/bible/john", chapterIds: [1] },
];

async function setup(page: Page, seed = true) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.removeItem("cj:entityListFilters.notes.v1");
    if (!seed) return;
    localStorage.setItem("cj:bs_tags", JSON.stringify({ t1: { id: "t1", name: "Comfort", date: 1 } }));
    localStorage.setItem("cj:bs_n_psalms_23", JSON.stringify({ "1/2": { id: "n1", title: "The shepherd psalm.", description: "He restoreth my soul.", date: Date.now() - 2 * 86400e3, tags: { t1: true } } }));
    localStorage.setItem("cj:bs_n_john_1", JSON.stringify({ "4": { id: "n2", title: "", description: "The life was the light of men.", date: Date.now() - 3600e3 } }));
    localStorage.setItem("cj:rel_psalms_23", JSON.stringify([{ id: "r1", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["psalms-23-1", "psalms-23-2"], label: "Psalms 23:1-2" }, { type: "note", verseKey: "psalms-23-1", label: "The shepherd psalm." }], createdAt: 1, updatedAt: 1 }]));
  }, seed);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/kjv/books.json" ? r.fulfill({ json: BOOKS }) : r.fulfill({ status: 404, body: "" }));
}
const metas = (page: Page) => page.locator(".noteitem__meta");
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);

test("a row per note, newest first: where and how long ago, the title, the start of the text, its tags and relations", async ({ page }) => {
  await setup(page);
  await page.goto("/notes");
  await expect(page.locator(".head h1")).toHaveText("Notes");
  await expect(metas(page)).toHaveText([/^John 1:4 - .*hour ago$/, /^Psalms 23:1-2 - 2 days ago$/]);
  const shepherd = page.locator(".noteitem", { hasText: "The shepherd psalm." });
  await expect(shepherd.locator(".noteitem__desc")).toHaveText("He restoreth my soul.");
  await expect(shepherd.locator(".tagd-chip")).toHaveText(["Comfort", "1"]);
  // An untitled note shows its text alone.
  await expect(page.locator(".noteitem").first().locator(".noteitem__title")).toHaveCount(0);
  await shepherd.locator(".tagd-chip", { hasText: "1" }).click();
  await expect(page).toHaveURL(/\/relations\?endpoint=note%3Apsalms-23-1$/);
  await page.goBack();
  await page.locator(".noteitem__link", { hasText: "The shepherd psalm." }).click();
  await expect(page).toHaveURL(/\/read\/psalms\/23\?v=1$/);
});

test("the filter panel searches, orders and narrows by tag, and keeps them for the next visit", async ({ page }) => {
  await setup(page);
  await page.goto("/notes");
  await expect(metas(page)).toHaveCount(2);
  await page.locator(".head .bs-filter").click();
  await expect(page.locator(".panel-filter .panel-filter__label")).toHaveText(["Search", "Order", "Tags"]);
  await page.locator(".panel-filter", { hasText: "Tags" }).click();
  await page.getByRole("radio", { name: "Comfort", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(metas(page)).toHaveText([/^Psalms 23:1-2/]);
  await page.reload();
  await expect(metas(page)).toHaveText([/^Psalms 23:1-2/]);
  await page.locator(".head .bs-filter").click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.locator(".panel-filter", { hasText: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("zzz");
  await expect(page.getByText('No results found for "zzz"')).toBeVisible();
});

test("a note's options: View in Bible, Open in new tab, and Remove after asking, its link to the verse with it", async ({ page }) => {
  await setup(page);
  await page.goto("/notes");
  const options = (text: string) => page.locator(".noteitem", { hasText: text }).getByRole("button", { name: "More options", exact: true });
  await options("The shepherd psalm.").click();
  await expect(page.locator(".panel-action")).toHaveText(["View in Bible", "Open in new tab", "Remove"]);
  await page.locator(".panel-action", { hasText: "Open in new tab" }).click();
  await expect(page.locator(".toast", { hasText: "New tab created" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!).groups[0].tabs.map((t: { path: string }) => t.path))).toContain("/read/psalms/23?v=1");

  page.once("dialog", (d) => void d.accept());
  await options("The shepherd psalm.").click();
  await page.locator(".panel-action", { hasText: "Remove" }).click();
  await expect(metas(page)).toHaveText([/^John 1:4/]);
  expect(await stored(page, "cj:bs_n_psalms_23")).toEqual({});
  expect((await stored(page, "cj:rel_psalms_23")) ?? []).toEqual([]);

  await options("The life was the light of men.").click();
  await page.locator(".panel-action", { hasText: "View in Bible" }).click();
  await expect(page).toHaveURL(/\/read\/john\/1\?v=4$/);
});

test("no notes says so", async ({ page }) => {
  await setup(page, false);
  await page.goto("/notes");
  await expect(page.getByText("You don't have any notes yet ...")).toBeVisible();
});
