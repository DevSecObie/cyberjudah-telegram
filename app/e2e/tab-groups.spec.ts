import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's groups: GroupActionsPopover, CreateGroupPage, TabGroupPager, ViewGroupsModal, EditGroupModal.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dtab-groups&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
type Group = { id: string; name: string; color: string; current: string; tabs: { id: string; path: string }[]; isDefault?: boolean; createdAt?: number };
const main: Group = { id: "default-group", name: "My tabs", color: "", isDefault: true, current: "a", tabs: [{ id: "a", path: "/settings" }, { id: "b", path: "/search" }] };
const psalms: Group = { id: "g2", name: "Psalms", color: "#74b9ff", current: "c", tabs: [{ id: "c", path: "/lexicon" }], createdAt: Date.now() - 5 * 60_000 };

async function setup(page: Page, groups: Group[], group = groups[0].id) {
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:tabgroups", seed);
  }, JSON.stringify({ group, groups }));
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/tabs${LAUNCH}`);
  await expect(page.locator(".switcher__page[data-active]")).toBeVisible();
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!) as { group: string; groups: Group[] });
const pill = (page: Page) => page.getByRole("toolbar", { name: "Tabs" }).locator(".switcherbar__group");
const menu = (page: Page) => page.getByRole("dialog", { name: "Group actions" });
async function swipe(page: Page, dx: number) {
  const box = (await page.locator(".switcher").boundingBox())!;
  const y = box.y + 300, x = dx < 0 ? box.x + box.width - 40 : box.x + 40;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 6 }); await page.mouse.move(x + dx, y, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test("the group menu: Close all tabs, Edit and Delete for a named group, then New group and View my groups", async ({ page }) => {
  await setup(page, [main, psalms]);
  await pill(page).click();
  await expect(menu(page).locator(".gaction")).toHaveText(["Close all tabs", "New group", "View my groups"]);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await swipe(page, -300);
  await expect.poll(async () => (await saved(page)).group).toBe("g2");
  await pill(page).click();
  await expect(menu(page).locator(".gaction")).toHaveText(["Close all tabs", "Edit group", "Delete group", "New group", "View my groups"]);
  await expect(menu(page).getByRole("button", { name: "Delete group" })).toHaveCSS("color", "rgb(194, 40, 57)");
});

test("New group slides to the create page: a name, a colour and ✓ make an empty group", async ({ page }) => {
  await setup(page, [main]);
  await pill(page).click();
  await menu(page).getByRole("button", { name: "New group" }).click();
  const name = page.getByRole("textbox", { name: "Group name" });
  await expect(name).toBeFocused();
  await expect(page.getByRole("button", { name: "Create group" })).toBeDisabled();
  await name.fill("Revelation");
  await page.getByRole("radio", { name: "Color 3" }).click();
  await page.getByRole("button", { name: "Create group" }).click();
  await expect.poll(async () => (await saved(page)).groups.map((g) => [g.name, g.color, g.tabs.length])).toEqual([["My tabs", "", 2], ["Revelation", "#74b9ff", 0]]);
  await expect(pill(page)).toHaveText("Revelation");
  await expect(page.locator(".switcher__page[data-active]").getByRole("button", { name: "Create a tab" })).toBeVisible();
});

test("swiping past the last group reveals the create page, and ✕ goes back", async ({ page }) => {
  await setup(page, [main]);
  await swipe(page, -300);
  await expect(page.getByRole("textbox", { name: "Group name" })).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("textbox", { name: "Group name" })).not.toBeFocused();
  await expect(pill(page)).toHaveText("2 tabs");
  // A short drag springs back to the same group.
  await swipe(page, -60);
  await expect(pill(page)).toHaveText("2 tabs");
});

test("View my groups: a card per group, the main one and when the others were made; a tap goes to it", async ({ page }) => {
  await setup(page, [main, psalms]);
  await pill(page).click();
  await menu(page).getByRole("button", { name: "View my groups" }).click();
  const view = page.getByRole("dialog", { name: "View my groups" });
  await expect(view.locator(".gcard")).toHaveCount(2);
  await expect(view.locator(".gcard").first()).toContainText("2 tabsMain group");
  await expect(view.locator(".gcard").nth(1)).toContainText("PsalmsCreated 5 minutes ago");
  await expect(view.locator(".gcard").first()).toHaveCSS("border-top-width", "2px");
  await view.locator(".gcard").nth(1).click();
  await expect.poll(async () => (await saved(page)).group).toBe("g2");
  await expect(pill(page)).toHaveText("Psalms");
});

test("Edit group renames and recolours in one sheet; Delete asks Telegram, then goes to the group before", async ({ page }) => {
  await setup(page, [main, psalms], "g2");
  await pill(page).click();
  await menu(page).getByRole("button", { name: "Edit group" }).click();
  const edit = page.getByRole("dialog", { name: "Edit group" });
  await expect(edit.getByRole("textbox")).toHaveValue("Psalms");
  await edit.getByRole("textbox").fill("Psalms and Hymns");
  await edit.getByRole("radio", { name: "Color 5" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(pill(page)).toHaveText("Psalms and Hymns");
  expect((await saved(page)).groups[1]).toMatchObject({ name: "Psalms and Hymns", color: "#fd79a8" });
  await pill(page).click();
  await menu(page).getByRole("button", { name: "Delete group" }).click();
  await page.evaluate(() => (window as unknown as { __tg: { answerPopup: (id: string) => void } }).__tg.answerPopup("delete"));
  await expect.poll(async () => (await saved(page)).groups.map((g) => g.id)).toEqual(["default-group"]);
  await expect(pill(page)).toHaveText("2 tabs");
});
