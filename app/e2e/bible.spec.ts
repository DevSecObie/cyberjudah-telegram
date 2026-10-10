import { expect, test, type Page } from "@playwright/test";
import { bibleAt, bibleFrame, bibleReady, goInApp, LAUNCH, setup } from "./telegram-harness";

/**
 * The Bible screen: Bible Strong's reader (strong/, at /app/strong) in one frame the app keeps
 * loaded (app/src/bible/BibleFrame.tsx). The app moves it by message; the reader sends its links
 * back to the app as navigation (strong/…/cyberjudahBridge.ts).
 */
async function open(page: Page, path: string) {
  await setup(page);
  await page.goto(path + LAUNCH);
  await bibleReady(page);
}

/** Marks the frame's window, so a reload (a new window) would lose the mark. */
const tag = (page: Page) => page.locator('iframe[title="Bible"]').evaluate((f: HTMLIFrameElement) => { (f.contentWindow as unknown as { __kept: string }).__kept = "same"; });
const tagged = (page: Page) => page.locator('iframe[title="Bible"]').evaluate((f: HTMLIFrameElement) => (f.contentWindow as unknown as { __kept?: string }).__kept ?? null);

test("a passage link opens the reader at that chapter once the lion has gone", async ({ page }) => {
  await open(page, "/read/john/3?v=16");
  await expect(bibleAt(page, "John 3")).toBeVisible();
  await expect(bibleFrame(page).locator('[data-verse-key="43-3-16"]').first()).toBeVisible();
  await expect(page.locator(".strong-reader")).not.toHaveClass(/strong-reader--away/);
});

test("Home and the Bible tab keep the one reader, and a chapter link moves it without a reload", async ({ page }) => {
  await open(page, "/read/john/3?v=16");
  await expect(bibleAt(page, "John 3")).toBeVisible();
  await tag(page);
  await goInApp(page, "/");
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.locator(".strong-reader")).toHaveClass(/strong-reader--away/);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Bible", exact: true }).click();
  await expect(page).toHaveURL(/\/(read|bible)/);
  await expect(page.locator(".strong-reader")).not.toHaveClass(/strong-reader--away/);
  await expect(bibleAt(page, "John 3")).toBeVisible();
  expect(await tagged(page)).toBe("same");
  await expect(page.locator('iframe[title="Bible"]')).toHaveCount(1);

  await goInApp(page, "/read/john/4?v=7");
  await expect(bibleAt(page, "John 4")).toBeVisible();
  await expect(bibleFrame(page).locator('[data-verse-key="43-4-7"]').first()).toBeVisible();
  expect(await tagged(page)).toBe("same");
  await expect(page.locator('iframe[title="Bible"]')).toHaveCount(1);
});

test("a passage opened from Home after the reader has loaded shows that passage", async ({ page }) => {
  await open(page, "/");
  await tag(page);
  await goInApp(page, "/read/john/4?v=7");
  await expect(bibleAt(page, "John 4")).toBeVisible();
  expect(await tagged(page)).toBe("same");
});

test("Genesis 1 shows its precepts; the Precepts sheet's class line opens the app's class note", async ({ page }) => {
  await open(page, "/read/genesis/1?v=1");
  await expect(bibleAt(page, "Genesis 1")).toBeVisible();
  // Under a verse: a note chip for its precepts, then a chip per precept scripture and per class.
  const notes = bibleFrame(page).getByLabel(/^Precepts? for verse \d+$/);
  await expect(notes.first()).toBeVisible();
  expect(await notes.count()).toBeGreaterThan(3);
  await bibleFrame(page).getByLabel("Precepts for verse 1", { exact: true }).click();
  const sheet = bibleFrame(page);
  await expect(sheet.getByRole("heading", { name: "Genesis 1:1", exact: true }).first()).toBeVisible();
  await expect(sheet.getByText("2 Esdras 6:38", { exact: true }).last()).toBeVisible();
  // Each card names its class and the moment: that line opens the class note in the app.
  await sheet.getByText(/^The Kingdom Of Adam And The Old World · .* · 2:37:09$/).first().click();
  await expect(page).toHaveURL((url) => url.pathname.startsWith("/note/classes/") && url.searchParams.has("t"));
  await expect(page.locator(".strong-reader")).toHaveClass(/strong-reader--away/);
});

test("a precept's scripture chip opens that passage in the reader, and a class chip plays the class", async ({ page }) => {
  await open(page, "/read/genesis/1?v=1");
  await expect(bibleAt(page, "Genesis 1")).toBeVisible();
  await tag(page);
  // The passage opens over the chapter in the same reader, as Bible Strong opens a reference.
  await bibleFrame(page).getByLabel("John 1:4", { exact: true }).first().click();
  await expect(bibleFrame(page).getByText("John 1:4 - KJV", { exact: true })).toBeVisible();
  await expect(bibleFrame(page).locator('[data-verse-key="43-1-4"]').first()).toBeVisible();
  expect(await tagged(page)).toBe("same");
  await goInApp(page, "/read/genesis/1?v=25");
  await expect(bibleAt(page, "Genesis 1")).toBeVisible();
  await bibleFrame(page).getByLabel("My Temple My Choice", { exact: true }).first().click();
  await expect(page).toHaveURL((url) => /^\/watch\/[A-Za-z0-9_-]{11}$/.test(url.pathname) && url.searchParams.has("t"));
});
