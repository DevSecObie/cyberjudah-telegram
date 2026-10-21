import { expect, test, type Page } from "@playwright/test";

// The case studies as Bible Strong's CommentaryLibraryScreen: the filter button (its FiltersHeader)
// with the kind and the era, the search field, a grey band per era, a row per case.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const INDEX = {
  eras: ["Primeval", "Patriarchal", "Egypt"],
  verdicts: {},
  cases: [
    { slug: "adam-and-eve", name: "Adam and Eve", era: "Primeval", kind: "judgment", charge: "Eating the fruit of lies", verdict: "curse", url: "/cases/01-primeval/adam-and-eve", code: "C001" },
    { slug: "cain", name: "Cain", era: "Primeval", kind: "judgment", charge: "Shedding his brother’s blood", verdict: "exile", url: "/cases/01-primeval/cain", code: "C002" },
    { slug: "abraham", name: "Abraham", era: "Patriarchal", kind: "blessing", charge: "Obeying the Lord’s voice", verdict: "blessed", url: "/cases/02-patriarchal/abraham", code: "C011" },
  ],
};

async function setup(page: Page, { fail = false } = {}) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/cases/index.json") return fail ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ json: INDEX });
    return r.fulfill({ status: 404, body: "" });
  });
}
const names = (page: Page) => page.locator(".caserow__name");
const filter = (page: Page) => page.locator(".head .bs-filter");
const choose = async (page: Page, row: string, choice: string) => {
  await filter(page).click();
  await page.locator(".panel-filter", { hasText: row }).click();
  await page.getByRole("radio", { name: choice }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
};

test("the case studies are Bible Strong's library: an era's grey band, then its cases, the name over the charge", async ({ page }) => {
  await setup(page);
  await page.goto("/cases");
  await expect(page.locator(".head h1")).toHaveText("Case studies");
  await expect(page.locator(".cases__era")).toHaveText(["Primeval", "Patriarchal"]);
  await expect(names(page)).toHaveText(["Adam and Eve", "Cain", "Abraham"]);
  await expect(page.getByRole("region", { name: "Primeval" }).locator(".caserow__charge").first()).toHaveText("Eating the fruit of lies");
  const band = await page.locator(".cases__era").first().evaluate((el) => { const s = getComputedStyle(el); return [s.position, s.fontSize, s.fontWeight, s.paddingTop, s.paddingLeft]; });
  expect(band).toEqual(["sticky", "13px", "700", "11px", "20px"]);
  const row = await page.locator(".caserow").first().evaluate((el) => { const s = getComputedStyle(el); return [el.getBoundingClientRect().height >= 78, s.paddingTop, s.paddingLeft]; });
  expect(row).toEqual([true, "11px", "18px"]);
  await page.locator(".caserow", { hasText: "Abraham" }).click();
  await expect(page).toHaveURL(/\/cases\/02-patriarchal\/abraham$/);
});

test("the filter button opens Bible Strong's Filters: the kind and the era narrow the list, Reset clears them", async ({ page }) => {
  await setup(page);
  await page.goto("/cases");
  await expect(names(page)).toHaveCount(3);
  await filter(page).click();
  await expect(page.locator(".panel-filter")).toHaveText(["KindAll", "EraEvery era"]);
  await page.locator(".panel-filter", { hasText: "Kind" }).click();
  await expect(page.getByRole("radio")).toHaveText(["All (3)", "Judgments (2)", "Blessings (1)"]);
  await page.getByRole("radio", { name: "Blessings (1)" }).click();
  await expect(names(page)).toHaveText(["Abraham"]);
  await expect(page).toHaveURL(/\/cases\?kind=blessing$/);
  await expect(filter(page)).toHaveAttribute("aria-label", "1 filter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await choose(page, "Kind", "All (3)");
  await choose(page, "Era", "Primeval");
  await expect(names(page)).toHaveText(["Adam and Eve", "Cain"]);
  await expect(page.locator(".cases__era")).toHaveText(["Primeval"]);
  await filter(page).click();
  await page.locator(".panel-reset").click();
  await expect(names(page)).toHaveCount(3);
  await expect(page).toHaveURL(/\/cases$/);
});

test("the search narrows by name, charge or verdict, and nothing found says so", async ({ page }) => {
  await setup(page);
  await page.goto("/cases");
  await page.fill("#case-q", "blood");
  await expect(names(page)).toHaveText(["Cain"]);
  await page.fill("#case-q", "nobody");
  await expect(page.getByText("No case found...")).toBeVisible();
});

test("a list that fails to load offers Retry, and loads on Retry", async ({ page }) => {
  await setup(page, { fail: true });
  await page.goto("/cases");
  await expect(page.getByText("The case studies did not load")).toBeVisible();
  await page.unroute(`${DATA}/**`);
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/cases/index.json" ? r.fulfill({ json: INDEX }) : r.fulfill({ status: 404, body: "" }));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(names(page)).toHaveCount(3);
});
