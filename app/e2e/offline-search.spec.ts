import { expect, test } from "@playwright/test";
const origin = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const books = [
  { book: "Genesis", slug: "genesis", chapters: 2, verses: 28, testament: "Old Testament", chapterIds: [1, 2], url: "/bible/genesis" },
  { book: "John", slug: "john", chapters: 1, verses: 1, testament: "New Testament", chapterIds: [1], url: "/bible/john" },
];
const chapter = { book: "Genesis", chapter: 1, translation: "KJV", url: "/bible/genesis/1", verses: Array.from({ length: 26 }, (_, i) => ({ verse: i + 1, text: `God created the heaven and the earth. Verse ${i + 1}.` })) };
test("downloaded scripture remains searchable offline with filters and a clear coverage label", async ({ page, context }) => {
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  await page.route(`${origin}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    return path.endsWith("/books.json") ? r.fulfill({ json: books }) : path.endsWith("/genesis/1.json") ? r.fulfill({ json: chapter }) : r.fulfill({ status: 404 });
  });
  let onlineCalls = 0;
  await page.route("**/bs/v1/bibles/KJV/search?*", r => { onlineCalls++; return r.fulfill({ json: { count: 1, results: [{ book: 43, chapter: 1, verse: 1, text: "God created" }] } }); });
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.evaluate(async ({ origin, books, chapter }) => {
    const cache = await caches.open("cj-offline-v1");
    await cache.put(`${origin}/api/kjv/books.json`, new Response(JSON.stringify(books)));
    await cache.put(`${origin}/api/kjv/genesis/1.json`, new Response(JSON.stringify(chapter)));
  }, { origin, books, chapter });
  await page.getByRole("button", { name: "Scripture options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Search the Scriptures", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Search the Scriptures", exact: true });
  await context.setOffline(true);
  await sheet.getByRole("searchbox").fill('"God created"');
  await expect(sheet.getByRole("status")).toContainText("Offline · searched 1 saved chapter in 1 book");
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("Genesis 1:1");
  await expect(sheet.locator(".bs-search__count")).toContainText("26 verses");
  expect(onlineCalls).toBe(0);
  await sheet.getByLabel("One book").selectOption("john");
  await expect(sheet.getByRole("status")).toContainText("0 saved chapters");
  await expect(sheet.locator(".bs-search__hit")).toHaveCount(0);
  await sheet.getByLabel("One book").selectOption("genesis");
  await expect(sheet.locator(".bs-search__hit").first()).toBeVisible();
  await context.setOffline(false);
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("John 1:1");
  await expect(sheet.getByText(/Offline · searched/)).toHaveCount(0);
  expect(onlineCalls).toBeGreaterThan(0);
});
