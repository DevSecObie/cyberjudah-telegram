import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's swipe along the bottom bar (useTabBarSwipeGesture, TabPreviewCarousel).
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-scrub&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const TABS = [{ id: "a", path: "/settings" }, { id: "b", path: "/search" }, { id: "c", path: "/settings/credits" }];

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((tabs) => {
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "a", tabs }] }));
  }, TABS);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/settings${LAUNCH}`);
  const bar = (await page.getByRole("navigation", { name: "Sections" }).boundingBox())!;
  // From the right of the bar, as a right thumb swipes.
  return { x: bar.x + bar.width - 30, y: bar.y + bar.height / 2 };
}
const current = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!).groups[0].current);

test("a slow swipe shows every tab as a card under the finger and settles on the nearest", async ({ page }) => {
  const at = await setup(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 30, at.y, { steps: 3 });
  const layer = page.locator(".tabscrub");
  await expect(layer).toBeVisible();
  await expect(layer.locator(".tabscrub__card")).toHaveCount(3);
  await expect(layer.locator(".tabscrub__card").nth(1)).toContainText("Search");
  await expect(layer.locator(".tabscrub__icon").first()).toHaveCSS("width", "80px");
  // One tab is (390 + 20) / 1.5 px of finger; stop a little past it and hold still before letting go.
  const one = (390 + 20) / 1.5;
  await page.mouse.move(at.x - one - 20, at.y, { steps: 8 });
  await page.waitForTimeout(200);
  await page.mouse.move(at.x - one - 21, at.y);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search/);
  expect(await current(page)).toBe("b");
  await expect(layer).toHaveCount(0);
});

test("a quick flick goes to the next tab; an upward move starts no swipe", async ({ page }) => {
  const at = await setup(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  // The swipe starts past 15 px and shows the cards; from there one long move, short of half a
  // tab, so only its speed carries it on to Search (110 px in under 137 ms is past 800 px/s).
  await page.mouse.move(at.x - 16, at.y);
  await expect(page.locator(".tabscrub")).toBeVisible();
  await page.mouse.move(at.x - 20, at.y);
  await page.mouse.move(at.x - 130, at.y);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search/);
  expect(await current(page)).toBe("b");
  await expect(page.locator(".tabscrub")).toHaveCount(0);
  // Up or down first gives the swipe up, as Bible Strong's failOffsetY.
  const bar = (await page.getByRole("navigation", { name: "Sections" }).boundingBox())!;
  const y = bar.y + bar.height / 2;
  await page.mouse.move(at.x, y);
  await page.mouse.down();
  await page.mouse.move(at.x, y - 12, { steps: 2 });
  await page.mouse.move(at.x - 80, y - 12, { steps: 4 });
  await expect(page.locator(".tabscrub")).toHaveCount(0);
  await page.mouse.up();
  expect(await current(page)).toBe("b");
});

test("a swipe the browser cancels leaves the bar's buttons working from the keyboard", async ({ page }) => {
  const at = await setup(page);
  await page.evaluate(() => addEventListener("pointerdown", (e) => { (window as unknown as { __id: number }).__id = e.pointerId; }, true));
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 30, at.y, { steps: 3 });
  await expect(page.locator(".tabscrub")).toBeVisible();
  // The browser takes the pointer away mid-swipe.
  await page.getByRole("navigation", { name: "Sections" }).evaluate((nav) => nav.dispatchEvent(new PointerEvent("pointercancel", { pointerId: (window as unknown as { __id: number }).__id, isPrimary: true, bubbles: true })));
  await expect(page.locator(".tabscrub")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search/);
});

test("the cards stay on the chosen tab while the carousel fades", async ({ page }) => {
  const at = await setup(page);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  // Past half a tab, so the release settles on Search whether or not it still counts as a flick.
  await page.mouse.move(at.x - 180, at.y, { steps: 4 });
  await expect(page.locator(".tabscrub")).toBeVisible();
  // Every place the track is put after the finger lifts.
  await page.locator(".tabscrub__track").evaluate((track) => {
    const seen: string[] = []; (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => seen.push((track as HTMLElement).style.transform)).observe(track, { attributes: true, attributeFilter: ["style"] });
  });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.locator(".tabscrub")).toHaveCount(0);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((t) => t === `translateX(${-(390 + 20)}px)`)).toBe(true);
});
