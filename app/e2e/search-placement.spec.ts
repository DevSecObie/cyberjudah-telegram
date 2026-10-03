import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dsearch-placement&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
async function setup(page: Page, nav = ["home", "search", "bible", "classes", "ask", "tabs"], theme = "default", reduced = false) {
  await page.addInitScript(({ nav, theme, reduced }) => {
    (window as any).__cloud = { nav: JSON.stringify(nav), bs: JSON.stringify({ preferredColorScheme: theme === "dark" ? "dark" : "light", preferredLightTheme: theme, preferredDarkTheme: theme }), transparency: JSON.stringify(reduced ? "reduced" : "system") };
  }, { nav, theme, reduced });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}

for (const saved of [["search", "home", "bible"], ["home", "bible", "classes", "ask", "library", "tabs"], ["search"]]) {
  test(`search placement: derives the trailing control without changing ${saved.join(",")}`, async ({ page }) => {
    await setup(page, saved);
    await page.goto(`/settings/bar${LAUNCH}`);
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav.locator(".tab").last()).toHaveAttribute("aria-label", "Search");
    await expect(nav.getByRole("button", { name: "Search", exact: true })).toHaveCount(1);
    expect(await nav.locator(".tab").evaluateAll(buttons => buttons.map(b => (b as HTMLElement).dataset.nav))).toEqual([...saved.filter(id => id !== "search"), "more", "search"]);
    await expect(page.getByRole("button", { name: "Remove Search", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse((window as any).__tg.cloud.nav))).toEqual(saved);
    for (const width of [320, 390, 900, 1280]) for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(scale => document.documentElement.style.fontSize = `${scale}%`, scale);
      const search = nav.getByRole("button", { name: "Search", exact: true });
      await search.scrollIntoViewIfNeeded();
      const box = (await search.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.width - box.height)).toBeLessThan(1);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await nav.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "Search CyberJudah" })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse((window as any).__tg.cloud.nav))).toEqual(saved);
  });
}

test("search placement: Search stays available in the minimized dock and the tab switcher", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings${LAUNCH}`);
  const nav = page.getByRole("navigation", { name: "Sections" });
  await page.getByRole("switch", { name: "Justify the text", exact: true }).hover();
  await page.mouse.wheel(0, 300);
  await expect(nav).toHaveAttribute("data-mini", "");
  await nav.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("searchbox", { name: "Search CyberJudah" })).toBeVisible();
  await page.goto(`/tabs${LAUNCH}`);
  const switcher = page.getByRole("navigation", { name: "Tabs", exact: true });
  await expect(switcher.getByRole("button").last()).toHaveAttribute("aria-label", "Search");
  await switcher.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
});

for (const theme of ["default", "dark", "sepia"]) {
  test(`search placement: ${theme} remains usable at 200% with accessibility preferences`, async ({ page, browserName }) => {
    await setup(page, undefined, theme);
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/search${LAUNCH}`);
    const field = page.getByRole("searchbox", { name: "Search CyberJudah" });
    await expect(field).toBeFocused();
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
    for (const mode of ["normal", "app", "system", "motion", "contrast", "forced"]) {
      // Playwright cannot emulate the OS transparency preference in WebKit; the app fallback runs there.
      if (mode === "system" && !cdp) continue;
      await page.emulateMedia({ reducedMotion: mode === "motion" ? "reduce" : "no-preference", contrast: mode === "contrast" ? "more" : "no-preference", forcedColors: mode === "forced" ? "active" : "none" });
      await page.evaluate(mode => { if (mode === "app") document.documentElement.dataset.transparency = "reduced"; else delete document.documentElement.dataset.transparency; }, mode);
      if (cdp) await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: mode === "system" ? "reduce" : "no-preference" }, { name: "prefers-reduced-motion", value: mode === "motion" ? "reduce" : "no-preference" }, { name: "prefers-contrast", value: mode === "contrast" ? "more" : "no-preference" }, { name: "forced-colors", value: mode === "forced" ? "active" : "none" }] });
      const box = (await field.boundingBox())!;
      expect(box.width, mode).toBeGreaterThan(100); expect(box.y, mode).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, mode).toBeLessThanOrEqual(320);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), mode).toBe(true);
      await expect(page.locator(".srch__cancel")).toBeVisible();
      const search = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true });
      await expect(search).toBeVisible();
      if (["app", "system", "contrast", "forced"].includes(mode)) {
        for (const selector of [".srch__bar--dock", "nav.tabs"]) expect(await page.locator(selector).evaluate(el => { const s = getComputedStyle(el, "::before"); return s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter"); }), `${mode} ${selector}`).toBe("none");
      }
      if (mode === "motion") await expect(page.locator(".srch__bar--dock")).toHaveCSS("transition-property", "none");
    }
    await cdp?.detach();
  });
}

for (const theme of ["default", "dark", "sepia"]) for (const source of ["visual viewport", "Telegram", "layout viewport"] as const) {
  test(`search placement: ${theme} follows the ${source} keyboard and restores the dock`, async ({ page }) => {
    await setup(page, undefined, theme, theme === "sepia");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: theme === "sepia" ? "reduce" : "no-preference", contrast: theme === "dark" ? "more" : "no-preference" });
    await page.goto(`/search${LAUNCH}`);
    const field = page.getByRole("searchbox", { name: "Search CyberJudah" }), bar = page.locator(".srch__bar--dock");
    await expect(field).toBeFocused();
    const resultsTop = await page.locator("#srch-results").evaluate(el => el.getBoundingClientRect().top);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-bottom", "19px");
      document.documentElement.style.setProperty("--safe-left", "13px");
      document.documentElement.style.setProperty("--safe-right", "11px");
    });
    for (const height of [600, 480, 540]) {
      if (source === "layout viewport") await page.setViewportSize({ width: 390, height });
      else await page.evaluate(({ source, height }) => {
        if (source === "visual viewport") {
          Object.defineProperty(window.visualViewport, "height", { configurable: true, value: height });
          window.visualViewport!.dispatchEvent(new Event("resize"));
        } else { (window as any).Telegram.WebApp.viewportHeight = height; (window as any).__tg.fire("viewportChanged", { isStateStable: false }); }
      }, { source, height });
      await expect(bar).toHaveAttribute("data-keyboard", "");
      await expect.poll(async () => { const b = (await bar.boundingBox())!; return b.y + b.height; }).toBeLessThanOrEqual(height);
      const box = (await field.boundingBox())!;
      expect(box.y).toBeGreaterThan(0); expect(box.x).toBeGreaterThanOrEqual(13); expect(box.x + box.width).toBeLessThanOrEqual(379);
      await expect(field).toBeFocused();
      expect(await page.locator("#srch-results").evaluate(el => el.getBoundingClientRect().top)).toBe(resultsTop);
    }
    if (source === "layout viewport") await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      delete (window.visualViewport as any).height;
      (window as any).Telegram.WebApp.viewportHeight = innerHeight;
      window.visualViewport!.dispatchEvent(new Event("resize"));
      (window as any).__tg.fire("viewportChanged", { isStateStable: true });
    });
    await expect(bar).not.toHaveAttribute("data-keyboard");
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Classes", exact: true }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-search-keyboard");
  });
}
