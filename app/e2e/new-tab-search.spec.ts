import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's New Tab cards open the Search sheet for their kind (NewTabItem → useLaunchSearch →
// GlobalCommandPalette → SearchSelectionSheet), and the tab becomes what is picked.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const LAUNCH = "#tgWebAppData=query_id%3Dnew-tab-search&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const BOOKS = [
  { book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis", chapterIds: Array.from({ length: 50 }, (_, i) => i + 1) },
  { book: "Exodus", slug: "exodus", chapters: 40, verses: 1213, testament: "Old Testament", url: "/bible/exodus", chapterIds: Array.from({ length: 40 }, (_, i) => i + 1) },
];

async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "default-group", groups: [{ id: "default-group", name: "", color: "", isDefault: true, current: "n", tabs: [{ id: "b", path: "/read/exodus/2" }, { id: "n", path: "/new" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: BOOKS });
    if (path === "/api/strongs/index.json") return r.fulfill({ json: [
      { n: "H1", lemma: "אָב", xlit: "ʼâb", def: "father", count: 1215 },
      { n: "G26", lemma: "ἀγάπη", xlit: "agápē", def: "love, i.e. affection or benevolence", count: 116 },
      { n: "G25", lemma: "ἀγαπάω", xlit: "agapáō", def: "to love (in a social or moral sense)", count: 142 },
      { n: "H6", lemma: "אָבַד", xlit: "ʼâbad", def: "abandon, destroy", count: 184 },
    ] });
    if (path === "/api/topics/index.json") return r.fulfill({ json: [
      { slug: "abraham", label: "Abraham", notes: 3, cases: 0, url: "/topics/abraham" },
      { slug: "babylon", label: "Babylon", notes: 4, cases: 0, url: "/topics/babylon" },
    ] });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/dictionary?*", r => r.fulfill({ json: { count: 2, page: 1, pages: 1, rows: [{ slug: "aaron", term: "Aaron" }, { slug: "abel", term: "Abel" }], related: [], total: 2 } }));
  await page.goto(`/new${LAUNCH}`);
  await expect(page.locator(".nt-heading")).toBeVisible();
}
const tabs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups") ?? "{}").groups[0].tabs.map((t: { id: string; path: string }) => `${t.id}:${t.path}`));
const sheet = (page: Page) => page.getByRole("dialog", { name: "Search", exact: true });

test("the Bible card opens Search on the books; a chapter turns this tab into it", async ({ page }) => {
  await setup(page);
  await page.locator(".ntcard--hero").click();
  await expect(sheet(page)).toBeVisible();
  const field = sheet(page).getByRole("textbox", { name: "A passage, for example Gen 1:2-5…" });
  await expect(field).toBeFocused();
  await sheet(page).getByRole("button", { name: "Genesis" }).click();
  await expect(sheet(page).getByRole("button", { name: "Books" })).toContainText("Genesis");
  await sheet(page).getByRole("button", { name: "Genesis, Chapter 3", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/3$/);
  await expect.poll(() => tabs(page)).toEqual(["b:/read/exodus/2", "n:/read/genesis/3"]);
});

test("a reference typed is offered first, and opens at its verses", async ({ page }) => {
  await setup(page);
  await page.locator(".ntcard--hero").click();
  await sheet(page).getByRole("textbox").fill("gen 1:2-5");
  await expect(sheet(page).locator(".spick__head")).toContainText("Passages");
  await sheet(page).locator(".spick__main").first().click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2-5$/);
});

test("closing Search leaves the New Tab as it was", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Studies", exact: true }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("textbox", { name: "Search in studies" })).toBeVisible();
  await expect(sheet(page)).toContainText("No item found in studies");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/new/);
  expect(await tabs(page)).toEqual(["b:/read/exodus/2", "n:/new"]);
});

test("Strong browses by letter with the alphabet; a code typed finds the word and the tab becomes it", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Strong", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "Search a Strong code" })).toBeVisible();
  await expect(sheet(page).getByRole("radiogroup", { name: "Letters" })).toBeVisible();
  await expect(sheet(page).locator(".spick__title b")).toHaveText(["abandon"]);
  await sheet(page).getByRole("textbox").fill("G26");
  await expect(sheet(page).getByRole("radiogroup", { name: "Letters" })).toHaveCount(0);
  await expect(sheet(page).locator(".spick__title")).toHaveText(["loveG26"]);
  await sheet(page).getByRole("button", { name: "love", exact: true }).click();
  await expect(page).toHaveURL(/\/lexicon\/G26$/);
  await expect.poll(() => tabs(page)).toEqual(["b:/read/exodus/2", "n:/lexicon/G26"]);
});

test("Topics and the dictionary list their letter in their colour", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Topics", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "Search in Nave" })).toBeVisible();
  await expect(sheet(page).locator(".spick__title b")).toHaveText(["Abraham"]);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Dictionary", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "Search in dictionary" })).toBeVisible();
  await expect(sheet(page).locator(".spick__title b")).toHaveText(["Aaron", "Abel"]);
  await sheet(page).getByRole("button", { name: "Abel", exact: true }).click();
  await expect(page).toHaveURL(/\/dictionary\/abel$/);
});

test("the timeline lists its periods; a card Bible Strong does not search opens its page", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(sheet(page).getByRole("textbox", { name: "Search in Timeline…" })).toBeVisible();
  await expect(sheet(page).locator(".spick__head")).toContainText("Timeline");
  await expect(sheet(page).locator(".spick__row").first()).toContainText("Period");
  await page.keyboard.press("Escape");
  await page.locator(".ntcard", { hasText: "Every Sabbath class" }).click();
  await expect(page).toHaveURL(/\/classes$/);
});

test("the Notes card never says there are none while the notes are read", async ({ page }) => {
  // In the browser, outside Telegram: the notes are this browser's.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "3": { id: "n1", title: "Light was the first", description: "", date: 3000 } }));
    new MutationObserver(() => { if (document.body?.textContent?.includes("No item found in notes")) (window as unknown as { __empty: boolean }).__empty = true; })
      .observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto("/new");
  await page.getByRole("button", { name: "Kept", exact: true }).click();
  await expect(sheet(page)).toContainText("Light was the first");
  expect(await page.evaluate(() => !!(window as unknown as { __empty?: boolean }).__empty)).toBe(false);
});
