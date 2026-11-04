import { expect, test } from "@playwright/test";
import fs from "node:fs";

/** The Credits page lists every outside source with its licence; the iPhone and Android app opens it at /credits. */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");

test("credits name each outside source and open their links with Telegram's handler", async ({ page }) => {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [] } }));
  await page.goto("/credits#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  for (const heading of ["Built on Bible Strong", "Scripture", "Reference Works", "Classes and Timeline", "Typefaces", "Software", "Human Narrators"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Strong's Hebrew and Greek dictionaries (1894)")).toBeVisible();
  await expect(page.getByText("Translation Words")).toBeVisible();
  await page.locator('a[href="https://github.com/smontlouis/bible-strong"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.some((r) => r[0] === "openLink" && r[1] === "https://github.com/smontlouis/bible-strong"))).toBe(true);
});
