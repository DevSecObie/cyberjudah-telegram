import { expect, test, type Page } from "@playwright/test";
import { DATA_ORIGIN, LAUNCH, setup } from "./telegram-harness";

/** The query keys saved on the device. Read only once the app has opened its database. */
const savedKeys = (page: Page) => page.evaluate(() => new Promise<string[]>((done) => {
  const open = indexedDB.open("cyberjudah-query-cache");
  open.onerror = () => done([]);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains("state")) { db.close(); return done([]); }
    const get = db.transaction("state").objectStore("state").get("queries");
    get.onsuccess = () => { db.close(); done(((get.result?.queries ?? []) as { queryKey: unknown[] }[]).map((q) => String(q.queryKey[0]))); };
  };
}));

test("public data saved on the device opens Home and the reader at once, without the network", async ({ page }) => {
  await setup(page);
  await page.route("**/api/verse-of-day*", (r) => r.fulfill({ json: { ref: "Genesis 1:1", slug: "genesis", chapter: 1, verse: 1, text: "In the beginning God created the heaven and the earth." } }));
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".drawer--home .today-card[data-active]")).toContainText("Genesis 1:1");
  await expect.poll(() => savedKeys(page), { timeout: 10_000 }).toEqual(expect.arrayContaining(["books", "chapter", "votd"]));
  // Nothing personal is ever written.
  for (const key of await savedKeys(page)) expect(["books", "votd", "recent", "teachings", "shows", "class-broadcasts", "topics", "precepts", "chapter", "xref", "cites"]).toContain(key);

  // The next launch has no data: the saved copy paints, and the failed refresh doesn't replace it.
  // Playwright tries the last route first, so these replace the data served above.
  await page.route("**/api/verse-of-day*", (r) => r.abort());
  await page.route(`${DATA_ORIGIN}/api/kjv/**`, (r) => r.abort());
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toContainText("In the beginning");
  // Home may come back open over the reader, as it was left.
  const home = page.locator(".drawer--home");
  if (!(await home.isVisible())) await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(home.locator(".today-card[data-active]")).toContainText("Genesis 1:1");
});
