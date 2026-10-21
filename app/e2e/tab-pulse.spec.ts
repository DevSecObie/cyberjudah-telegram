import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's tab count grows and settles when a tab is opened or closed (useTabButtonPress).
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-pulse&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

const pulses = (page: Page) => page.evaluate(() => {
  const box = document.querySelector(".tabs .tab__count")!;
  return box.getAnimations().map((a) => {
    const t = (a.effect as KeyframeEffect).getTiming();
    return { delay: t.delay, duration: t.duration, scales: (a.effect as KeyframeEffect).getKeyframes().map((k) => k.transform) };
  });
});

test("the tab count pulses when a tab opens or closes, and not on load", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "a", tabs: [{ id: "a", path: "/settings" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/settings${LAUNCH}`);
  const tabsButton = (n: number) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: `Tabs, ${n} open`, exact: true });
  await expect(tabsButton(1)).toBeVisible();
  expect(await pulses(page)).toEqual([]);
  const pulse = { delay: 300, duration: 1000, scales: ["scale(1)", "scale(1.2)", "scale(1)"] };
  await page.keyboard.press("Control+Alt+n");
  await expect(tabsButton(2)).toBeVisible();
  expect(await pulses(page)).toEqual([pulse]);
  await page.waitForTimeout(1400);
  expect(await pulses(page)).toEqual([]);
  await page.keyboard.press("Control+Alt+w");
  await expect(tabsButton(1)).toBeVisible();
  expect(await pulses(page)).toEqual([pulse]);
});
