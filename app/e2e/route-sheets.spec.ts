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
  const max = 844 - 8;
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(.45 * max));
  // The list is still there behind, not dimmed.
  await expect(page.locator(".bs-scrim--clear")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Abel", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/dictionary\?q=a$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
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
  await page.goto("/lexicon");
  await page.locator('a[href="/lexicon/H1"]').first().click();
  await expect(page).toHaveURL(/\/lexicon\/H1$/);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveClass(/bs-sheet--full/);
  await expect(page.locator(".bs-scrim--clear")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/lexicon$/);
});
