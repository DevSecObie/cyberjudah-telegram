import { expect, test, type Page } from "@playwright/test";

// Bible Strong's HighlightsScreen: the filter button (Type, Color, Tags, Testament, Book, Order,
// kept between visits), every highlight as its Verse row (a highlight made at once over several
// verses is one), and each row's options (Change color, Edit tags, Remove).
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOOKS = [
  { book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis", chapterIds: [1] },
  { book: "John", slug: "john", chapters: 21, verses: 879, testament: "New Testament", url: "/bible/john", chapterIds: [1] },
];
const CHAPTERS: Record<string, unknown> = {
  "/api/kjv/genesis/1.json": { book: "Genesis", slug: "genesis", chapter: 1, verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void." }] },
  "/api/kjv/john/1.json": { book: "John", slug: "john", chapter: 1, verses: [{ verse: 4, text: "In him was life; and the life was the light of men." }] },
};

async function setup(page: Page, seed = true) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.removeItem("cj:entityListFilters.highlights.v1");
    if (!seed) return;
    localStorage.setItem("cj:bs_tags", JSON.stringify({ t1: { id: "t1", name: "Light", date: 1 } }));
    localStorage.setItem("cj:bs_h_genesis_1", JSON.stringify({ 1: { color: "color1", date: 1000, tags: { t1: true } }, 2: { color: "color1", date: 1000, tags: { t1: true } } }));
    localStorage.setItem("cj:bs_h_john_1", JSON.stringify({ 4: { color: "color3", date: 2000 } }));
  }, seed);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: BOOKS });
    if (CHAPTERS[path]) return r.fulfill({ json: CHAPTERS[path] });
    return r.fulfill({ status: 404, body: "" });
  });
}
const refs = (page: Page) => page.locator(".tagd-item__ref");
const filter = async (page: Page, row: string, choice: string) => {
  await page.locator(".head .bs-filter").click();
  await page.locator(".panel-filter", { hasText: row }).click();
  await page.getByRole("radio", { name: choice, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
};
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}"), key);

test("every highlight, newest first, one per moment it was made: its colour and reference, how long ago, the text, its tags", async ({ page }) => {
  await setup(page);
  await page.goto("/highlights");
  await expect(page.locator(".head h1")).toHaveText("Highlights");
  await expect(refs(page)).toHaveText(["John 1:4", "Genesis 1:1-2"]);
  await expect(page.locator(".tagd-item__text").last()).toContainText("In the beginning God created the heaven and the earth.");
  await expect(page.locator(".tagd-item").last().locator(".tagd-chip")).toHaveText("Light");
  await expect(page.locator(".tagd-item").first().getByRole("button", { name: "More options", exact: true })).toBeVisible();
});

test("the filters narrow by colour, tag, testament and book, order them by the Bible, and stay for the next visit", async ({ page }) => {
  await setup(page);
  await page.goto("/highlights");
  await expect(refs(page)).toHaveCount(2);
  await page.locator(".head .bs-filter").click();
  await expect(page.locator(".panel-filter .panel-filter__label")).toHaveText(["Type", "Color", "Tags", "Testament", "Book", "Order"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await filter(page, "Color", "Color 1");
  await expect(refs(page)).toHaveText(["Genesis 1:1-2"]);
  await filter(page, "Color", "All");
  await filter(page, "Tags", "Light");
  await expect(refs(page)).toHaveText(["Genesis 1:1-2"]);
  await filter(page, "Tags", "All");
  await filter(page, "Testament", "New Testament");
  await expect(refs(page)).toHaveText(["John 1:4"]);
  await filter(page, "Testament", "Whole Bible");
  await filter(page, "Book", "Genesis");
  await expect(refs(page)).toHaveText(["Genesis 1:1-2"]);
  await filter(page, "Book", "All");
  await filter(page, "Order", "Bible order");
  await expect(refs(page)).toHaveText(["Genesis 1:1-2", "John 1:4"]);
  await page.reload();
  await expect(refs(page)).toHaveText(["Genesis 1:1-2", "John 1:4"]);
  await expect(page.locator(".head .bs-filter")).toHaveAttribute("aria-label", "1 filter");
});

test("a highlight's options change its colour, edit its tags (a new one too), and remove it after asking", async ({ page }) => {
  await setup(page);
  await page.goto("/highlights");
  const options = (ref: string) => page.locator(".tagd-item", { hasText: ref }).getByRole("button", { name: "More options", exact: true });
  await options("John 1:4").click();
  await expect(page.locator(".panel-action")).toHaveText(["Change color", "Edit tags", "Remove"]);
  await page.locator(".panel-action", { hasText: "Change color" }).click();
  await page.locator(".bs-colors__cell").first().click();
  await expect.poll(async () => (await stored(page, "cj:bs_h_john_1"))["4"].color).toBe("color1");

  await page.locator(".panel-action", { hasText: "Edit tags" }).click();
  await page.getByRole("checkbox", { name: "Light" }).click();
  await expect.poll(async () => (await stored(page, "cj:bs_h_john_1"))["4"].tags).toEqual({ t1: true });
  await page.getByRole("searchbox", { name: "Search" }).fill("Life");
  await page.locator(".panel-action", { hasText: "Create « Life »" }).click();
  await expect.poll(async () => Object.keys((await stored(page, "cj:bs_h_john_1"))["4"].tags).length).toBe(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tagd-item", { hasText: "John 1:4" }).locator(".tagd-chip")).toHaveText(["Light", "Life"]);

  page.once("dialog", (d) => void d.accept());
  await options("Genesis 1:1-2").click();
  await page.locator(".panel-action", { hasText: "Remove" }).click();
  await expect(refs(page)).toHaveText(["John 1:4"]);
  expect(await stored(page, "cj:bs_h_genesis_1")).toEqual({});
});

test("nothing highlighted says so", async ({ page }) => {
  await setup(page, false);
  await page.goto("/highlights");
  await expect(page.getByText("You haven't highlighted anything yet ...")).toBeVisible();
});

test("a long list draws thirty highlights, then thirty more as its end comes into view", async ({ page }) => {
  await setup(page, false);
  await page.addInitScript(() => {
    const hl: Record<string, unknown> = {};
    for (let v = 1; v <= 31; v++) hl[v] = { color: "color1", date: 1000 + v };
    localStorage.setItem("cj:bs_h_genesis_1", JSON.stringify(hl));
  });
  await page.goto("/highlights");
  await expect(refs(page)).toHaveCount(30);
  await page.locator(".list-more").scrollIntoViewIfNeeded();
  await expect(refs(page)).toHaveCount(31);
});
