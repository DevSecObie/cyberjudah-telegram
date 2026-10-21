import { expect, test, type Page } from "@playwright/test";

// Bible Strong's TagsScreen, TagOptionsPanel and useCreateTabGroupFromTag.
async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:bs_tags", JSON.stringify({ t1: { id: "t1", name: "Light", date: 1 }, t2: { id: "t2", name: "Ark", date: 2 }, t3: { id: "t3", name: "Zeal", date: 3 } }));
    // One highlight over two verses (made at one moment), and a note.
    localStorage.setItem("cj:bs_h_genesis_1", JSON.stringify({ "1": { color: "color1", date: 500, tags: { t1: true } }, "2": { color: "color1", date: 500, tags: { t1: true } } }));
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "3": { id: "n1", title: "Light was the first", description: "", date: 3000, tags: { t1: true } } }));
    localStorage.setItem("cj:bs_l_john_1", JSON.stringify({ "4": { id: "l1", url: "https://example.com", title: "A link", linkType: "website", date: 2000, tags: { t2: true } } }));
  });
  await page.goto("/tags");
}
const names = (page: Page) => page.locator(".tagitem__link b").allInnerTexts();
const filters = (page: Page) => page.getByRole("button", { name: /^(Filter|\d+ filters?)$/ });

test("tags list what each carries, and the filter sorts and searches them", async ({ page }) => {
  await seed(page);
  await expect.poll(() => names(page)).toEqual(["Ark", "Light", "Zeal"]);
  const light = page.locator(".tagitem", { hasText: "Light" });
  await expect(light.locator(".tagitem__chip")).toHaveText(["1 highlight", "1 note"]);
  await expect(page.locator(".tagitem", { hasText: "Ark" }).locator(".tagitem__chip")).toHaveText(["1 link"]);
  await expect(page.locator(".tagitem", { hasText: "Zeal" }).locator(".tagitem__chip")).toHaveCount(0);

  // Order, by how much each carries: the highlight's two verses and the note make three.
  await filters(page).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("button", { name: /^Order/ }).click();
  await page.getByRole("radio", { name: "Item count descending" }).click();
  await expect.poll(() => names(page)).toEqual(["Light", "Ark", "Zeal"]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "1 filter", exact: true })).toBeVisible();
  // Kept for the next visit.
  await page.reload();
  await expect.poll(() => names(page)).toEqual(["Light", "Ark", "Zeal"]);

  // Search, then Reset puts everything back.
  await filters(page).click();
  await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Search/ }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("zea");
  await expect.poll(() => names(page)).toEqual(["Zeal"]);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["Ark", "Light", "Zeal"]);
});

test("a tag's options rename it, make a tab group of what it carries, and remove it everywhere", async ({ page }) => {
  await seed(page);
  const light = page.locator(".tagitem", { hasText: "Light" });
  await light.getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Tag name" }).fill("Light of men");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["Ark", "Light of men", "Zeal"]);

  // Create tab group: a group named after the tag, a tab for the highlight and one for the note.
  await page.locator(".tagitem", { hasText: "Light of men" }).getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Create tab group", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1-2$/);
  await expect(page.locator(".toast", { hasText: "Group created with 2 tabs" })).toBeVisible();
  const group = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cj:tabgroups")!); const g = s.groups.find((x: { id: string }) => x.id === s.group); return { name: g.name, paths: g.tabs.map((t: { path: string }) => t.path) }; });
  expect(group).toEqual({ name: "Light of men", paths: ["/read/genesis/1?v=1-2", "/read/genesis/1?v=3"] });

  // Remove: asked first, then gone from the list and from the note and highlights it marked.
  await page.goto("/tags");
  page.once("dialog", (d) => void d.accept());
  await page.locator(".tagitem", { hasText: "Light of men" }).getByRole("button", { name: "More options" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["Ark", "Zeal"]);
  await expect.poll(() => page.evaluate(() => [localStorage.getItem("cj:bs_n_genesis_1"), localStorage.getItem("cj:bs_h_genesis_1")].join(" "))).not.toContain("t1");
});

test("+ adds a tag, and an empty search says so", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Add tag", exact: true }).click();
  await page.getByRole("textbox", { name: "Tag name" }).fill("Mercy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["Ark", "Light", "Mercy", "Zeal"]);
  await filters(page).click();
  await page.getByRole("dialog", { name: "Filters" }).getByRole("button", { name: /^Search/ }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("qqqq");
  await expect(page.getByText('No results found for "qqqq"')).toBeVisible();
});

test("a tag's page lists what it carries in sections that open when tapped", async ({ page }) => {
  await seed(page);
  await page.goto("/tags/t1");
  const highlights = page.getByRole("button", { name: /^Highlights\s*1$/ });
  const notes = page.getByRole("button", { name: /^Notes\s*1$/ });
  await expect(highlights).toHaveAttribute("aria-expanded", "false");
  await expect(notes).toBeVisible();
  await expect(page.locator(".tagd-item")).toHaveCount(0);
  await highlights.click();
  const item = page.locator(".tagd-item--verse");
  await expect(item.locator(".tagd-item__ref")).toContainText("1:1-2");
  await expect(item.locator(".tagd-item__head small")).toContainText("ago");
  await expect(item.locator(".tagd-chip")).toHaveText(["Light"]);
  await notes.click();
  await expect(page.locator(".tagd-item--note .tagd-item__title")).toHaveText("Light was the first");
  await expect(page.locator(".tagd-item--note .tagd-item__meta")).toContainText("1:3 - ");
  // A highlight opens the reader at its verses.
  await item.locator(".tagd-item__open").click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1-2$/);

  await page.goto("/tags/t2");
  await page.getByRole("button", { name: /^Links\s*1$/ }).click();
  await expect(page.locator(".tagd-item--link .tagd-link__title")).toHaveText("A link");
  await expect(page.locator(".tagd-item--link .tagd-link__url")).toHaveText("https://example.com");
  await page.goto("/tags/t3");
  await expect(page.getByText("You have not recorded anything with this label ...")).toBeVisible();
});

test("a tag's page never shows the empty message while what it carries is read", async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => { if (document.body?.textContent?.includes("You have not recorded anything")) (window as unknown as { __emptySeen: boolean }).__emptySeen = true; })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  await seed(page);
  await page.goto("/tags/t1");
  await expect(page.getByRole("button", { name: /^Highlights/ })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __emptySeen?: boolean }).__emptySeen ?? false)).toBe(false);
});
