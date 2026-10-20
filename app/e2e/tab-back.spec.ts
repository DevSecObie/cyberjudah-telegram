import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's Back never leaves the tab you are in: changing tab is not a step back.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-back&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Tg = { __tg: { press: (button: string) => void; state: () => { back: boolean } } };

async function setup(page: Page, tabs: { id: string; path: string }[]) {
  await page.addInitScript((tabs) => {
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: tabs[0].id, tabs }] }));
  }, tabs);
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
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /Tabs open/ }).click();
  await page.locator('.tabcard[data-tab-id="b"]').click();
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(() => backShown(page)).toBe(false);
  await back(page);
  await expect(page).toHaveURL(/\/search/);
  await expect.poll(async () => (await tabPaths(page)).a).toBe("/settings/credits");
  // Back within the tab still works: a page opened in it goes back to the tab's first page.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /Tabs open/ }).click();
  await page.locator('.tabcard[data-tab-id="a"]').click();
  await expect(page).toHaveURL(/\/settings\/credits/);
  await back(page);
  await expect(page).toHaveURL(/\/settings$/);
});
