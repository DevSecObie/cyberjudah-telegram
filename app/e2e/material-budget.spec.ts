import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { filteredSurfaces } from "./material-surfaces";
import { bibleReady } from "./telegram-harness";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dmaterial-budget&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const ROUTES = ["/", "/read/genesis/1", "/classes", "/books", "/timeline", "/people", "/ask", "/settings", "/bookmarks", "/search", "/tabs", "/plan", "/precepts", "/settings/reminders", "/more", "/law", "/sabbath", "/lexicon"];

for (const width of [390, 1280]) for (const theme of ["default", "dark", "sepia"]) {
  test(`material budget: ${theme} ${width}px uses at most two resting surfaces on every main route`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(theme => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: theme === "dark" ? "dark" : "light", preferredLightTheme: theme, preferredDarkTheme: theme }) }; }, theme);
    await page.route("https://telegram.org/**", route => route.fulfill({ contentType: "application/javascript", body: MOCK }));
    await page.route(/ytimg|youtube\.com|fonts\.g/, route => route.abort());
    const report: { route: string; surfaces: string[] }[] = [];
    for (const route of ROUTES) {
      await page.goto(`${route}${LAUNCH}`);
      await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
      // The Bible's own surfaces are Bible Strong's, inside its frame; this counts the app's.
      if (route.startsWith("/read/")) await bibleReady(page);
      else if (route === "/search") await page.getByRole("searchbox", { name: "Search CyberJudah" }).waitFor();
      else if (route === "/tabs") await page.locator(".switcherbar").waitFor();
      else await page.locator(".route").getByRole("heading").first().waitFor();
      const surfaces = await filteredSurfaces(page);
      report.push({ route, surfaces });
      expect(surfaces.length, `${route}: ${surfaces.join(", ")}`).toBeLessThanOrEqual(2);
    }
    await info.attach("material-budget", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  });
}
