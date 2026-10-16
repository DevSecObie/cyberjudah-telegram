import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { auditContrast } from "./contrast-audit";
import { bibleAt, bibleReady } from "./telegram-harness";

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
      // The Bible is its own reader in a frame (Bible Strong's); the audit covers the app around it.
      if (path.includes("/read/")) { await bibleReady(page); await bibleAt(page, "Genesis 1").waitFor(); }
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
