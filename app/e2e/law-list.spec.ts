import { expect, test, type Page } from "@playwright/test";

// The handbook of Bible law as Bible Strong's CommentaryLibraryScreen: the filter button (its
// FiltersHeader) with the part, the search field, a grey band per part, a row per section.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const INDEX = [
  { n: 1, title: "The Ten Commandments", url: "/law/01-the-ten-commandments", sections: [{ id: "1A", title: "Ten Commandments", laws: 10, url: "/law/01-the-ten-commandments/1a" }] },
  { n: 2, title: "Relationship to God", url: "/law/02-relationship-to-god", sections: [
    { id: "2A", title: "Idolatry", laws: 21, url: "/law/02-relationship-to-god/2a" },
    { id: "2H", title: "Obedience and Submission", laws: 1, url: "/law/02-relationship-to-god/2h" },
  ] },
];
const TEXTS = [
  { id: "1A.1", text: "I am the LORD your God, you shall have no other gods besides me.", url: "/law/01-the-ten-commandments/1a#1A.1" },
  { id: "2A.3", text: "You shall not make for yourself any graven image to bow down to it.", url: "/law/02-relationship-to-god/2a#2A.3" },
];

async function setup(page: Page, { fail = false } = {}) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/laws/index.json") return fail ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ json: INDEX });
    if (path === "/search/laws.json") return r.fulfill({ json: TEXTS });
    return r.fulfill({ status: 404, body: "" });
  });
}
const titles = (page: Page) => page.locator(".laws__part .lawlink__title");

test("the handbook is Bible Strong's library: a part's grey band, then its sections, the name over the code and the count", async ({ page }) => {
  await setup(page);
  await page.goto("/law");
  await expect(page.locator(".head h1")).toHaveText("The Law");
  await expect(page.locator(".laws__band")).toHaveText(["1. The Ten Commandments", "2. Relationship to God"]);
  await expect(titles(page)).toHaveText(["Ten Commandments", "Idolatry", "Obedience and Submission"]);
  await expect(page.locator(".laws__part .lawlink__meta")).toHaveText(["1A · 10 laws", "2A · 21 laws", "2H · 1 law"]);
  const band = await page.locator(".laws__band").first().evaluate((el) => { const s = getComputedStyle(el); return [s.position, s.fontSize, s.fontWeight, s.paddingTop, s.paddingLeft]; });
  expect(band).toEqual(["sticky", "13px", "700", "11px", "20px"]);
  const row = await page.locator(".laws__part .lawlink").first().evaluate((el) => { const s = getComputedStyle(el); return [el.getBoundingClientRect().height >= 78, s.paddingTop, s.paddingLeft]; });
  expect(row).toEqual([true, "11px", "18px"]);
});

test("the filter button opens Bible Strong's Filters with the part; Reset puts every part back", async ({ page }) => {
  await setup(page);
  await page.goto("/law");
  await page.locator(".head .bs-filter").click();
  await expect(page.locator(".panel-filter")).toHaveText(["PartEvery part"]);
  await page.locator(".panel-filter", { hasText: "Part" }).click();
  await expect(page.getByRole("radio")).toHaveText(["Every part", "1. The Ten Commandments", "2. Relationship to God"]);
  await page.getByRole("radio", { name: "2. Relationship to God" }).click();
  await expect(page.locator(".laws__band")).toHaveText(["2. Relationship to God"]);
  await expect(page.locator(".head .bs-filter")).toHaveAttribute("aria-label", "1 filter");
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".laws__band")).toHaveCount(2);
});

test("a search finds sections by name and laws by their words; nothing found says so", async ({ page }) => {
  await setup(page);
  await page.goto("/law");
  await page.fill("#law-q", "image");
  const hits = page.getByRole("region", { name: "Laws that say this" });
  await expect(hits.locator(".laws__band")).toHaveText("Laws that say “image” · 1");
  await expect(hits.locator(".lawlink__title")).toHaveText(["You shall not make for yourself any graven image to bow down to it."]);
  await expect(hits.locator(".lawlink__meta")).toHaveText(["2A.3 · Idolatry"]);
  await page.fill("#law-q", "obedience");
  await expect(titles(page)).toHaveText(["Obedience and Submission"]);
  await page.fill("#law-q", "zz");
  await expect(page.getByText("No law found...")).toBeVisible();
});

test("a handbook that fails to load offers Retry, and loads on Retry", async ({ page }) => {
  await setup(page, { fail: true });
  await page.goto("/law");
  await expect(page.getByText("The law did not load")).toBeVisible();
  await page.unroute(`${DATA}/**`);
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/laws/index.json" ? r.fulfill({ json: INDEX }) : r.fulfill({ status: 404, body: "" }));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(titles(page)).toHaveCount(3);
});
