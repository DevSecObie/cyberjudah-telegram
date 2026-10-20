import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's Home and menu drawers push their pages over the workspace (Link → pushRouteOnce):
// the current tab is not changed, Back returns to it as it was, and no tab is created.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dpages-over-tabs&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "default-group", groups: [{ id: "default-group", name: "", color: "", isDefault: true, current: "p", tabs: [{ id: "n", path: "/new" }, { id: "p", path: "/people" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/people${LAUNCH}`);
  await expect(page).toHaveURL(/\/people/);
}
const tabs = (page: Page) => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cj:tabgroups") ?? "{}"); const g = s.groups[0]; return `${g.current} ${g.tabs.map((t: { id: string; path: string }) => `${t.id}:${t.path}`).join(" ")}`; });
const bar = (page: Page) => page.getByRole("navigation", { name: "Sections" });

test("a page opened from the menu, and one further in, leave the tabs as they were; Back returns to the tab", async ({ page }) => {
  await setup(page);
  const before = await tabs(page);
  await bar(page).getByRole("button", { name: "Main menu", exact: true }).click();
  await page.locator(".drawer--more").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await tabs(page)).toBe(before);
  await page.getByRole("button", { name: /Audio settings/ }).click();
  await expect(page).toHaveURL(/\/settings\/audio$/);
  expect(await tabs(page)).toBe(before);
  await page.goBack(); await page.goBack();
  await expect(page).toHaveURL(/\/people(#|$)/);
  expect(await tabs(page)).toBe(before);
});

test("a page opened from Home does not change the tab, and a bar button from it goes to a tab", async ({ page }) => {
  await setup(page);
  const before = await tabs(page);
  await bar(page).getByRole("button", { name: "Home", exact: true }).click();
  await page.locator(".drawer--home .stats__cell[href=\"/studies\"]").click();
  await expect(page).toHaveURL(/\/studies$/);
  expect(await tabs(page)).toBe(before);
  // The tabs count goes to the switcher, where the tabs are as they were.
  await bar(page).getByRole("button", { name: "Tabs, 2 open", exact: true }).click();
  await expect(page.locator(".switcher__page[data-active] .tabcard")).toHaveCount(2);
  expect(await tabs(page)).toBe(before);
});

test("a new tab from the keyboard replaces the page, so Back does not cross into another tab", async ({ page }) => {
  await setup(page);
  const depth = await page.evaluate(() => history.length);
  await page.keyboard.press("Control+Alt+n");
  await expect(page).toHaveURL(/\/new$/);
  expect(await page.evaluate(() => history.length)).toBe(depth);
});

test("a reload on a page over the tab keeps it over the tab", async ({ page }) => {
  await setup(page);
  const before = await tabs(page);
  await bar(page).getByRole("button", { name: "Main menu", exact: true }).click();
  await page.locator(".drawer--more").getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  expect(await tabs(page)).toBe(before);
});

test("Open in a new tab from a timeline over the tab makes a tab that keeps its place", async ({ page }) => {
  await setup(page);
  await bar(page).getByRole("button", { name: "Main menu", exact: true }).click();
  await page.locator(".drawer--more").getByRole("link", { name: "Bible timeline", exact: true }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByText("Open in a new tab", { exact: true }).click();
  await expect.poll(async () => (await tabs(page)).endsWith(":/timeline")).toBe(true);
  await page.locator('a[href^="/timeline/"]').first().click();
  await expect(page).toHaveURL(/\/timeline\/.+/);
  const path = new URL(page.url()).pathname;
  await expect.poll(async () => (await tabs(page)).endsWith(`:${path}`)).toBe(true);
});

test("a bar swipe with no tab to go to leaves the page over the tab", async ({ page }) => {
  await setup(page);
  const before = await tabs(page);
  await bar(page).getByRole("button", { name: "Home", exact: true }).click();
  await page.locator(".drawer--home .stats__cell[href=\"/studies\"]").click();
  await expect(page).toHaveURL(/\/studies$/);
  // The current tab is the last, so a swipe toward the next one finds none.
  await bar(page).evaluate((nav) => {
    const r = nav.getBoundingClientRect(), y = r.y + 24, at = (x: number) => ({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0 });
    nav.dispatchEvent(new PointerEvent("pointerdown", at(r.right - 30)));
    nav.dispatchEvent(new PointerEvent("pointerup", at(r.x + 30)));
  });
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/studies$/);
  // Back to the tab and forward again: the page is still over it, not written into it.
  await page.goBack(); await expect(page).toHaveURL(/\/people(#|$)/);
  await page.goForward(); await expect(page).toHaveURL(/\/studies$/);
  expect(await tabs(page)).toBe(before);
});
