import { expect, test } from "@playwright/test";
import fs from "node:fs";

// The people in the pictures are CyberJudah's own (public/art): every picture is served, and New Tab
// and the empty states load them from there.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Down-artwork&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const ART = ["empty-state-illustration.webp", "new-tab/bible-reader.webp", "new-tab/library-reader.webp", "new-tab/notes-writer.webp"];

test("every picture of people is served from public/art", async ({ request }) => {
  for (const file of ART) {
    const r = await request.get(`/art/${file}`);
    expect(r.status(), file).toBe(200);
    expect(r.headers()["content-type"], file).toContain("image/webp");
  }
});

test("New Tab's pictures and the empty state's come from public/art", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/new${LAUNCH}`);
  await expect(page.locator(".ntcard__art")).toHaveAttribute("src", /\/art\/new-tab\/bible-reader\.webp$/);
  const sections = await page.locator(".ntsection__art").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
  expect(sections).toEqual([expect.stringMatching(/\/art\/new-tab\/notes-writer\.webp$/), expect.stringMatching(/\/art\/new-tab\/library-reader\.webp$/)]);
  await page.getByRole("button", { name: "Studies", exact: true }).click();
  await expect(page.locator(".spick__art img")).toHaveAttribute("src", /\/art\/empty-state-illustration\.webp$/);
});
