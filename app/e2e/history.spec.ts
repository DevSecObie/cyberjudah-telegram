import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Bible Strong's HistoryScreen: a row per item viewed, newest first, its title in bold and its
// chip over how long ago; the trash button clears it all after asking.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const fixture = async (path: string) => JSON.parse(await readFile(new URL(`../../bot/tests/fixtures/bs/api/${path}`, import.meta.url), "utf8"));
async function setup(page: Page, rows: Record<string, unknown>[]) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((r) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("cj:hist", JSON.stringify(r.map(({ ago, ...x }) => ({ ...x, at: Date.now() - (ago as number) })))); } }, rows);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, async r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: await fixture("kjv/books.json") });
    if (path === "/api/kjv/genesis/1.json") return r.fulfill({ json: await fixture("kjv/genesis/1.json") });
    const number = path.match(/^\/api\/strongs\/([HG]\d+)\.json$/)?.[1];
    if (number) return r.fulfill({ json: { ...(await fixture("strongs/G3056.json")), number } });
    return r.fulfill({ status: 404, body: "" });
  });
}
const HOUR = 3_600_000;
const history = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:hist") || "[]"));

test("a row per passage, newest first: the reference and version in bold, the Verse chip over how long ago", async ({ page }) => {
  await setup(page, [{ slug: "john", chapter: 3, verse: 16, name: "John 3", ago: 2 * 60_000 }, { slug: "genesis", chapter: 1, name: "Genesis 1", ago: 3 * HOUR }]);
  await page.goto("/history");
  await expect(page.locator(".head h1")).toHaveText("Recently viewed");
  await expect(page.locator(".histitem__title")).toHaveText(["John 3:16 KJV", "Genesis 1 KJV"]);
  await expect(page.locator(".histitem__chip")).toHaveText(["Verse", "Verse"]);
  await expect(page.locator(".histitem__ago")).toHaveText(["2 minutes ago", "about 3 hours ago"]);
  const row = await page.locator(".histitem").first().evaluate((el) => { const s = getComputedStyle(el); const c = getComputedStyle(el.querySelector(".histitem__chip")!); return [s.paddingTop, s.paddingLeft, c.height, c.borderRadius, c.fontSize]; });
  expect(row).toEqual(["20px", "20px", "15px", "7px", "8px"]);
  await page.locator(".histitem", { hasText: "John 3:16" }).click();
  await expect(page).toHaveURL(/\/read\/john\/3\?at=16$/);
});

test("the trash button clears the history after asking; empty, it says so and the button goes", async ({ page }) => {
  await setup(page, [{ slug: "genesis", chapter: 1, name: "Genesis 1", ago: HOUR }]);
  await page.goto("/history");
  let asked = "";
  page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await page.getByRole("button", { name: "Clear history", exact: true }).click();
  await expect.poll(() => asked).toBe("Clear history?\n\nRecently viewed items will be removed from this device (1).");
  await expect(page.locator(".histitem")).toHaveCount(1);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Clear history", exact: true }).click();
  await expect(page.getByText("No recently viewed content.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear history", exact: true })).toHaveCount(0);
  expect(await history(page)).toEqual([]);
});

test("a loaded Strong is recorded once per visit and revisiting moves it above Bible entries", async ({ page }) => {
  await setup(page, [{ slug: "genesis", chapter: 1, verse: 2, name: "Genesis 1", ago: 300_000 }, { slug: "john", chapter: 3, verse: 16, name: "John 3", ago: HOUR }]);
  await page.goto("/lexicon/G3056");
  await expect(page.locator(".bs-word__lemma")).toBeVisible();
  await expect.poll(async () => (await history(page))[0]?.reference).toBe("G3056");
  await page.reload();
  await expect(page.locator(".bs-word__lemma")).toBeVisible();
  await expect.poll(async () => (await history(page)).length).toBe(3);
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  await expect.poll(async () => (await history(page))[0]?.type).toBe("bible");
  await page.goto("/lexicon/G3056");
  await expect.poll(async () => (await history(page))[0]?.reference).toBe("G3056");
  await page.goto("/history");
  await expect(page.locator(".histitem").first().locator(".histitem__chip")).toHaveText("Strong");
  await page.locator(".histitem", { hasText: "Genesis 1:2 KJV" }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?at=2$/);
});

test("dictionary and topic rows have Bible Strong's Word and Nave chips and their own destinations", async ({ page }) => {
  await setup(page, [
    { type: "topic", slug: "faith", name: "Faith", ago: 10_000 },
    { type: "dictionary", slug: "abraham", name: "Abraham", dictionaryTitle: "Easton's Bible Dictionary", ago: 30_000 },
    { slug: "genesis", chapter: 1, name: "Genesis 1", ago: 60_000 },
  ]);
  await page.goto("/history");
  await expect(page.locator(".histitem__chip")).toHaveText(["Nave", "Word", "Verse"]);
  await expect(page.locator(".histitem").nth(0)).toHaveAttribute("href", "/topics/faith");
  await expect(page.locator(".histitem").nth(1)).toHaveAttribute("href", "/dictionary/abraham");
  await expect(page.locator(".histitem").nth(1).locator(".histitem__sub")).toHaveText("Easton's Bible Dictionary");
  await expect(page.locator(".histitem").nth(2)).toHaveAttribute("href", "/read/genesis/1");
});
