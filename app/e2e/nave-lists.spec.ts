import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

// Bible Strong's NaveListScreen, which the topics and the precepts follow: one letter at a time,
// filed under its disc, the alphabet along the bottom, and a search that replaces the letters.
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dnave-lists&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/topics/index.json") return r.fulfill({ json: [
      { slug: "abraham", label: "Abraham", notes: 3, cases: 0, url: "/topics/abraham" },
      { slug: "adultery", label: "Adultery", notes: 1, cases: 2, url: "/topics/adultery" },
      { slug: "babylon", label: "Babylon", notes: 4, cases: 0, url: "/topics/babylon" },
      { slug: "empty", label: "Angels", notes: 0, cases: 0, url: "/topics/empty" },
      { slug: "verdict-guilty", label: "A verdict", notes: 1, cases: 1, url: "/topics/verdict-guilty" },
    ] });
    if (path === "/api/precepts/index.json") return r.fulfill({ json: Array.from({ length: 320 }, (_, i) => ({ slug: `p${i}`, title: `${i < 310 ? "Sabbath" : "Zion"} ${i}`, refs: 3, url: `/precepts/p${i}` })) });
    return r.fulfill({ status: 404, body: "" });
  });
}

test("topics open on A under its disc, with the letters along the bottom; a letter or a search changes the list", async ({ page }) => {
  await setup(page);
  await page.goto("/topics");
  await expect(page.getByRole("link", { name: "Abraham", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Adultery", exact: true })).toBeVisible();
  // Topics with nothing in them, and verdicts, are not listed.
  await expect(page.getByRole("link", { name: "Angels", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "A verdict", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Babylon", exact: true })).toHaveCount(0);
  await expect(page.locator(".bs-section").first()).toHaveText("A");
  expect(Math.round((await page.getByRole("link", { name: "Abraham", exact: true }).boundingBox())!.height)).toBe(60);
  const strip = page.getByRole("radiogroup", { name: "Letters" });
  await strip.getByRole("radio", { name: "B" }).click();
  await expect(page.getByRole("link", { name: "Babylon", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/letter=b/);
  await page.getByRole("searchbox", { name: "Search by word" }).fill("dult");
  await expect(page.getByRole("link", { name: "Adultery", exact: true })).toBeVisible();
  await expect(strip).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search by word" }).fill("zzz");
  await expect(page.getByText("No word found...")).toBeVisible();
});

test("precepts list every precept of a letter, with no cap", async ({ page }) => {
  await setup(page);
  await page.goto("/precepts?letter=s");
  await expect(page.locator(".bs-dictitem")).toHaveCount(310);
  await page.getByRole("radiogroup", { name: "Letters" }).getByRole("radio", { name: "Z" }).click();
  await expect(page.locator(".bs-dictitem")).toHaveCount(10);
});

test("the discs take the theme's own quart and quint, darkened only where their white letter would not read", async ({ page }) => {
  const disc = async (path: string, letter: string) => {
    await page.goto(`${path}?letter=${letter}${LAUNCH}`);
    const span = page.locator(".bs-section span").first();
    await expect(span).toHaveText(letter.toUpperCase());
    return span.evaluate(el => { const s = getComputedStyle(el); return { bg: s.backgroundColor, ink: s.color }; });
  };
  const ratio = (a: string, b: string) => {
    const lum = (c: string) => { const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  await setup(page);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  for (const theme of ["default", "night"]) {
    await page.addInitScript(t => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: t === "night" ? "dark" : "light", preferredLightTheme: t === "night" ? "default" : t, preferredDarkTheme: t === "night" ? t : "dark" }) }; }, theme);
    await page.goto(`/precepts${LAUNCH}`);
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    const precepts = await disc("/precepts", "s"), topics = await disc("/topics", "a");
    for (const d of [precepts, topics]) { expect(d.ink).toBe("rgb(255, 255, 255)"); expect(ratio(d.bg, d.ink)).toBeGreaterThanOrEqual(4.5); }
    // Bible Strong's colours stand wherever they already read: quart on Paper, quint on Paper.
    if (theme === "default") { expect(precepts.bg).toBe("rgb(194, 40, 57)"); expect(topics.bg).toBe("rgb(48, 51, 107)"); }
  }
});
