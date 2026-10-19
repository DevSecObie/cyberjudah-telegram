import { expect, test, type Page } from "@playwright/test";

// Bible Strong's DictionaryListScreen and LexiqueListScreen: the list opens on A, filed under the
// letter's disc, with the alphabet along the bottom; a search replaces the alphabet.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/strongs/index.json"
    ? r.fulfill({ json: [
      { n: "H1", lemma: "אָב", xlit: "ʼâb", def: "father", count: 1215 },
      { n: "H157", lemma: "אָהַב", xlit: "ʼâhab", def: "to have affection for (sexually or otherwise)", count: 211 },
      { n: "G25", lemma: "ἀγαπάω", xlit: "agapáō", def: "to love (in a social or moral sense)", count: 142 },
      { n: "G26", lemma: "ἀγάπη", xlit: "agápē", def: "love, i.e. affection or benevolence", count: 116 },
      { n: "H6", lemma: "אָבַד", xlit: "ʼâbad", def: "abandon, destroy", count: 184 },
    ] })
    : r.fulfill({ status: 404, body: "" }));
}

test("the dictionary opens on A with the letters along the bottom, and a letter brings its words", async ({ page }) => {
  await setup(page);
  const letters: string[] = [];
  await page.route("**/api/dictionary?*", r => {
    const letter = new URL(r.request().url()).searchParams.get("letter") ?? "";
    letters.push(letter);
    const rows = letter === "B" ? [{ slug: "baal", term: "Baal" }] : [{ slug: "aaron", term: "Aaron" }, { slug: "abel", term: "Abel" }];
    return r.fulfill({ json: { count: rows.length, page: 1, pages: 1, rows, related: [], total: 3963 } });
  });
  await page.goto("/dictionary");
  await expect(page.getByRole("link", { name: "Aaron", exact: true })).toBeVisible();
  expect(letters[0]).toBe("A");
  await expect(page.locator(".bs-section").first()).toHaveText("A");
  const row = await page.getByRole("link", { name: "Aaron", exact: true }).boundingBox();
  expect(Math.round(row!.height)).toBe(60);
  const strip = page.getByRole("radiogroup", { name: "Letters" });
  await expect(strip.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
  await strip.getByRole("radio", { name: "B" }).click();
  await expect(page.getByRole("link", { name: "Baal", exact: true })).toBeVisible();
  await expect(strip.getByRole("radio", { name: "B" })).toHaveAttribute("aria-checked", "true");
  // A search replaces the letters.
  await page.fill("#dict-q", "aar");
  await expect(strip).toHaveCount(0);
});

test("the lexicon files every word by its meaning, opens on A, and filters by language", async ({ page }) => {
  await setup(page);
  await page.goto("/lexicon");
  // Filed by the meaning's first word, as Bible Strong files by gloss: A holds "abandon", not "father".
  const abandon = page.locator("a[href='/lexicon/H6']");
  await expect(abandon).toContainText("Hebrew");
  await expect(abandon).toContainText("H6");
  await expect(abandon).toContainText("abandon");
  expect(Math.round((await abandon.boundingBox())!.height)).toBe(80);
  await expect(page.locator("a[href='/lexicon/H1']")).toHaveCount(0);
  await page.getByRole("radiogroup", { name: "Letters" }).getByRole("radio", { name: "L" }).click();
  await expect(page.locator("a[href='/lexicon/G26']")).toContainText("love");
  await expect(page.locator("a[href='/lexicon/G25']")).toContainText("love");
  // The filter: Hebrew only.
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: /Lexicon/ }).click();
  await page.getByRole("button", { name: "Hebrew", exact: true }).click();
  await expect(page.locator("a[href='/lexicon/G26']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1 filter", exact: true })).toBeVisible();
  // A typed number is found whatever the filter.
  await page.fill("#lex-q", "G26");
  await expect(page.locator("a[href='/lexicon/G26']")).toBeVisible();
});

test("a letter with few words keeps the alphabet at the bottom of the screen, above the bar", async ({ page }) => {
  await setup(page);
  await page.route("**/api/dictionary?*", r => r.fulfill({ json: { count: 1, page: 1, pages: 1, rows: [{ slug: "aaron", term: "Aaron" }], related: [], total: 3963 } }));
  await page.goto("/dictionary");
  await expect(page.getByRole("link", { name: "Aaron", exact: true })).toBeVisible();
  const strip = (await page.locator(".bs-alpha").boundingBox())!;
  const bar = (await page.getByRole("navigation", { name: "Sections" }).boundingBox())!;
  expect(Math.abs(strip.y + strip.height - bar.y)).toBeLessThanOrEqual(1);
});

