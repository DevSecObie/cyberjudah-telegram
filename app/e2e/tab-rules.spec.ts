import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's tab and group rules (state/tabWorkspace.ts, state/tabs.ts, TabGroupPage, GroupActionsPopover).
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-rules&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Group = { id: string; name: string; color: string; current: string; tabs: { id: string; path: string }[]; isDefault?: boolean };

async function setup(page: Page, groups: Group[], group = groups[0].id) {
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", seed);
  }, JSON.stringify({ group, groups }));
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!) as { group: string; groups: Group[] });
const close = (page: Page, title: string) => page.getByRole("button", { name: `Close ${title}`, exact: true }).click();
const groupsMenu = (page: Page) => page.getByRole("toolbar", { name: "Tabs" }).locator(".switcherbar__group").click();
const three: Group = { id: "default-group", name: "My tabs", color: "", isDefault: true, current: "b", tabs: [{ id: "a", path: "/settings" }, { id: "b", path: "/search" }, { id: "c", path: "/timeline" }] };

test("closing the current tab selects the one that takes its place, and the last tab can close too", async ({ page }) => {
  await setup(page, [three]);
  await page.goto(`/tabs${LAUNCH}`);
  await close(page, "Search");
  await expect.poll(async () => (await saved(page)).groups[0].current).toBe("c");
  await close(page, "Bible timeline");
  await expect.poll(async () => (await saved(page)).groups[0].current).toBe("a");
  await close(page, "Settings");
  await expect.poll(async () => (await saved(page)).groups[0].tabs).toEqual([]);
  // The empty group: the tabs picture and Create a tab, which opens a new tab.
  await expect(page.locator(".switcher__empty-art")).toHaveCSS("width", "150px");
  await expect(page.getByRole("toolbar", { name: "Tabs" })).toContainText("0 tabs");
  await page.getByRole("button", { name: "Create a tab" }).click();
  await expect(page).toHaveURL(/\/new/);
  expect((await saved(page)).groups[0].tabs.map((t) => t.path)).toEqual(["/new"]);
});

test("an empty group reopens in the switcher", async ({ page }) => {
  await setup(page, [{ ...three, tabs: [], current: "" }]);
  await page.goto(`/${LAUNCH}`);
  await expect(page).toHaveURL(/\/tabs/);
  await expect(page.getByRole("button", { name: "Create a tab" })).toBeVisible();
});

test("Close all tabs empties any group and never deletes the default one", async ({ page }) => {
  const study: Group = { id: "g2", name: "Study", color: "#74b9ff", current: "d", tabs: [{ id: "d", path: "/lexicon" }] };
  await setup(page, [three, study]);
  await page.goto(`/tabs${LAUNCH}`);
  await groupsMenu(page);
  await page.getByRole("button", { name: "Close all tabs" }).click();
  await expect.poll(async () => (await saved(page)).groups.map((g) => [g.id, g.tabs.length])).toEqual([["default-group", 0], ["g2", 1]]);
  // No Delete on the default group.
  await groupsMenu(page);
  await expect(page.getByRole("button", { name: "Delete group" })).toHaveCount(0);
});

test("a new group needs a name, starts empty and takes the first colour", async ({ page }) => {
  await setup(page, [three]);
  await page.goto(`/tabs${LAUNCH}`);
  await groupsMenu(page);
  await page.getByRole("button", { name: "New group" }).click();
  await expect(page.getByRole("button", { name: "Create group" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Group name" }).fill("Psalms");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect.poll(async () => (await saved(page)).groups.length).toBe(2);
  const s = await saved(page);
  expect(s.groups[1]).toMatchObject({ name: "Psalms", color: "#636e72", tabs: [], current: "" });
  expect(s.group).toBe(s.groups[1].id);
  await expect(page.locator(".switcher__page[data-active]").getByRole("button", { name: "Create a tab" })).toBeVisible();
});

test("kept groups from before are kept: the first is the default group, without a colour", async ({ page }) => {
  await setup(page, [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "a", tabs: [{ id: "a", path: "/settings" }] }, { id: "two", name: "Work", color: "#60a5fa", current: "", tabs: [] }]);
  await page.goto(`/settings${LAUNCH}`);
  await expect(page).toHaveURL(/\/settings/);
  // The default group's count is plain, as Bible Strong's has no colour.
  await expect(page.locator(".tabs .tab__count")).not.toHaveAttribute("style", /--group/);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: /^Tabs, \d+ open$/ }).click();
  // It is named by its count; the other group keeps its name and colour.
  await expect(page.getByRole("toolbar", { name: "Tabs" })).toContainText("1 tab");
  await groupsMenu(page);
  await page.getByRole("button", { name: "View my groups" }).click();
  await expect(page.getByRole("dialog", { name: "View my groups" }).getByRole("button", { name: /^Work\. / })).toBeVisible();
});
