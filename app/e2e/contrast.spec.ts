import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { auditContrast } from "./contrast-audit";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dcontrast-layout&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const ROUTES = ["/", "/read/genesis/1", "/classes", "/books", "/timeline", "/people", "/ask", "/settings", "/bookmarks", "/search", "/tabs", "/plan", "/precepts", "/settings/reminders", "/more"];
for (const theme of ["default", "dark", "sepia", "nature", "sunset", "black", "mauve", "night"]) for (const increased of [false, true]) {
  test(`contrast: ${theme} ${increased ? "increased" : "standard"} on every main route`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ contrast: increased ? "more" : "no-preference", reducedMotion: "reduce" });
    await page.addInitScript(theme => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: ["dark", "black", "mauve", "night"].includes(theme) ? "dark" : "light", preferredLightTheme: theme, preferredDarkTheme: theme }) }; }, theme);
    await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
    await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
    const report = [];
    for (const path of ROUTES) {
      await page.goto(`${path}${LAUNCH}`);
      await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
      if (path.includes("/read/")) await page.locator("#verset-1").waitFor();
      else if (path === "/tabs") await page.getByRole("toolbar", { name: "Tabs" }).waitFor();
      else if (path === "/search") await page.getByRole("searchbox", { name: "Search CyberJudah" }).waitFor();
      else await page.locator(".route").getByRole("heading").first().waitFor();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
      const canvasColor = await page.evaluate(() => {
        const probe = document.createElement("span"); probe.style.color = "var(--canvas)"; document.body.append(probe);
        const color = getComputedStyle(probe).color; probe.remove(); return color;
      });
      await expect(page.locator("body")).toHaveCSS("background-color", canvasColor);
      if (path.includes("/read/")) {
        const ink = await page.locator(".bs").evaluate(el => {
          const probe = document.createElement("span"); probe.style.color = "var(--bs-default)"; el.append(probe);
          const color = getComputedStyle(probe).color; probe.remove(); return color;
        });
        await expect(page.locator("#verset-1 .bs-text")).toHaveCSS("color", ink);
      }
      // WebKit can retain pre-palette descendant styles after the root changes. Require
      // the rendered palette to settle; every sample keeps the same contrast thresholds.
      let result = await page.evaluate(auditContrast, {});
      await expect(async () => {
        result = await page.evaluate(auditContrast, {});
        expect(result.failures, `${theme} ${increased} ${path}`).toEqual([]);
      }).toPass({ timeout: 5000, intervals: [100, 250, 500] });
      report.push({ path, ...result });
      expect(result.pairs).toBeGreaterThanOrEqual(76);
    }
    const file = info.outputPath("contrast-report.json"); fs.writeFileSync(file, JSON.stringify({ theme, increased, routes: report }, null, 2));
    await info.attach("contrast-report", { path: file, contentType: "application/json" });
  });
}

test("contrast: the live OS preference overrides saved ink and restores it without changing preferences", async ({ page }) => {
  await page.addInitScript(() => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: "light", preferredLightTheme: "sepia", preferredDarkTheme: "night", colors: { color1: "#123456" } }) }; });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.goto(`/read/genesis/1${LAUNCH}`); await page.locator("#verset-1").waitFor();
  const stored = await page.evaluate(() => (window as any).__cloud.bs);
  const normal = await page.locator("#verset-1 .bs-text").evaluate(el => getComputedStyle(el).color);
  await page.emulateMedia({ contrast: "more" });
  await expect(page.locator("#verset-1 .bs-text")).not.toHaveCSS("color", normal);
  await expect(page.locator("#verset-1 .bs-text")).toHaveCSS("color", "rgb(32, 20, 7)");
  expect(await page.evaluate(() => (window as any).__cloud.bs)).toBe(stored);
  expect(await page.locator(".bs").evaluate(el => getComputedStyle(el).getPropertyValue("--bs-color1").trim())).toBe("#123456");
  await page.emulateMedia({ contrast: "no-preference" });
  await expect(page.locator("#verset-1 .bs-text")).toHaveCSS("color", normal);
  expect(await page.evaluate(() => (window as any).__cloud.bs)).toBe(stored);
  expect(await page.locator(".bs").evaluate(el => getComputedStyle(el).getPropertyValue("--bs-color1").trim())).toBe("#123456");
});

for (const theme of ["default", "dark", "sepia", "nature", "sunset", "black", "mauve", "night"]) for (const increased of [false, true]) {
  test(`contrast: ${theme} ${increased ? "increased" : "standard"} reader interactions keep context and panels readable`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ contrast: increased ? "more" : "no-preference", reducedMotion: "reduce" });
    await page.addInitScript(theme => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: ["dark", "black", "mauve", "night"].includes(theme) ? "dark" : "light", preferredLightTheme: theme, preferredDarkTheme: theme }) }; }, theme);
    await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
    await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
    const check = async () => {
      if (await page.locator(".bs-gallery").count()) {
        const canvas = await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);
        await expect(page.locator(".bs-gallery")).toHaveCSS("background-color", canvas);
      }
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
      await expect(async () => {
        const result = await page.evaluate(auditContrast, { includePanels: true });
        expect(result.textNodes).toBeGreaterThan(20);
        expect(result.failures).toEqual([]);
      }).toPass({ timeout: 5000, intervals: [100, 250, 500] });
    };
    await page.goto(`/read/genesis/1${LAUNCH}`);
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    await page.locator("#verset-1").click();
    await expect(page.locator(".bs-selected")).toBeVisible();
    await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
    await expect(page.locator("#verset-2")).not.toHaveAttribute("data-selected");
    await check();
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-selected")).toHaveCount(0);
    await page.locator(".bs-pill--version").click();
    await expect(page.locator(".bs-versionrow__id")).toHaveText("KJV");
    await check();
    await page.keyboard.press("Escape");
    await page.goto(`/read/genesis/4${LAUNCH}`);
    await page.locator(".bs-entities__stack").click();
    await expect(page.getByRole("dialog", { name: "People in this chapter" })).toBeVisible();
    await expect(page.locator(".bs-people__text small").first()).toContainText("verse");
    await check();
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-gallery")).toHaveCount(0);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    const deck = page.locator("#verset-28 .bs-deck");
    // Scrolling this distant verse can collapse the header. Let the subsequent click
    // check the button's settled position after that scroll, especially in WebKit.
    await deck.scrollIntoViewIfNeeded();
    await deck.click();
    await expect(page.locator(".bs-gallery__text small").first()).toContainText(/Bishop|Deacon/);
    await check();
  });
}
