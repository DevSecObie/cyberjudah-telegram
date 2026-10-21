import { expect, test, type Page } from "@playwright/test";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const seed = {
  bs_bm: [{ id: "bm1", name: "Creation", color: "#cc0000", book: "genesis", chapter: 1, verse: 2, date: 3000 }, { id: "bm2", name: "The beginning", color: "#0984e3", book: "genesis", chapter: 1, date: 1000 }],
  bs_h_exodus_2: { "10": { color: "color2", date: 5000, tags: { wisdom: true } } },
  bs_tags: { faith: { id: "faith", name: "Faith", date: 1 }, wisdom: { id: "wisdom", name: "Wisdom", date: 2 }, empty: { id: "empty", name: "Empty", date: 3 } },
  bs_h_genesis_1: { "1": { color: "color1", date: 1000, tags: { faith: true } }, "2": { color: "color1", date: 1000, tags: { faith: true, wisdom: true } } },
  bs_n_genesis_1: { "1/2": { id: "note-one", title: "A note about faith", description: "A synthetic note for this browser test.", date: 2000, tags: { faith: true } } },
  bs_l_genesis_1: { "3": { id: "link-one", title: "Study link", url: "https://example.com/study", linkType: "website", date: 3000, tags: { faith: true, wisdom: true } } },
};

async function setup(page: Page, theme = "light") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme === "dark" ? "dark" : "light" });
  await page.addInitScript(({ theme, seed }) => {
    if (!localStorage.getItem("kept-fixture")) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(`cj:${key}`, JSON.stringify(value));
      localStorage.setItem("kept-fixture", "1");
    }
    localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }));
  }, { theme, seed });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    if (r.request().url().endsWith("/api/kjv/books.json")) return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", testament: "Old Testament", chapters: 50, verses: 1533, chapterIds: [1, 2] }, { book: "Exodus", slug: "exodus", testament: "Old Testament", chapters: 40, verses: 1213, chapterIds: [1, 2] }, { book: "John", slug: "john", testament: "New Testament", chapters: 21, verses: 879, chapterIds: [1, 2] }] });
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
    for (const verse of [1, 2]) tx.objectStore("annotations").put({ id: `word-${verse}`, group: "word-group", verseKey: `genesis-1-${verse}`, start: 0, end: 3, quote: verse === 1 ? "In " : "And", style: "underline", color: "color2", created: "2026-10-01T00:00:00Z", note: { title: "A word note", description: "A synthetic annotation note.", date: 7000 }, tags: { faith: true, wisdom: true } });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  });
}

for (const theme of ["light", "dark"]) test(`kept lists screenshots: ${theme}`, async ({ page }) => {
  await setup(page, theme);
  for (const tab of ["bookmarks", "highlights", "notes"]) {
    await page.goto(`/bookmarks?tab=${tab}`);
    await expect(page.getByRole("heading", { name: tab === "bookmarks" ? "Bookmarks" : tab === "highlights" ? "Highlights" : "Notes", exact: true })).toBeVisible();
    await expect(page.locator(".row").filter({ hasText: tab === "bookmarks" ? "Creation" : tab === "highlights" ? "Genesis" : "A note about faith" }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `e2e/review/kept-lists/${process.env.REVIEW_PHASE || "after"}/${theme}-${tab}-390.png` });
  }
});

async function chooseFilter(page: Page, name: string, choice: string) {
  await page.getByRole('button', { name: /^(Filter|\d+ active filters)$/ }).click();
  await page.getByRole('dialog', { name: 'Filters', exact: true }).getByRole('button', { name: new RegExp(`^${name}( |$)`) }).click();
  await page.getByRole('dialog', { name, exact: true }).getByRole('button', { name: choice, exact: true }).click();
}
async function resetFilters(page: Page) {
  await page.getByRole('button', { name: /active filters/ }).click();
  await page.getByRole('dialog', { name: 'Filters', exact: true }).getByRole('button', { name: 'Reset', exact: true }).click();
}
async function search(page: Page, query: string) {
  await page.getByRole('button', { name: /^(Filter|\d+ active filters)$/ }).click();
  await page.getByRole('dialog', { name: 'Filters', exact: true }).getByRole('button', { name: /^Search( |$)/ }).click();
  const input = page.getByRole('searchbox', { name: 'Search', exact: true });
  await input.fill(query); await input.press('Enter');
}

