import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * The Bible Timeline at 390×844: Bible Strong's periods, canvas, date bar, line and year,
 * search and event pages, with our case studies and Who's Who reigns, and none of their
 * prophetic teaching. Set REVIEW_SHOTS=1 to write screenshots to e2e/review/timeline.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
test.use({ viewport: { width: 390, height: 844 } });

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/timeline/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/timeline/${name}.png`, import.meta.url).pathname });
};
test.beforeEach(async ({ page }) => {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
});

test("the periods, as Bible Strong lists them, without their prophecy period", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByRole("heading", { name: "The Bible Timeline" })).toBeVisible();
  const items = page.locator(".tl-item");
  await expect(items).toHaveCount(12);
  await expect(items.first()).toContainText("Age of Patriarchs");
  await expect(items.first()).toContainText("First Generation");
  await expect(items.first()).toContainText("Creation–c.2500 BC");
  await expect(page.getByText("Revelation Prophecies")).toHaveCount(0);
  await shot(page, "1-periods");
});

test("a period: events by year on the canvas, the date bar, and the year under the line as it scrolls", async ({ page }) => {
  await page.goto("/timeline/0");
  await expect(page.getByRole("heading", { name: "First Generation" })).toBeVisible();
  const year = page.locator(".tl-current__year");
  await expect(year).toHaveText("3944 BC"); // the line at 40% of 390px is 156px = 156 years at 100px a century
  await expect(page.locator(".tl-datebar span").first()).toHaveText("4100");
  // An event with a case study opens; one without stays greyed and does not.
  await expect(page.locator("a.tl-major", { hasText: "Cain" })).toBeVisible();
  await expect(page.locator(".tl-major[data-off], .tl-minor[data-off]").first()).toBeVisible();
  await shot(page, "2-period");
  await page.locator(".tl-scroll").evaluate((el) => { el.scrollLeft += 500; el.dispatchEvent(new Event("scroll")); });
  await expect(year).toHaveText("3444 BC");
  // The chevron opens the next period.
  await page.getByRole("button", { name: "Next period: Noah & The Flood" }).last().click();
  await expect(page).toHaveURL(/\/timeline\/1$/);
  await expect(page.getByRole("heading", { name: "Noah & The Flood" })).toBeVisible();
});

test("an event opens to its date, our case study and its verses in the KJV", async ({ page }) => {
  await page.goto("/timeline/0");
  await page.locator("a.tl-major", { hasText: "Cain" }).click();
  await expect(page).toHaveURL(/\/timeline\/event\/cain$/);
  await expect(page.locator(".tl-event__title")).toHaveText("Cain");
  await expect(page.locator(".tl-event__date")).toHaveText("3900-3200 BC (700)");
  const cases = page.getByRole("region", { name: "Case studies" });
  await expect(cases.getByRole("link", { name: /Cain/ })).toBeVisible();
  const verses = page.getByRole("region", { name: "Verses" });
  await expect(verses.locator(".tl-verse").first()).toContainText(/Genesis 4/);
  await shot(page, "3-event");
  await verses.locator(".tl-verse").first().click();
  await expect(page).toHaveURL(/\/read\/genesis\/4/);
});

test("search finds the two kings Ahaziah, each with the reign Who's Who gives and the right case study", async ({ page }) => {
  await page.goto("/timeline/search");
  await page.getByRole("searchbox").fill("ahaziah");
  const rows = page.locator(".tl-search__list a");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".tl-search__count")).toHaveText("2 events found");
  await shot(page, "4-search");
  await rows.filter({ hasText: "853–852 BC, Israel" }).click();
  await expect(page.getByRole("region", { name: "Reign" })).toContainText("853–852 BC, Israel");
  await expect(page.getByRole("region", { name: "Reign" })).toContainText("Who's Who in the Bible");
  await expect(page.getByRole("region", { name: "Case studies" })).toContainText("Ahaziah of Israel");
  await expect(page.getByRole("region", { name: "Case studies" })).not.toContainText("Ahaziah of Judah");
});

test("their prophetic interpretation is not on the timeline", async ({ page }) => {
  await page.goto("/timeline/7"); // The Exile, where their 2300-day and Daniel prophecies stood
  await expect(page.getByRole("heading", { name: "The Exile" })).toBeVisible();
  for (const t of ["2300 Day Prophecy", "The Seventy-Weeks Prophecy", "Daniel's Rome Prophecies"]) await expect(page.getByText(t, { exact: true })).toHaveCount(0);
  await page.goto("/timeline/search");
  await page.getByRole("searchbox").fill("prophecy");
  await expect(page.locator(".tl-search__list a")).toHaveCount(0);
});

test("the details panel says where the years come from, and More lists the timeline", async ({ page }) => {
  await page.goto("/timeline");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Details" });
  await expect(panel).toContainText("Bible Strong's Bible Timeline");
  await expect(panel).toContainText("Who's Who in the Bible");
  await shot(page, "5-details");
  await page.keyboard.press("Escape");
  await page.goto("/more");
  await page.getByRole("link", { name: /Bible timeline/ }).first().click();
  await expect(page).toHaveURL(/\/timeline$/);
});

test("a deep link opens a period", async ({ page }) => {
  await page.goto("/?tgWebAppStartParam=timeline_2");
  await expect(page).toHaveURL(/\/timeline\/2$/);
  await expect(page.getByRole("heading", { name: "The Patriarchs" })).toBeVisible();
});
