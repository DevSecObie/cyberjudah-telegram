import { expect, test, type Page } from "@playwright/test";

// Bible Strong's HistoryScreen: a row per passage read, newest first, the reference in bold and its
// "Verse" chip over how long ago; the trash button clears it all after asking.
async function setup(page: Page, rows: { slug: string; chapter: number; verse?: number; name: string; ago: number }[]) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((r) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("cj:hist", JSON.stringify(r.map((x: { ago: number }) => ({ ...x, at: Date.now() - x.ago })))); } }, rows);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}
const HOUR = 3_600_000;

test("a row per passage, newest first: the reference in bold, the Verse chip over how long ago", async ({ page }) => {
  await setup(page, [{ slug: "john", chapter: 3, verse: 16, name: "John 3", ago: 2 * 60_000 }, { slug: "genesis", chapter: 1, name: "Genesis 1", ago: 3 * HOUR }]);
  await page.goto("/history");
  await expect(page.locator(".head h1")).toHaveText("Recently viewed");
  await expect(page.locator(".histitem__title")).toHaveText(["John 3:16", "Genesis 1"]);
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
  expect(await page.evaluate(() => localStorage.getItem("cj:hist"))).toBe("[]");
});
