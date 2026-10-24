import { expect, test } from "@playwright/test";
import { DATA_ORIGIN, LAUNCH, setup, goInApp } from "./telegram-harness";

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

test.describe("website deep links", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const classPath = "/classes/2026/2026-01-19-the-punishments-and-promises-of-job";
  const classParam = "classes_2026_2026-01-19-the-punishments-and-promises-of-job";
  const title = "The Punishments and Promises of Job";

  test.beforeEach(async ({ page }) => {
    await page.route(`${DATA_ORIGIN}/**`, r => {
      const path = new URL(r.request().url()).pathname;
      if (path === `/api/notes${classPath}.json`) return r.fulfill({ json: { kind: "class", title, url: classPath, body: "## Class notes\n\nThe class linked in the shared message." } });
      if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "John", slug: "john", chapters: 3, verses: 31, chapterIds: [1, 2, 3] }] });
      if (path === "/api/kjv/john/3.json") return r.fulfill({ json: { book: "John", chapter: 3, translation: "KJV", verses: Array.from({ length: 31 }, (_, i) => ({ verse: i + 1, text: `Scripture fixture ${i + 1}.` })) } });
      return r.fulfill({ status: 404, body: "" });
    });
  });

  for (const root of ["/", "/app", "/app/"]) {
    const base = root === "/" ? "/" : "/app/";
    for (const telegram of [false, true]) {
      const launch = telegram ? LAUNCH : "";
      const client = telegram ? "Telegram" : "browser";
      for (const theme of ["light", "dark"]) test(`class link at ${root} (${client}, ${theme})`, async ({ page }, testInfo) => {
        await page.addInitScript(theme => localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" })), theme);
        await page.goto(`${root}?startapp=${classParam}${launch}`);
        await expect(page).toHaveURL(`${base}note${classPath}`);
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(page.getByText("The class linked in the shared message.", { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        if (root === "/app" && !telegram) {
          await page.evaluate(async () => { await document.fonts.ready; });
          await testInfo.attach(`class-link-${theme}`, { body: await page.screenshot(), contentType: "image/png" });
        }
      });

      test(`verse ranges at ${root} (${client})`, async ({ page }) => {
        await page.goto(`${root}?startapp=bible_john_3_16-18x20${launch}`);
        await expect(page).toHaveURL(`${base}read/john/3?v=16-18,20`);
        for (const verse of [16, 17, 18, 20]) await expect(page.locator(`#verset-${verse}`)).toBeVisible();
        await expect(page.locator("#verset-19")).toHaveCount(0);
      });
    }

    test(`an explicit route wins over startapp at ${root}`, async ({ page }) => {
      await page.goto(`${base}settings?startapp=${classParam}`);
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`${base}settings`);
    });
  }

  test("Telegram launch parameters take precedence over website parameters", async ({ page }) => {
    await page.goto(`/app?startapp=${classParam}&tgWebAppStartParam=settings`);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page).toHaveURL("/app/settings");
    await page.goto(`/app?startapp=${classParam}&tgWebAppStartParam=privacy${LAUNCH}&tgWebAppStartParam=settings`);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page).toHaveURL("/app/settings");
  });

  test("invalid website parameters stay on Home and never navigate off site", async ({ page }) => {
    for (const param of ["", "https://example.com", "//example.com", "../settings", "x".repeat(513)]) {
      await page.goto(`/app?startapp=${encodeURIComponent(param)}`);
      await expect(page.getByRole("heading", { name: "What do you want to learn?" })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe("/app/");
      expect(new URL(page.url()).searchParams.get("startapp")).toBe(param);
    }
  });
});


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
