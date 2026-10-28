import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { goInApp } from "./telegram-harness";

// Bible Strong's Back never leaves the tab you are in: changing tab is not a step back.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-back&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Tg = { __tg: { press: (button: string) => void; state: () => { back: boolean } } };

async function setup(page: Page, tabs: { id: string; path: string }[], current = tabs[0].id) {
  await page.addInitScript(({ tabs, current }) => {
    // Seeded once: a reload keeps what the test did.
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current, tabs }] }));
  }, { tabs, current });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}
const back = (page: Page) => page.evaluate(() => (window as unknown as Tg).__tg.press("back"));
const backShown = (page: Page) => page.evaluate(() => (window as unknown as Tg).__tg.state().back);
const tabPaths = (page: Page) => page.evaluate(() => Object.fromEntries((JSON.parse(localStorage.getItem("cj:tabgroups")!).groups[0].tabs as { id: string; path: string }[]).map((t) => [t.id, t.path])));
const openCredits = async (page: Page) => {
  await page.goto(`/settings${LAUNCH}`);
  await page.getByRole("button", { name: /^Credits/ }).click();
  await expect(page).toHaveURL(/\/settings\/credits/);
  await expect.poll(() => backShown(page)).toBe(true);
};

test("Back stays in the tab the bar switched to, and the tab left keeps its page", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/settings" }]);
  await openCredits(page);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  // Search is the first page of its tab: no Back, and pressing it stays.
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(async () => (await tabPaths(page)).a).toBe("/settings/credits");
});

test("Back stays in the tab chosen in the switcher", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/settings" }, { id: "b", path: "/search" }]);
  await openCredits(page);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Tabs, / }).click();
  await page.locator('.tabcard[data-tab-id="b"]').click();
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(async () => (await tabPaths(page)).a).toBe("/settings/credits");
  // Back within the tab still works: a page opened in it goes back to the tab's first page.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Tabs, / }).click();
  await page.locator('.tabcard[data-tab-id="a"]').click();
  await expect(page).toHaveURL(/\/settings\/credits/);
  await expect(page.getByRole("heading", { name: "Credits", exact: true })).toBeVisible();
  await expect.poll(() => backShown(page)).toBe(true);
  await back(page);
  await expect(page).toHaveURL(/\/settings$/);
});

test("a bar button for the tab already showing leaves Back as it was for the next page", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/search" }]);
  await page.goto(`/search${LAUNCH}`);
  const bar = page.getByRole("navigation", { name: "Sections" });
  await bar.getByRole("button", { name: "Search", exact: true }).click();
  await bar.getByRole("button", { name: "Main menu", exact: true }).click();
  await page.locator(".drawer--more").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect.poll(() => backShown(page)).toBe(true);
  // The menu takes Back while it closes; then Back leaves Settings for the tab under it.
  await expect(async () => { await back(page); await expect(page).toHaveURL(/\/search/, { timeout: 500 }); }).toPass();
});

test("The platform tab-close shortcut closing the tab you are in leaves Back to the tab you land in", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/settings" }, { id: "b", path: "/search" }]);
  await openCredits(page);
  await page.keyboard.press("ControlOrMeta+Alt+KeyW");
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search/);
  expect(await tabPaths(page)).toEqual({ b: "/search" });
});

test("after a reload, Back still stays in the tab", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/settings" }]);
  await openCredits(page);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await page.reload();
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search/);
});

test("a swipe along the bar to a tab on the same page starts that tab's Back there", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/settings" }, { id: "b", path: "/settings/credits" }]);
  // Tab a goes on to Credits: both tabs now show the same page, a with a page behind it.
  await openCredits(page);
  const bar = (await page.getByRole("navigation", { name: "Sections" }).boundingBox())!;
  const y = bar.y + bar.height / 2;
  const key = await page.evaluate(() => history.state.key as string);
  await page.mouse.move(bar.x + 250, y); await page.mouse.down();
  await page.mouse.move(bar.x + 150, y, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem("cj:tabgroups")!)).groups[0].current).toBe("b");
  // The tab change has replaced the page before Back is pressed.
  await expect.poll(() => page.evaluate(() => history.state.key as string)).not.toBe(key);
  await expect(page.locator(".tabscrub")).toHaveCount(0);
  // Back in tab b goes up to Settings in place, not back through tab a's history.
  const idx = await page.evaluate(() => history.state.idx as number);
  await back(page);
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(() => history.state.idx as number)).toBe(idx);
});

test("a bar button that picks another tab on the same page starts that tab's Back there", async ({ page }) => {
  await setup(page, [{ id: "a", path: "/search" }, { id: "b", path: "/classes" }], "b");
  await page.goto(`/classes${LAUNCH}`);
  const bar = page.getByRole("navigation", { name: "Sections" });
  // Tab b goes on to Search: both tabs now show the same page, b with a page behind it.
  await goInApp(page, "/search");
  await expect(page).toHaveURL(/\/search$/);
  await expect.poll(() => backShown(page)).toBe(true);
  // Search in the bar picks the first Search tab, a: its Back starts here, not in b's history.
  await expect(async () => {
    await bar.getByRole("button", { name: "Search", exact: true }).click();
    await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem("cj:tabgroups")!)).groups[0].current, { timeout: 500 }).toBe("a");
  }).toPass();
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search$/);
  expect(await tabPaths(page)).toEqual({ a: "/search", b: "/search" });
});
