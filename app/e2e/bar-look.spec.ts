import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's BottomTabBar in its view row: 48 px buttons spread evenly, Feather at its own
// stroke, dimming to .2 while pressed, no selected state, no haptics and no long press.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dbar-look&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

async function setup(page: Page, color = "") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((color) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const main = { id: "default-group", name: "", color: "", isDefault: true, current: "s", tabs: [{ id: "s", path: "/settings" }, { id: "p", path: "/people" }] };
    const named = { id: "g2", name: "Psalms", color, current: "s2", tabs: [{ id: "s2", path: "/settings" }], createdAt: 1 };
    localStorage.setItem("cj:tabgroups", JSON.stringify(color ? { group: "g2", groups: [main, named] } : { group: "default-group", groups: [main] }));
  }, color);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/settings${LAUNCH}`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
}
const bar = (page: Page) => page.getByRole("navigation", { name: "Sections" });

for (const theme of ["default", "dark"]) {
  test(`More menu: ${theme} matches the rows, group strips and arrow header without reordering`, async ({ page }) => {
    await page.addInitScript(theme => {
      (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: theme === "dark" ? "dark" : "light", preferredLightTheme: "default", preferredDarkTheme: "dark" }) };
    }, theme);
    await setup(page);
    await bar(page).getByRole("button", { name: "Main menu", exact: true }).click();
    const drawer = page.locator(".drawer--more[data-open]");
    const heading = drawer.locator(".drawer__head h2");
    await expect(heading).toHaveText("More");
    await expect(heading).toHaveCSS("font-size", "14px");
    await expect(heading).toHaveCSS("font-weight", "700");
    await expect(drawer).toHaveCSS("backdrop-filter", "none");
    const back = drawer.getByRole("button", { name: "Close the menu", exact: true });
    await expect(back.locator("svg")).toHaveAttribute("width", "20");
    await expect(back.locator("svg path").first()).toHaveAttribute("d", "M19 12H5");
    await expect(drawer.locator(".mcard__head")).toHaveText(["Yours", "Resources", "The Law", "Settings", "CyberJudah"]);
    expect(await drawer.locator(".more").evaluate(el => el.firstElementChild?.className)).toBe("more__account");
    for (const strip of await drawer.locator(".mcard__head").all()) {
      await expect(strip).toHaveCSS("font-size", "12px");
      await expect(strip).toHaveCSS("text-transform", "uppercase");
      await expect(strip).toHaveCSS("background-color", theme === "default" ? "rgba(0, 0, 0, 0.05)" : "rgba(200, 200, 200, 0.05)");
      await expect(strip.locator("svg")).toHaveAttribute("width", "16");
    }
    for (const row of await drawer.locator(".mcard__row").all()) {
      if (await row.getAttribute("href") === "/doctrine") {
        await expect(row.locator(".mcard__description")).toHaveText("False doctrines answered from scripture and the classes");
        expect((await row.boundingBox())!.height).toBeGreaterThan(48);
      } else await expect(row).toHaveCSS("height", "48px");
      await expect(row).toHaveCSS("font-size", "15px");
      await expect(row.locator(".mcard__icon")).toHaveCSS("width", "36px");
    }
    const resources = drawer.locator(".mcard").filter({ has: page.getByRole("heading", { name: "Resources", exact: true }) });
    await expect(resources).toHaveCSS("background-color", theme === "default" ? "rgb(255, 255, 255)" : "rgb(18, 45, 66)");
    await expect(resources.locator(".mcard__head")).toHaveCSS("font-weight", "400");
    for (const row of await resources.locator(".mcard__row").all()) {
      const color = await row.locator(".mcard__icon").evaluate(el => getComputedStyle(el).color);
      await expect(row.locator(".mcard__label")).toHaveCSS("color", color);
    }
    await back.click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings/);
  });
}

test("the buttons are 48 px, at Feather's stroke, with Bible Strong's labels and no selected state", async ({ page }) => {
  await setup(page);
  const buttons = bar(page).locator(".tab");
  for (const width of await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))) expect(width).toBeCloseTo(48, 1);
  await expect(bar(page).getByRole("button", { name: "Tabs, 2 open", exact: true })).toBeVisible();
  await expect(buttons.last()).toHaveAttribute("aria-label", "Main menu");
  await expect(bar(page).locator(".tab[aria-current], .tab[data-on]")).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: "Home", exact: true }).locator("svg")).toHaveCSS("stroke-width", "2px");
  await expect(bar(page).locator(".tab__count")).toHaveCSS("width", "20px");
});

test("a coloured group's count reads black on a light colour, as getContrastTextColor gives", async ({ page }) => {
  await setup(page, "#81ecec");
  const box = bar(page).locator(".tab__count");
  await expect(box).toHaveCSS("background-color", "rgb(129, 236, 236)");
  await expect(box).not.toHaveCSS("color", "rgb(255, 255, 255)");
});

test("holding a button does nothing more than a tap, and a tap never buzzes", async ({ page }) => {
  await setup(page);
  type Log = { __tg: { log: unknown[][] } };
  const haptics = () => page.evaluate(() => (window as unknown as Log).__tg.log.filter((e) => e[0] === "haptic").length);
  const before = await haptics();
  const search = bar(page).getByRole("button", { name: "Search", exact: true });
  const box = (await search.boundingBox())!;
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await expect(page).toHaveURL(/\/settings/);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/search/);
  expect(await haptics()).toBe(before);
});

test("a button for the page already showing leaves it where it is", async ({ page }) => {
  await setup(page);
  await bar(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await page.evaluate(() => { document.documentElement.style.minHeight = "3000px"; window.scrollTo(0, 400); });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await bar(page).getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
});
