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