test('highlights intersect color, book, tag, type and testament filters and remember Bible order', async ({ page }) => {
  await setup(page);
  await page.goto('/bookmarks?tab=highlights');
  await expect(page.locator('.kept-screen__highlight')).toHaveCount(3);
  await chooseFilter(page, 'Order', 'Bible order');
  await expect(page.locator('.kept-screen__reference')).toContainText(['Genesis 1:1-2', 'Genesis 1:1-2', 'Exodus 2:10']);
  await chooseFilter(page, 'Color', 'Color 2');
  await expect(page.locator('.kept-screen__highlight')).toHaveCount(2);
  await chooseFilter(page, 'Book', 'Genesis');
  await expect(page.locator('.kept-screen__highlight')).toHaveCount(1);
  await expect(page.locator('.kept-screen__highlight')).toHaveAttribute('data-kind', 'annotation');
  await page.reload();
  await expect(page.locator('.kept-screen__highlight')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '3 active filters' })).toBeVisible();
  await chooseFilter(page, 'Type', 'Highlights');
  await expect(page.getByText('No items match these filters.')).toBeVisible();
  await resetFilters(page);
  await chooseFilter(page, 'Tags', 'Faith');
  await expect(page.locator('.kept-screen__highlight')).toHaveCount(2);
  await chooseFilter(page, 'Testament', 'New Testament');
  await expect(page.getByText('No items match these filters.')).toBeVisible();
  await resetFilters(page);
  await page.locator('.kept-screen__highlight a').first().click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1/);
});

test('notes remember their query, order and tag independently; bookmarks keep a session query', async ({ page }) => {
  await setup(page);
  await page.goto('/bookmarks?tab=notes');
  await expect(page.locator(".kept-screen__note")).toHaveCount(2);
  await expect(page.locator(".kept-screen__note").filter({ hasText: "A word note" })).toHaveCount(1);
  await search(page, 'faith');
  await chooseFilter(page, 'Order', 'Title A–Z');
  await chooseFilter(page, 'Tags', 'Faith');
  await page.reload();
  await expect(page.locator('.kept-screen__note')).toContainText('A note about faith');
  await expect(page.getByRole('button', { name: '3 active filters' })).toBeVisible();
  await page.getByRole('tab', { name: 'Highlights', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Bookmarks', exact: true }).click();
  await search(page, 'genesis 1:2');
  await expect(page.locator('.kept-screen__bookmark')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.kept-screen__bookmark')).toHaveCount(2);
  await page.goto('/bookmarks?tab=notes');
  await expect(page.getByRole('button', { name: '3 active filters' })).toBeVisible();
  await resetFilters(page);
  await search(page, 'unknown');
  await expect(page.getByText('No results found for "unknown"')).toBeVisible();
});

test('bookmark options open the Bible, edit through BookmarkSheet, cancel and confirm removal', async ({ page }) => {
  await setup(page);
  await page.goto('/bookmarks');
  await page.getByRole('button', { name: 'Options for Creation' }).click();
  await page.getByRole('button', { name: 'View in Bible', exact: true }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2/);
  await page.goto('/bookmarks');
  await page.getByRole('button', { name: 'Options for Creation' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Bookmark name' }).fill('First light');
  await page.getByRole('radio', { name: '#0984e3', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.kept-screen__bookmark').first()).toContainText('First light');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cj:bs_bm')!)[0])).toMatchObject({ name: 'First light', color: '#0984e3', verse: 2 });
  const remove = async () => { await page.getByRole('button', { name: 'Options for First light' }).click(); await page.getByRole('button', { name: 'Remove', exact: true }).click(); };
  await remove();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.kept-screen__bookmark')).toHaveCount(2);
  await remove();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.kept-screen__bookmark')).toHaveCount(1);
});
