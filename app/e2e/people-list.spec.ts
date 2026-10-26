import { expect, test, type Page } from "@playwright/test";

// People as Bible Strong's CommentaryLibraryScreen: the filter button (its FiltersHeader) with the
// order, the search field, a CommentaryLibraryItem per person, drawn as the list's end comes into view.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const person = (id: string, name: string, verses: number, description = "", names = [name]) => ({ id, name, names, description, verses, first: "Genesis 1:1", type: "man" });
const PEOPLE = [
  person("abel", "Abel", 12),
  person("moses", "Moses", 800, "Prophet and lawgiver"),
  person("aaron", "Aaron", 340, "", ["Aaron", "Aharon"]),
];

async function setup(page: Page, { people = PEOPLE as unknown[], fail = false } = {}) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/people/index.json") return fail ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ json: people });
    return r.fulfill({ status: 404, body: "" });
  });
}
const names = (page: Page) => page.locator(".personrow__name");

test("everyone named, the most spoken of first, as Bible Strong's library rows: the avatar, the name over who they were, how often named", async ({ page }) => {
  await setup(page);
  await page.goto("/people");
  await expect(page.locator(".head h1")).toHaveText("People");
  await expect(names(page)).toHaveText(["Moses", "Aaron", "Abel"]);
  await expect(page.locator(".personrow__sub")).toHaveText(["Prophet and lawgiver", "Aharon", "Genesis 1:1"]);
  await expect(page.locator(".personrow__count")).toHaveText(["800 verses", "340 verses", "12 verses"]);
  const row = await page.locator(".personrow").first().evaluate((el) => { const s = getComputedStyle(el); const a = el.querySelector(".avatar")!.getBoundingClientRect(); return [el.getBoundingClientRect().height >= 78, s.paddingTop, s.paddingLeft, a.width]; });
  expect(row).toEqual([true, "11px", "18px", 48]);
  await page.locator(".personrow", { hasText: "Aaron" }).click();
  await expect(page).toHaveURL(/\/person\/aaron$/);
});

test("the filter panel orders A to Z, and Reset puts the most spoken of first again; a search shows its count on the grey band", async ({ page }) => {
  await setup(page);
  await page.goto("/people");
  await page.locator(".head .bs-filter").click();
  await expect(page.locator(".panel-filter .panel-filter__label")).toHaveText(["Order"]);
  await page.locator(".panel-filter", { hasText: "Order" }).click();
  await page.getByRole("radio", { name: "A to Z" }).click();
  await expect(names(page)).toHaveText(["Aaron", "Abel", "Moses"]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(names(page)).toHaveText(["Moses", "Aaron", "Abel"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.fill("#people-q", "aharon");
  await expect(page.getByRole("heading", { name: "1 person", exact: true })).toBeVisible();
  await expect(names(page)).toHaveText(["Aaron"]);
  const band = await page.locator(".people__band").evaluate((el) => { const s = getComputedStyle(el); return [s.position, s.fontSize, s.fontWeight, s.paddingTop, s.paddingLeft]; });
  expect(band).toEqual(["sticky", "13px", "700", "11px", "20px"]);
  await page.fill("#people-q", "zz");
  await expect(page.getByText("No one called “zz”")).toBeVisible();
});

test("a long list draws sixty people, then sixty more as its end comes into view", async ({ page }) => {
  await setup(page, { people: Array.from({ length: 130 }, (_, i) => person(`p${i}`, `Person ${i}`, 200 - i)) });
  await page.goto("/people");
  await expect(names(page)).toHaveCount(60);
  await page.locator(".list-more").scrollIntoViewIfNeeded();
  await expect(names(page)).toHaveCount(120);
});

test("people that do not load offer Retry", async ({ page }) => {
  await setup(page, { fail: true });
  await page.goto("/people");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
