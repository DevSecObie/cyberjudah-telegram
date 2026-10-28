import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's openInNewTab: the new tab is added and the reader stays where they are, with a
// toast that goes to it.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dnew-tab-toast&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!).groups[0] as { current: string; tabs: { id: string; path: string }[] });

test("Open in a new tab stays put and the toast goes to the new tab", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "a", tabs: [{ id: "a", path: "/timeline" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/timeline${LAUNCH}`);
  await page.locator(".tlh").getByRole("button", { name: "More" }).click();
  await page.getByText("Open in a new tab", { exact: true }).click();

  const toast = page.locator(".toast", { hasText: "New tab created" });
  await expect(toast).toBeVisible();
  await expect(page).toHaveURL(/\/timeline(#|$)/);
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Tabs, 2 open", exact: true })).toBeVisible();
  let s = await state(page);
  expect(s.current).toBe("a");
  expect(s.tabs.map((t) => t.path)).toEqual(["/timeline", "/timeline"]);

  await toast.getByRole("button", { name: "Go to tab" }).click();
  await expect(toast).toHaveCount(0);
  await expect.poll(async () => (await state(page)).current).toBe(s.tabs[1].id);
  s = await state(page);
  expect(s.tabs.map((t) => t.path)).toEqual(["/timeline", "/timeline"]);
});

test("the toast's Go to tab does nothing once that tab is closed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "a", tabs: [{ id: "x", path: "/search" }, { id: "a", path: "/timeline" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/timeline${LAUNCH}`);
  await page.locator(".tlh").getByRole("button", { name: "More" }).click();
  await page.getByText("Open in a new tab", { exact: true }).click();
  const toast = page.locator(".toast", { hasText: "New tab created" });
  await expect(toast).toBeVisible();
  const added = (await state(page)).tabs[2].id;

  // The new tab is closed in the switcher while the toast is still up.
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Tabs, / }).click();
  await page.locator(`.switcher__page[data-active] .tabcard[data-tab-id='${added}']`).getByRole("button", { name: /^Close / }).click();
  await expect.poll(async () => (await state(page)).tabs.map((t) => t.id)).toEqual(["x", "a"]);
  await toast.getByRole("button", { name: "Go to tab" }).click();
  // It does not fall back to another tab.
  await expect(page).toHaveURL(/\/tabs(#|$)/);
  expect((await state(page)).current).toBe("a");
});

test("a toast is Bible Strong's: at the top, no icon or timer line, and it leaves after 3 seconds", async ({ page }) => {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/timeline${LAUNCH}`);
  await page.locator(".tlh").getByRole("button", { name: "More" }).click();
  await page.getByText("Open in a new tab", { exact: true }).click();
  const toast = page.locator(".toast", { hasText: "New tab created" });
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  expect(box.y).toBeLessThan(page.viewportSize()!.height / 3);
  expect(box.width).toBeLessThanOrEqual(420);
  expect(await toast.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
  // On the page colour (Bible Strong's reverse), not the card grey.
  expect(await toast.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  // The hidden Dismiss takes no taps meant for the message.
  await expect(toast.getByRole("button", { name: "Dismiss" })).toHaveCSS("pointer-events", "none");
  await expect(toast.locator(".toast__icon, .toast__timer")).toHaveCount(0);
  await expect(toast.getByRole("button", { name: "Dismiss" })).toHaveCSS("opacity", "0");
  await page.waitForTimeout(1500);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCount(0, { timeout: 3000 });
});
