import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's tab switcher (TabGroupPage, TabPreview, getIconByTabType, BottomTabBar in list mode).
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dswitcher-look&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Tg = { __tg: { state: () => { back: boolean } } };
const tabs = [
  { id: "a", path: "/lexicon" },
  { id: "b", path: "/read/genesis/1" },
  { id: "c", path: "/search?q=the%20everlasting%20covenant%20of%20the%20most%20high" },
];

async function setup(page: Page, named: false | "short" | "long" = false) {
  await page.addInitScript(({ tabs, named }) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const main = { id: "default-group", name: "My tabs", color: "", isDefault: true, current: "b", tabs: named ? [{ id: "z", path: "/settings" }] : tabs };
    const study = { id: "g2", name: named === "long" ? "The Psalms of King David" : "Psalms", color: "#74b9ff", current: "b", tabs, createdAt: 1 };
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: named ? "g2" : "default-group", groups: named ? [main, study] : [main] }));
  }, { tabs, named });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/tabs${LAUNCH}`);
  await expect(page.locator(".switcher__page[data-active] .tabcard")).toHaveCount(3);
}

test("the switcher bar is +, the group and OK, with no Back on the switcher", async ({ page }) => {
  await setup(page);
  const bar = page.getByRole("navigation", { name: "Tabs" });
  await expect(bar.getByRole("button")).toHaveText(["", "3 tabs", "OK"]);
  await expect(bar.getByRole("button", { name: "Open selected tab" })).toHaveCSS("font-size", "16px");
  await expect.poll(() => page.evaluate(() => (window as unknown as Tg).__tg.state().back)).toBe(false);
  // The default group has no header.
  await expect(page.locator(".switcher__group")).toHaveCount(0);
});

test("cards carry Bible Strong's tab icons and cut long titles in the middle", async ({ page }) => {
  await setup(page);
  await expect(page.locator('.tabcard[data-tab-id="a"] .tabcard__title .tabicon')).toHaveClass(/tabicon--primary/);
  await expect(page.locator('.tabcard[data-tab-id="b"] .tabcard__title .tabicon')).toHaveClass(/tabicon--tertiary/);
  const title = await page.locator('.tabcard[data-tab-id="c"] .tabcard__title b').textContent();
  // Where the cut falls depends on the font; it keeps the start and the end with … between.
  expect(title).toMatch(/^the .*….*high$/);
});

test("the Bible card title fits in full in the title font without moving the card controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.evaluate(() => document.fonts.ready);
  const card = page.locator('.tabcard[data-tab-id="b"]');
  const title = card.locator(".tabcard__title b");
  await expect(title).toHaveText("Genesis 1 - KJV");
  await expect(title).toHaveCSS("font-family", /Plus Jakarta Sans/);
  await expect(title).toHaveCSS("font-size", "12px");
  await expect(title).toHaveCSS("font-weight", "700");
  await expect(card.locator(".tabcard__title")).toHaveCSS("padding", "0px 5px 0px 14px");
  const layout = await card.evaluate(el => {
    const card = el.getBoundingClientRect();
    const row = el.querySelector(".tabcard__title")!.getBoundingClientRect();
    const icon = el.querySelector(".tabcard__title .tabicon")!.getBoundingClientRect();
    const title = el.querySelector(".tabcard__title b")!.getBoundingClientRect();
    const close = el.querySelector(".tabcard__close")!.getBoundingClientRect();
    const capsule = el.querySelector(".tabcard__close span")!.getBoundingClientRect();
    return { card: card.width, row: row.width, icon: icon.width, titleX: title.x - card.x, titleRight: title.right, capsuleLeft: capsule.left, close: close.width, capsule: capsule.width };
  });
  expect(layout).toMatchObject({ card: 165, row: 125, icon: 16, titleX: 38, close: 40, capsule: 24 });
  expect(layout.titleRight).toBeLessThan(layout.capsuleLeft);
  await expect(card.locator(".tabcard__open")).toHaveAttribute("aria-label", "Open Genesis 1 - KJV");
});

test("a named group shows its count on its colour and its name at 30 px", async ({ page }) => {
  await setup(page, "short");
  const header = page.locator(".switcher__group");
  await expect(header.locator(".switcher__badge")).toHaveText("3");
  await expect(header.locator(".switcher__badge")).toHaveCSS("background-color", "rgb(116, 185, 255)");
  await expect(header.locator(".switcher__name")).toHaveText("Psalms");
  await expect(header.locator(".switcher__name")).toHaveCSS("font-size", "30px");
});

test("a long group name gets smaller to fit 70% of the screen", async ({ page }) => {
  await setup(page, "long");
  const name = page.locator(".switcher__group .switcher__name");
  await expect(name).toHaveText("The Psalms of King David");
  await expect.poll(async () => parseFloat(await name.evaluate((el) => getComputedStyle(el).fontSize))).toBeLessThan(30);
  expect(await name.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; })).toBeLessThanOrEqual(390 * 0.7 + 1);
});

test("a closed card zooms away while the others slide over", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __zoom: string[] }).__zoom = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      if (this.classList.contains("tabcard")) seen.push(`${this.hasAttribute("data-tab-id") ? "card" : "ghost"}:${JSON.stringify(keyframes)}:${(options as KeyframeAnimationOptions).duration}`);
      return animate.call(this, keyframes, options);
    };
  });
  await page.getByRole("button", { name: "Close Strong", exact: true }).click();
  await expect(page.locator(".tabcard[data-tab-id]")).toHaveCount(2);
  const seen = await page.evaluate(() => (window as unknown as { __zoom: string[] }).__zoom);
  expect(seen).toContain('ghost:[{"transform":"scale(1)"},{"transform":"scale(0)"}]:300');
  expect(seen.some((s) => s.startsWith("card:") && s.endsWith(":300"))).toBe(true);
});
