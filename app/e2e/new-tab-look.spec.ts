import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's New Tab page (TabScreen/NewTab/NewTabScreen, NewTabContent, NewTabItem).
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dnew-tab-look&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Tg = { __tg: { state: () => { back: boolean } } };

async function setup(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "default-group", groups: [{ id: "default-group", name: "", color: "", isDefault: true, current: "n", tabs: [{ id: "b", path: "/read/genesis/1" }, { id: "n", path: "/new" }] }] }));
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/new${LAUNCH}`);
  await expect(page.locator(".nt-heading")).toHaveText("What would you like to explore?");
}

test("the page is Bible Strong's: three sections, no search field and no Back", async ({ page }) => {
  await setup(page);
  await expect(page.locator(".ntsection h2")).toHaveText(["Read and explore", "Studies and notes", "Library"]);
  await expect(page.getByRole("button", { name: "A passage, a tab, a tool…" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as Tg).__tg.state().back)).toBe(false);
  await expect(page.locator(".nt-heading")).toHaveCSS("font-size", "28px");
  await expect(page.locator(".ntsection h2").first()).toHaveCSS("font-size", "23px");
  // Bible Strong's cards come first in each section.
  await expect(page.locator(".ntgrid--read .ntcard b").first()).toHaveText("Reading plan");
  await expect(page.locator(".ntgrid--personal .ntcard b").first()).toHaveText("Studies");
  await expect(page.locator(".ntgrid--library .ntcard b")).toContainText(["Strong", "Topics", "Nave", "Dictionary"]);
});

test("cards carry their kind's icon and colour, the description as a hint", async ({ page }) => {
  await setup(page);
  const hero = page.locator(".ntcard--hero");
  await expect(hero).toHaveAccessibleName("Bible");
  await expect(hero).toHaveAttribute("aria-description", "Open the Bible and start reading");
  await expect(hero).toHaveCSS("min-height", "180px");
  await expect(hero.locator(".tabicon")).toHaveCSS("width", "40px");
  await expect(hero.locator(".ntcard__body b")).toHaveCSS("font-size", "36px");
  const strong = page.getByRole("button", { name: "Strong", exact: true });
  await expect(strong.locator(".tabicon")).toHaveClass(/tabicon--primary/);
  await expect(strong.locator(".tabicon")).toHaveCSS("width", "34px");
  await expect(page.getByRole("button", { name: "Kept", exact: true }).locator(".tabicon")).toHaveClass(/tabicon--color2/);
  await expect(page.getByRole("button", { name: "Studies", exact: true }).locator(".tabicon")).toHaveCSS("width", "28px");
  await expect(strong).toHaveCSS("min-height", "92px");
  await expect(strong).toHaveCSS("padding", "18px");
  await expect(page.locator(".ntsection__art")).toHaveCount(2);
});

test("a card Bible Strong does not search opens its page in this tab", async ({ page }) => {
  await setup(page);
  await page.locator(".ntcard", { hasText: "Everyone named in the Bible" }).click();
  await expect(page).toHaveURL(/\/people/);
  const groups = await page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups") ?? "{}"));
  expect(groups.groups[0].tabs.map((t: { id: string; path: string }) => `${t.id}:${t.path}`)).toEqual(["b:/read/genesis/1", "n:/people"]);
});

test("a wider page puts the cards side by side", async ({ page }) => {
  await setup(page, 800);
  const top = (name: string) => page.getByRole("button", { name, exact: true }).evaluate((el) => el.getBoundingClientRect().top);
  expect(await top("Reading plan")).toBe(await top("Timeline"));
  expect(await top("Studies")).toBe(await top("Kept"));
  expect(await top("Strong")).toBe(await top("Topics"));
  await expect(page.locator(".nt-heading")).toHaveCSS("font-size", "36px");
});
