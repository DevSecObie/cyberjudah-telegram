import { expect, test } from "@playwright/test";
import { LAUNCH, setup, goInApp } from "./telegram-harness";

test.beforeEach(async ({ page }) => setup(page));

// Root launches must stay in the app, including when Telegram reuses a webview.
for (const root of ["/", "/app/"]) {
  test(`root launch: Telegram opens Home at ${root}`, async ({ page }) => {
    await page.goto(`${root}${LAUNCH}`);
    await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search the teachings" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Ask CyberJudah" })).toBeVisible();
    await expect(page.locator(".welcome .today-card, .welcome .stats")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(root);
    expect(await page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.filter(([name]) => name === "openTelegramLink"))).toEqual([]);
  });

  test(`root launch: a plain browser opens Home at ${root}`, async ({ page }) => {
    await page.goto(root);
    await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search the teachings" })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Ask CyberJudah" })).toBeVisible();
    await expect(page.locator(".welcome .today-card, .welcome .stats")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(root);
  });

  test(`root launch: each startapp link opens its destination at ${root}`, async ({ page }) => {
    // Telegram delivers a t.me startapp value as tgWebAppStartParam to the webview.
    await page.goto(`${root}?tgWebAppStartParam=john_3_16${LAUNCH}&tgWebAppStartParam=john_3_16`);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`${root}read/john/3`);
    await page.evaluate(() => sessionStorage.setItem("launch-session", "same-webview"));
    await page.goto(`${root}?tgWebAppStartParam=psalms_23${LAUNCH}&tgWebAppStartParam=psalms_23`);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`${root}read/psalms/23`);
    expect(await page.evaluate(() => sessionStorage.getItem("launch-session"))).toBe("same-webview");
    await goInApp(page, root);
    await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(root);
  });

  test(`root launch: an explicit screen survives a retained parameter at ${root}`, async ({ page }) => {
    await page.goto(`${root}settings${LAUNCH}&tgWebAppStartParam=john_3_16`);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${root}settings`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${root}settings`);
  });
}


test("a reopened tab stays covered until the app lock's preference is read", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __secureHold: boolean }).__secureHold = true;
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "mine", tabs: [{ id: "mine", path: "/bookmarks" }] }] }));
  });
  await page.goto(`/${LAUNCH}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/bookmarks");
  // The lock is still being checked: the cover hides the reopened screen.
  await expect(page.locator(".lock[data-checking]")).toBeVisible();
  // The lock is off: once the preference is read, the cover lifts and the screen shows.
  await page.evaluate(() => (window as unknown as { __releaseSecure: () => void }).__releaseSecure());
  await expect(page.locator(".lock")).toHaveCount(0);
});

/** Whether the element can be reached: not inside anything made inert. */
const reachable = (page: import("@playwright/test").Page, sel: string) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!el && !el.closest("[inert]"); }, sel);

test("nothing behind the app lock can be reached, while it checks and while it is locked", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __secureHold: boolean; __secure: Record<string, string>; __biometricHold: boolean };
    w.__secureHold = true; w.__secure = { lock: "on" }; w.__biometricHold = true;
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "mine", tabs: [{ id: "mine", path: "/bookmarks" }] }] }));
  });
  await page.goto(`/${LAUNCH}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/bookmarks");
  // Checking: the cover is up, and the screen behind it is inert and hidden from assistive technology.
  await expect(page.locator(".lock[data-checking]")).toBeVisible();
  expect(await reachable(page, ".route")).toBe(false);
  // Locked: only the lock can be reached.
  await page.evaluate(() => (window as unknown as { __releaseSecure: () => void }).__releaseSecure());
  const lock = page.getByRole("dialog", { name: "Locked" });
  await expect(lock).toBeVisible();
  expect(await reachable(page, ".lock button")).toBe(true);
  expect(await reachable(page, ".route")).toBe(false);
  expect(await reachable(page, "nav.tabs")).toBe(false);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  // Unlocked: the page comes back.
  await page.evaluate(() => (window as unknown as { __releaseBiometric: () => void }).__releaseBiometric());
  await expect(lock).toHaveCount(0);
  await expect.poll(() => reachable(page, ".route")).toBe(true);
  await expect.poll(() => reachable(page, "nav.tabs")).toBe(true);
});
