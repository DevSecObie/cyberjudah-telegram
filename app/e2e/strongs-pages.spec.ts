import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const origin = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const fixture = async (file: string) => JSON.parse(await readFile(new URL(`../../bot/tests/fixtures/bs/api/${file}`, import.meta.url), "utf8"));
test.beforeEach(async ({ page }) => {
  const mock = await readFile(new URL("./telegram-mock.js", import.meta.url), "utf8");
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: mock }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
});
test("a pinned concordance page retries without losing preceding results", async ({ page }) => {
  const entry = await fixture("strongs/G3056.json");
  const remaining = entry.occurrences.slice(1), revision = "a".repeat(64);
  let fail = true;
  await page.route(`${origin}/**`, async r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: await fixture("kjv/books.json") });
    if (path === "/api/strongs/G3056.json") return r.fulfill({ json: { ...entry, verses: entry.occurrences.length, occurrences: entry.occurrences.slice(0, 1), occurrencePages: { revision, pageSize: 1, pages: 2, nextPage: 1 } } });
    if (path === `/api/strongs/G3056/occurrences/${revision}/1.json`) return fail ? r.fulfill({ status: 503, body: "Unavailable" }) : r.fulfill({ json: { number: "G3056", revision, page: 1, total: entry.occurrences.length, occurrences: remaining, nextPage: null } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto("/lexicon/G3056");
  await expect(page.getByRole("heading", { name: `Every verse (first 1 of ${entry.occurrences.length})`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more verses", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry loading verses", exact: true })).toBeVisible();
  await expect(page.locator(".bs-word__book").first()).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry loading verses", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Every verse", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more verses", exact: true })).toHaveCount(0);
});
