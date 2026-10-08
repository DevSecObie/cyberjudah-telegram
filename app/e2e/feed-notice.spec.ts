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
  await page.route(/^https?:\/\/[^/]+\/api\//, r => r.fulfill({ status: 404, body: "" }));
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
    await expect(page.locator("article.post")).toContainText("Notes for this class are coming soon. You can watch it now.");
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
  const refresh = async (interval: number) => {
    const response = page.waitForResponse(r => r.url().endsWith("/api/recent"));
    await page.clock.fastForward(interval + 1);
    await response;
  };
  healthy = true;
  await refresh(60_000);
  await expect(page.locator(".cfeed__notice")).toHaveCount(0);
  healthy = false;
  await refresh(10 * 60_000);
  await expect(page.locator(".cfeed__notice")).toBeVisible();
  await expect(page.locator("article.post")).toContainText(saved.title);
});

for (const available of [true, false]) {
  test(`class broadcast order with metadata ${available ? 'available' : 'unavailable'}`, async ({ page }) => {
    await setup(page, () => true);
    const day = '2026-10-03';
    const noted = (videoId: string, title: string, date = day) => ({ videoId, title, date, teacher: 'Teacher', url: `/classes/${videoId}`, thumb: '', topics: [], books: [] });
    // Input order is deliberately unrelated to the broadcast or alphabetic order.
    const notes = [noted('TVP5_nyFcHs', 'Afternoon class'), noted('PkFnZPllE5w', 'Midday class'), noted('CO-THOc-IhQ', 'Morning class'), noted('older123456', 'Previous week', '2026-09-26')];
    await page.route('**/search/classes.json', r => r.fulfill({ json: notes }));
    await page.route('**/api/recent', r => r.fulfill({ json: { feedOk: true, videos: [
      { video: 'pZs5reAzxi4', title: 'Haiti evening class', published: '2026-10-04T02:38:19Z', views: null },
      { video: 'CO-THOc-IhQ', title: 'Duplicate recording', published: '2026-10-03T15:00:00Z', views: null },
      { video: 'newest12345', title: 'Newest day', published: '2026-10-07T12:00:00Z', views: null },
    ] } }));
    await page.route('**/api/classes/broadcasts.json', r => available ? r.fulfill({ json: {
      'CO-THOc-IhQ': { date: day, broadcastAt: `${day}T12:56:31Z` },
      PkFnZPllE5w: { date: day, broadcastAt: `${day}T16:00:04Z` },
      TVP5_nyFcHs: { date: day, broadcastAt: `${day}T18:58:36Z` },
      pZs5reAzxi4: { date: day, broadcastAt: `${day}T21:56:00Z` },
    } }) : r.fulfill({ status: 503, body: 'unavailable' }));
    await page.goto(`/classes${LAUNCH}`);
    await expect(page.locator('.post__title')).toHaveText(available
      ? ['Newest day', 'Haiti evening class', 'Afternoon class', 'Midday class', 'Morning class', 'Previous week']
      : ['Newest day', 'Haiti evening class', 'Afternoon class', 'Midday class', 'Morning class', 'Previous week']);
    await expect(page.getByRole('link', { name: 'Morning class', exact: true })).toHaveAttribute('href', '/note/classes/CO-THOc-IhQ');
    await expect(page.getByRole('link', { name: 'Haiti evening class', exact: true })).toHaveAttribute('href', '/watch/pZs5reAzxi4');
    await page.getByRole('searchbox').fill('class');
    await expect(page.locator('.post__title')).toHaveText(available
      ? ['Haiti evening class', 'Afternoon class', 'Midday class', 'Morning class']
      : ['Haiti evening class', 'Afternoon class', 'Midday class', 'Morning class']);
  });
}
