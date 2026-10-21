import { expect, test, type Page } from "@playwright/test";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const seed = {
  bs_tags: { faith: { id: "faith", name: "Faith", date: 1 }, wisdom: { id: "wisdom", name: "Wisdom", date: 2 }, empty: { id: "empty", name: "Empty", date: 3 } },
  bs_h_genesis_1: { "1": { color: "color1", date: 1000, tags: { faith: true } }, "2": { color: "color1", date: 1000, tags: { faith: true, wisdom: true } } },
  bs_n_genesis_1: { "1/2": { id: "note-one", title: "A note about faith", description: "A synthetic note for this browser test.", date: 2000, tags: { faith: true } } },
  bs_l_genesis_1: { "3": { id: "link-one", title: "Study link", url: "https://example.com/study", linkType: "website", date: 3000, tags: { faith: true, wisdom: true } } },
};

async function setup(page: Page, theme = "light") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme === "dark" ? "dark" : "light" });
  await page.addInitScript(({ theme, seed }) => {
    if (!localStorage.getItem("tags-fixture")) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(`cj:${key}`, JSON.stringify(value));
      localStorage.setItem("tags-fixture", "1");
    }
    localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }));
  }, { theme, seed });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    if (r.request().url().endsWith("/api/kjv/books.json")) return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", testament: "Old Testament", chapters: 2, verses: 62, chapterIds: [1, 2] }] });
    if (r.request().url().includes("/api/kjv/genesis/")) return r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void." }] } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto("/new");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("cyberjudah-personal-study", 1);
      request.onupgradeneeded = () => { const d = request.result; d.createObjectStore("studies", { keyPath: "id" }); d.createObjectStore("annotations", { keyPath: "id" }).createIndex("verse", "verseKey"); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const tx = db.transaction("annotations", "readwrite");
    for (const verse of [1, 2]) tx.objectStore("annotations").put({ id: `word-${verse}`, group: "word-group", verseKey: `genesis-1-${verse}`, start: 0, end: 3, quote: verse === 1 ? "In " : "And", style: "underline", color: "color2", created: "2026-10-01T00:00:00Z", tags: { faith: true, wisdom: true } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
}

for (const theme of ["light", "dark"]) test(`tags screenshots: ${theme}`, async ({ page }) => {
  await setup(page, theme);
  await page.goto("/tags");
  await expect(page.getByRole("link", { name: /Faith/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Faith/ })).toContainText("note");
  await page.screenshot({ path: `e2e/review/tags/${process.env.REVIEW_PHASE || "after"}/${theme}-list-390.png` });
  await page.getByRole("link", { name: /Faith/ }).click();
  await expect(page.getByRole("heading", { name: "Faith", exact: true })).toBeVisible();
  await page.screenshot({ path: `e2e/review/tags/${process.env.REVIEW_PHASE || "after"}/${theme}-detail-390.png` });
});

test("tags search, sort, and restore the saved query", async ({ page }) => {
  await setup(page);
  await page.goto("/tags");
  await expect(page.getByRole("link", { name: /Faith/ })).toContainText("2 highlights");
  await expect(page.getByRole("link", { name: /Faith/ })).toContainText("1 link");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: /^Order/ }).click();
  await page.getByRole("button", { name: "Item count descending", exact: true }).click();
  await expect(page.locator(".tag-screen__row .row__title")).toHaveText(["Faith", "Wisdom", "Empty"]);
  await page.getByRole("button", { name: /active filters/ }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search a tag" }).fill("fai");
  await page.getByRole("searchbox", { name: "Search a tag" }).press("Enter");
  await expect(page.locator(".tag-screen__row")).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: /active filters/ }).click();
  await expect(page.getByRole("button", { name: "Search fai" })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.locator(".tag-screen__row .row__title")).toHaveText(["Empty", "Faith", "Wisdom"]);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("dialog", { name: "Filters", exact: true }).getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search a tag" }).fill("unknown");
  await page.getByRole("searchbox", { name: "Search a tag" }).press("Enter");
  await expect(page.getByText('No results found for "unknown"')).toBeVisible();
});

test("tag sections start collapsed and include every supported kind", async ({ page }) => {
  await setup(page);
  await page.goto("/tags/faith");
  await expect(page.getByRole("button", { name: "Highlights 2", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tag-screen__item")).toHaveCount(0);
  for (const section of ["Highlights 2", "Notes 1", "Links 1"]) await page.getByRole("button", { name: section, exact: true }).click();
  await expect(page.locator(".tag-screen__item")).toHaveCount(4);
  await expect(page.locator(".tag-screen__item--word")).toContainText("In … And");
  await expect(page.locator(".tag-screen__item--highlight")).toContainText("Genesis 1:1-2");
  await expect(page.locator(".tag-screen__item--note")).toContainText("A note about faith");
  await expect(page.locator(".tag-screen__item--link")).toContainText("https://example.com/study");
  await page.locator(".tag-screen__item--word a").click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1/);
});

test("rename and delete preserve content and remove the tag from links and grouped word marks", async ({ page }) => {
  await setup(page);
  await page.goto("/tags/faith");
  await page.getByRole("button", { name: "Options for Faith" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Tag name" }).fill("Trust");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trust", exact: true })).toBeVisible();
  const remove = async () => { await page.getByRole("button", { name: "Options for Trust" }).click(); await page.getByRole("button", { name: "Remove", exact: true }).click(); };
  await remove();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trust", exact: true })).toBeVisible();
  await remove();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(page).toHaveURL(/\/tags$/);
  const stored = await page.evaluate(async () => {
    const records = ['h', 'n', 'l'].flatMap(kind => Object.values(JSON.parse(localStorage.getItem(`cj:bs_${kind}_genesis_1`)!)));
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("cyberjudah-personal-study", 1); request.onsuccess = () => resolve(request.result); });
    const annotations = await new Promise<unknown[]>(resolve => { const request = db.transaction("annotations").objectStore("annotations").getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    return { tags: JSON.parse(localStorage.getItem("cj:bs_tags")!), records, annotations };
  });
  expect(stored.tags.faith).toBeUndefined();
  expect(stored.tags.wisdom.name).toBe("Wisdom");
  expect(stored.records).toHaveLength(4);
  expect(stored.annotations).toHaveLength(2);
  for (const item of [...stored.records, ...stored.annotations] as { tags: Record<string, boolean> }[]) expect(item.tags.faith).toBeUndefined();
  for (const item of stored.annotations as { tags: Record<string, boolean> }[]) expect(item.tags.wisdom).toBe(true);
});
