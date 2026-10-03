import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * The Bible Timeline at 390×844: Bible Strong's periods, canvas, date bar, line and year,
 * search and event pages, with our case studies and Who's Who reigns, and none of their
 * prophetic teaching. Set REVIEW_SHOTS=1 to write screenshots to e2e/review/timeline.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
// Reduced motion skips the opening of a period (its own test below shows it).
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

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

test("an event opens over the period as a sheet: its date, our case study, and its scripture with Go to verse", async ({ page }) => {
  await page.goto("/timeline/0");
  await page.locator("a.tl-major", { hasText: "Cain" }).click();
  // Not a new page: the event is a parameter of the period, and the canvas is still there under it.
  await expect(page).toHaveURL(/\/timeline\/0\?event=cain$/);
  await expect(page.locator(".tl-scroll")).toBeVisible();
  const sheet = page.getByRole("dialog", { name: /^Cain/ });
  await expect(sheet).toHaveAttribute("aria-modal", "false");
  await expect(sheet.locator(".tl-event__title")).toHaveText("Cain");
  await expect(sheet.locator(".tl-event__date")).toContainText("3900-3200 BC (700)");
  // Bible Strong's form sheet: its header is the title and ⋮, with no ✕ on a phone.
  await expect(sheet.locator(".bs-sheet__formtitle")).toHaveText("Cain");
  await expect(sheet.getByRole("button", { name: "More" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Close" })).toHaveCount(0);
  // Raised by the keyboard: the grabber is a slider (their two detents, 0.45 and full).
  const grabber = sheet.getByRole("slider", { name: "Sheet height" });
  await expect(grabber).toHaveAttribute("aria-valuetext", "Peek");
  await expect(grabber).toHaveAttribute("aria-valuemax", "2");
  await grabber.focus();
  await page.keyboard.press("ArrowUp");
  await expect(grabber).toHaveAttribute("aria-valuetext", "Full");
  await expect(sheet.getByRole("region", { name: "Case studies" }).getByRole("link", { name: /Cain/ })).toBeVisible();
  await expect(sheet.getByRole("region", { name: "Description" })).not.toBeEmpty();
  const verses = sheet.getByRole("region", { name: "Verses" });
  await expect(verses.locator("a.tl-verse").first()).toContainText(/Genesis 4/);
  await shot(page, "3-event");
  // As theirs: the passage itself is the link to the Bible.
  await verses.locator("a.tl-verse").first().click();
  await expect(page).toHaveURL(/\/read\/genesis\/4/);
});

test("one sheet: another event tapped replaces it, a linked event is pushed, and closing walks back to the period", async ({ page }) => {
  await page.goto("/timeline/6");
  const before = await page.evaluate(() => history.length);
  await page.locator('a[data-slug="ahab"]').click();
  await expect(page).toHaveURL(/\?event=ahab$/);
  await expect(page.locator('a[data-slug="ahab"]')).toHaveAttribute("aria-current", "true");
  // Another event on the canvas while the sheet is open: shown in the same sheet, no new history.
  await page.locator('a[data-slug="jehoshaphat"]').click();
  await expect(page).toHaveURL(/\?event=jehoshaphat$/);
  await expect(page.locator(".tl-sheet")).toHaveCount(1);
  await expect(page.locator(".tl-event__title")).toHaveText("Jehoshaphat");
  expect(await page.evaluate(() => history.length)).toBe(before + 1);
  // Escape closes it: back to the period alone, the focus on the event that was shown.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/timeline\/6$/);
  await expect(page.locator(".tl-sheet")).toHaveCount(0);
  await expect(page.locator('a[data-slug="jehoshaphat"]')).toBeFocused();
});

test("an old event link lands on its period with the event's sheet open", async ({ page }) => {
  await page.goto("/timeline/event/solomon");
  await expect(page).toHaveURL(/\/timeline\/5\?event=solomon$/);
  await expect(page.locator(".tl-event__title")).toHaveText("Solomon");
  await expect(page.locator(".tl-event__pic")).toHaveAttribute("src", /people\/solomon-2sa-5-14-256\.webp$/);
});

test("search finds the two kings Ahaziah, each with the reign Who's Who gives and the right case study", async ({ page }) => {
  await page.goto("/timeline/search");
  await page.getByRole("searchbox").fill("ahaziah");
  const rows = page.locator(".tl-search__list a");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Events" }).locator(".srch__count")).toHaveText("2");
  await shot(page, "4-search");
  await rows.filter({ hasText: "853–852 BC, Israel" }).click();
  await expect(page.getByRole("region", { name: "Description" })).toContainText("853–852 BC, Israel");
  await expect(page.getByRole("region", { name: "Description" })).toContainText("Who's Who in the Bible");
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

test.describe("as Bible Strong moves through it", () => {
  test.use({ reducedMotion: "no-preference" });

  test("opening a period shows its title card, then the canvas slides in", async ({ page }) => {
    await page.goto("/timeline");
    await page.locator('a[href$="/timeline/5"]').click();
    const period = page.locator(".tl-period");
    await expect(period).toHaveAttribute("data-phase", "card");
    await expect(page.locator(".tl-behind--current .tl-card__title")).toHaveText("UNITED KINGDOM");
    await expect(period).toHaveAttribute("data-phase", "slide", { timeout: 3000 });
    await expect(period).toHaveAttribute("data-phase", "ready", { timeout: 3000 });
    await expect(page.locator(".tl-behind--current")).toHaveCount(0);
  });

  test("an event's sheet over the period: a verse and back, then closing, leave the canvas exactly where it was", async ({ page }) => {
    await page.goto("/timeline");
    await page.locator('a[href$="/timeline/5"]').click();
    await expect(page.locator(".tl-period")).toHaveAttribute("data-phase", "ready", { timeout: 5000 });
    const scroll = page.locator(".tl-scroll");
    await scroll.evaluate((s) => {
      const e = s.querySelector<HTMLElement>('a[data-slug="solomon"]')!, c = s.querySelector<HTMLElement>(".tl-canvas")!;
      s.scrollTo({ left: c.offsetLeft + e.offsetLeft - innerWidth * 0.4 + 20, top: Math.max(0, e.offsetTop - 220) });
    });
    // Playwright brings an element into view before it clicks: do that first, so the place kept is the place tapped from.
    await page.locator('a[data-slug="solomon"]').scrollIntoViewIfNeeded();
    const at = await scroll.evaluate((s) => [Math.round(s.scrollLeft), Math.round(s.scrollTop)]);
    // The year follows the scroll a frame later: read it once it has settled.
    const yearNow = () => page.locator(".tl-current__year").textContent();
    let year = await yearNow();
    for (let last = ""; last !== year; ) { last = year!; await page.waitForTimeout(150); year = await yearNow(); }
    await page.locator('a[data-slug="solomon"]').click();
    await expect(page).toHaveURL(/\/timeline\/5\?event=solomon$/);
    // Opening it moved nothing.
    expect(await scroll.evaluate((s) => [Math.round(s.scrollLeft), Math.round(s.scrollTop)])).toEqual(at);
    await expect(page.locator(".tl-event__pic")).toHaveAttribute("src", /people\/solomon-2sa-5-14-256\.webp$/);
    await page.getByRole("slider", { name: "Sheet height" }).press("End").catch(() => undefined);
    await page.getByRole("slider", { name: "Sheet height" }).press("ArrowUp");
    await page.locator("a.tl-verse", { hasText: /^1 Kings/ }).first().click();
    await expect(page).toHaveURL(/\/read\/1-kings\//);
    await page.goBack();
    // The period again, the sheet open on Solomon, the canvas where it was.
    await expect(page).toHaveURL(/\/timeline\/5\?event=solomon$/);
    await expect(page.locator(".tl-event__title")).toHaveText("Solomon");
    await expect.poll(() => scroll.evaluate((s) => [Math.round(s.scrollLeft), Math.round(s.scrollTop)])).toEqual(at);
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/timeline\/5$/);
    // No entrance on coming back: the canvas is where it was, the year the same, Solomon focused.
    await expect(page.locator(".tl-period")).toHaveAttribute("data-phase", "ready");
    await expect.poll(() => scroll.evaluate((s) => [Math.round(s.scrollLeft), Math.round(s.scrollTop)])).toEqual(at);
    await expect(page.locator(".tl-current__year")).toHaveText(year!);
    await expect(page.locator('a[data-slug="solomon"]')).toBeFocused();
    await shot(page, "6-restored");
    // Back again: the periods, not every period in between.
    await page.goBack();
    await expect(page).toHaveURL(/\/timeline$/);
  });
});

test("pulling past the start: the line and year go with the canvas, the previous period shows through, and letting go past 100px opens it", async ({ page }) => {
  await page.goto("/timeline/5");
  const scroll = page.locator(".tl-scroll");
  // Within their 100px threshold: the canvas draws away and stays.
  await scroll.evaluate((s) => { s.scrollLeft -= 80; });
  await expect(page.locator(".tl-line")).toHaveAttribute("style", /translateX\(80px\)/);
  await expect.poll(() => page.locator(".tl-behind").first().evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.15);
  await expect(page.locator(".tl-behind").first()).toContainText("THE JUDGES");
  await expect(page).toHaveURL(/\/timeline\/5$/);
  // Past it, letting go opens the period before, at its end.
  await scroll.evaluate((s) => { s.scrollLeft -= 120; s.dispatchEvent(new Event("scrollend")); });
  await expect(page).toHaveURL(/\/timeline\/4\?from=next$/);
});

test("pictures: each period's, a colour where a picture waits on direction, and the approved portrait on an event", async ({ page }) => {
  await page.goto("/timeline");
  const pics = page.locator(".tl-item__pic");
  await expect(pics.nth(0)).toHaveAttribute("src", /timeline\/periods\/1\.webp$/);
  await expect(pics.nth(2)).toHaveClass(/tl-pic--none/); // The Patriarchs: waiting on direction
  await expect.poll(() => pics.nth(0).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(640);
  await page.goto("/timeline/5");
  await expect(page.locator('a[data-slug="solomon"] .tl-major__pic img')).toHaveAttribute("src", /solomon-2sa-5-14-128\.webp$/);
  // An event with no portrait yet shows its letter (Jonathan's, the earlier example, came in round 4).
  await expect(page.locator(".tl-major .tl-major__letter").first()).toHaveText(/^[A-Z]$/);
});

test("search keeps its words: an event opens over the results, and closing it leaves them as they were", async ({ page }) => {
  await page.goto("/timeline/search");
  await page.getByRole("searchbox").fill("solomon");
  await expect(page).toHaveURL(/\/timeline\/search\?q=solomon$/);
  await expect(page.locator(".tl-search__list a")).toHaveCount(1);
  await expect(page.locator(".tl-search__list mark").first()).toHaveText(/solomon/i);
  await page.locator(".tl-search__list a").first().click();
  await expect(page).toHaveURL(/\/timeline\/search\?q=solomon&event=solomon$/);
  await expect(page.locator(".tl-event__title")).toHaveText("Solomon");
  await page.goBack();
  await expect(page).toHaveURL(/\/timeline\/search\?q=solomon$/);
  await expect(page.locator(".tl-sheet")).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveValue("solomon");
  await expect(page.locator(".tl-search__list a")).toHaveCount(1);
  // The keyboard, as in the main search: down into the results, Escape back to the field.
  await page.getByRole("searchbox").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".tl-search__list a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("searchbox").fill("zzzz");
  await expect(page.getByRole("status")).toContainText("No results for “zzzz”");
});
