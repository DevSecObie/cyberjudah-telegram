import { expect, test } from "@playwright/test";
import fs from "node:fs";

// The pictures and icons are CyberJudah's own (public/art): every one is served, and the screens
// that show them load them from there.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Down-artwork&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const ART = ["empty.svg", "tabs.svg", "new-group.svg",
  ...["bookmark", "highlight", "history", "note", "search", "study", "tag", "word"].map((n) => `empty/${n}.svg`),
  ...["plus", "bible", "search", "lexicon", "dictionary", "topics", "study", "note"].map((n) => `tab/${n}.svg`),
  ...["bible", "library", "notes"].map((n) => `new-tab/${n}.svg`)];

test("every picture and icon is served from public/art", async ({ request }) => {
  for (const file of ART) {
    const r = await request.get(`/art/${file}`);
    expect(r.status(), file).toBe(200);
    expect(await r.text(), file).toContain("<svg");
  }
});

test("New Tab's pictures and tab icons come from public/art", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.goto(`/new${LAUNCH}`);
  await expect(page.locator(".ntcard__art")).toHaveAttribute("src", /\/art\/new-tab\/bible\.svg$/);
  await expect(page.locator(".ntsection__art")).toHaveCount(2);
  for (const src of await page.locator(".ntsection__art").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute("src")))) expect(src).toMatch(/\/art\/new-tab\/(notes|library)\.svg$/);
  for (const icon of await page.locator(".tabicon").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue("--icon")))) expect(icon).toMatch(/\/art\/tab\/[a-z]+\.svg/);
});
