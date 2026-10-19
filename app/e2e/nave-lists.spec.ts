import { expect, test, type Page } from "@playwright/test";

// Bible Strong's NaveListScreen, which the topics and the precepts follow: one letter at a time,
// filed under its disc, the alphabet along the bottom, and a search that replaces the letters.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/topics/index.json") return r.fulfill({ json: [
      { slug: "abraham", label: "Abraham", notes: 3, cases: 0, url: "/topics/abraham" },
      { slug: "adultery", label: "Adultery", notes: 1, cases: 2, url: "/topics/adultery" },
      { slug: "babylon", label: "Babylon", notes: 4, cases: 0, url: "/topics/babylon" },
      { slug: "empty", label: "Angels", notes: 0, cases: 0, url: "/topics/empty" },
      { slug: "verdict-guilty", label: "A verdict", notes: 1, cases: 1, url: "/topics/verdict-guilty" },
    ] });
    if (path === "/api/precepts/index.json") return r.fulfill({ json: Array.from({ length: 320 }, (_, i) => ({ slug: `p${i}`, title: `${i < 310 ? "Sabbath" : "Zion"} ${i}`, refs: 3, url: `/precepts/p${i}` })) });
    return r.fulfill({ status: 404, body: "" });
  });
}

test("topics open on A under its disc, with the letters along the bottom; a letter or a search changes the list", async ({ page }) => {
  await setup(page);
  await page.goto("/topics");
  await expect(page.getByRole("link", { name: "Abraham", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Adultery", exact: true })).toBeVisible();
  // Topics with nothing in them, and verdicts, are not listed.
  await expect(page.getByRole("link", { name: "Angels", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "A verdict", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Babylon", exact: true })).toHaveCount(0);
  await expect(page.locator(".bs-section").first()).toHaveText("A");
  expect(Math.round((await page.getByRole("link", { name: "Abraham", exact: true }).boundingBox())!.height)).toBe(60);
  const strip = page.getByRole("radiogroup", { name: "Letters" });
  await strip.getByRole("radio", { name: "B" }).click();
  await expect(page.getByRole("link", { name: "Babylon", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/letter=b/);
  await page.getByRole("searchbox", { name: "Search by word" }).fill("dult");
  await expect(page.getByRole("link", { name: "Adultery", exact: true })).toBeVisible();
  await expect(strip).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search by word" }).fill("zzz");
  await expect(page.getByText("No word found...")).toBeVisible();
});

test("precepts list every precept of a letter, with no cap", async ({ page }) => {
  await setup(page);
  await page.goto("/precepts?letter=s");
  await expect(page.locator(".bs-dictitem")).toHaveCount(310);
  await page.getByRole("radiogroup", { name: "Letters" }).getByRole("radio", { name: "Z" }).click();
  await expect(page.locator(".bs-dictitem")).toHaveCount(10);
});
