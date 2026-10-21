import { expect, test, type Page } from "@playwright/test";

// Bible Strong's BookmarksScreen: the filter button (Search, Order), a row per bookmark with its
// colour, name and reference, and its options (View in Bible, Edit, Remove). Kept's highlights
// and notes are their own screens; the old addresses lead to them.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOOKS = [
  { book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis" },
  { book: "Psalms", slug: "psalms", chapters: 150, verses: 2461, testament: "Old Testament", url: "/bible/psalms" },
];
const BOOKMARKS = [
  { id: "a", name: "Comfort", color: "#0984e3", book: "psalms", chapter: 23, verse: 1, date: 2000 },
  { id: "b", name: "The beginning", color: "#cc0000", book: "genesis", chapter: 1, date: 1000 },
];

async function setup(page: Page, bookmarks: unknown[] = BOOKMARKS) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((bm) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("cj:bs_bm", JSON.stringify(bm)); } }, bookmarks);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/kjv/books.json" ? r.fulfill({ json: BOOKS }) : r.fulfill({ status: 404, body: "" }));
}
const names = (page: Page) => page.locator(".bmitem__text b");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:bs_bm") ?? "[]"));
const closePanel = async (page: Page) => { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); };

test("a row per bookmark, newest first: its colour, its name over its reference; the filter panel searches and orders", async ({ page }) => {
  await setup(page);
  await page.goto("/bookmarks");
  await expect(page.locator(".head h1")).toHaveText("Bookmarks");
  await expect(names(page)).toHaveText(["Comfort", "The beginning"]);
  await expect(page.locator(".bmitem__text span")).toHaveText(["Psalms 23:1", "Genesis 1"]);
  const row = await page.locator(".bmitem").first().evaluate((el) => { const s = getComputedStyle(el); return [s.paddingTop, s.paddingLeft, s.paddingRight]; });
  expect(row).toEqual(["10px", "20px", "0px"]);

  await page.locator(".head .bs-filter").click();
  await page.locator(".panel-filter", { hasText: "Order" }).click();
  await page.getByRole("radio", { name: "Oldest" }).click();
  await expect(names(page)).toHaveText(["The beginning", "Comfort"]);
  await closePanel(page);
  await page.locator(".head .bs-filter").click();
  await page.locator(".panel-filter", { hasText: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("psalms");
  await expect(names(page)).toHaveText(["Comfort"]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(names(page)).toHaveText(["Comfort", "The beginning"]);
  await closePanel(page);

  await page.locator(".bmitem__link", { hasText: "Comfort" }).click();
  await expect(page).toHaveURL(/\/read\/psalms\/23\?at=1$/);
});

test("a bookmark's options: View in Bible, Edit its name and colour, Remove after asking", async ({ page }) => {
  await setup(page);
  await page.goto("/bookmarks");
  const options = (name: string) => page.locator(".bmitem", { hasText: name }).getByRole("button", { name: "More options", exact: true });
  await options("The beginning").click();
  await expect(page.locator(".panel-action")).toHaveText(["View in Bible", "Edit", "Remove"]);
  await page.locator(".panel-action", { hasText: "Edit" }).click();
  await page.getByRole("textbox", { name: "Bookmark name" }).fill("In the beginning");
  await page.getByRole("radio", { name: "#00b894" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(names(page)).toHaveText(["Comfort", "In the beginning"]);
  await expect.poll(async () => (await stored(page)).find((b: { id: string }) => b.id === "b")).toMatchObject({ name: "In the beginning", color: "#00b894" });

  page.once("dialog", (d) => void d.accept());
  await options("Comfort").click();
  await page.locator(".panel-action", { hasText: "Remove" }).click();
  await expect(names(page)).toHaveText(["In the beginning"]);

  await options("In the beginning").click();
  await page.locator(".panel-action", { hasText: "View in Bible" }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
});

test("no bookmarks says so; Kept's old addresses lead to the Highlights and Notes screens", async ({ page }) => {
  await setup(page, []);
  await page.goto("/bookmarks");
  await expect(page.getByText("No bookmarks yet...")).toBeVisible();
  await page.goto("/bookmarks?tab=notes");
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.locator(".head h1")).toHaveText("Notes");
  await page.goto("/bookmarks?tag=t1");
  await expect(page).toHaveURL(/\/highlights\?tag=t1$/);
  await expect(page.locator(".head h1")).toHaveText("Highlights");
});
