import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dfeed-review&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const saved = { video: "abcdefghijk", title: "A retained class", published: "2026-10-03T12:00:00Z", views: null };

async function setup(page: Page, status: () => boolean | undefined, theme = "dark") {
  await page.addInitScript(theme => {
    (window as unknown as { __cloud: Record<string, string> }).__cloud = {
      bs: JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }),
    };
  }, theme);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route("**/api/**", r => r.fulfill({ status: 404, body: "" }));
  await page.route("**/search/classes.json", r => r.fulfill({ json: [] }));
  await page.route("**/search/captains.json", r => r.fulfill({ json: [] }));
  await page.route("**/api/history/index.json", r => r.fulfill({ json: [] }));
  await page.route("**/api/recent", r => r.fulfill({ json: { videos: [saved], feedOk: status() } }));
}

for (const [width, height, theme] of [[390, 844, "light"], [1280, 800, "dark"]] as const) {
  test(`feed outage: retained classes stay usable and the ${theme} notice is dismissible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await setup(page, () => false, theme);
    await page.goto(`/classes${LAUNCH}`);
    const notice = page.getByRole("status").filter({ hasText: "New uploads may be delayed" });
    await expect(notice).toBeVisible();
    await expect(page.locator("article.post")).toContainText(saved.title);
    await expect(page.locator("article.post")).toContainText("Notes coming soon");
    const dismiss = page.getByRole("button", { name: "Dismiss upload notice" });
    const size = await dismiss.boundingBox();
    expect(size!.width).toBeGreaterThanOrEqual(44);
    expect(size!.height).toBeGreaterThanOrEqual(44);
    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(notice).toHaveCount(0);
    await expect(page.locator(`a[href$="/watch/${saved.video}"]`).first()).toBeVisible();
  });
}

for (const status of [true, undefined]) {
  test(`feed status ${status}: no outage notice and recent recordings remain visible`, async ({ page }) => {
    await setup(page, () => status);
    await page.goto(`/classes${LAUNCH}`);
    await expect(page.locator("article.post")).toContainText(saved.title);
    await expect(page.locator(".cfeed__notice")).toHaveCount(0);
  });
}

test("a recovered feed clears dismissal so a later outage is announced again", async ({ page }) => {
  await page.clock.install();
  let healthy = false;
  await setup(page, () => healthy);
  await page.goto(`/classes${LAUNCH}`);
  await page.getByRole("button", { name: "Dismiss upload notice" }).click();
  const refresh = async () => {
    await page.clock.fastForward(11 * 60_000);
    const response = page.waitForResponse(r => r.url().endsWith("/api/recent"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await response;
  };
  healthy = true;
  await refresh();
  await expect(page.locator(".cfeed__notice")).toHaveCount(0);
  healthy = false;
  await refresh();
  await expect(page.locator(".cfeed__notice")).toBeVisible();
  await expect(page.locator("article.post")).toContainText(saved.title);
});
