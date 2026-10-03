import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * The Bible Timeline at 390×844: Bible Strong's periods, canvas, date bar, line and year,
 * search and event pages, with our case studies and Who's Who reigns, and none of their
 * prophetic teaching. Set REVIEW_SHOTS=1 to write screenshots to e2e/review/timeline.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
// Reduced motion skips the opening of a period (its own test below shows it).
test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/timeline/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/timeline/${name}.png`, import.meta.url).pathname });
};
test.beforeEach(async ({ page }) => {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
});
const OUT = "/tmp/claude-0/-home-user-cyberjudah/9190352f-3f2e-541e-94aa-f7adf3d14456/scratchpad/fcshots";
test("final captivity screens", async ({ page }) => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/timeline");
  const items = page.locator(".tl-item");
  await items.nth(12).scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/1-index.png` });
  await items.nth(12).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/2-period.png` });
  await page.goto("/timeline/12?event=lagos-captives-1444");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/3-sheet-low.png` });
  // Full detent: scroll the body.
  const body = page.locator(".bs-sheet__body");
  await page.locator(".bs-sheet__grab, .bs-sheet__header").first().dispatchEvent("click").catch(() => null);
  await page.evaluate(() => { const s = document.querySelector<HTMLElement>(".bs-sheet"); s?.querySelector<HTMLElement>(".bs-sheet__header")?.click(); });
  await page.waitForTimeout(600);
  for (const [i, y] of [[4, 0], [5, 700], [6, 1400], [7, 2100]] as const) {
    await page.goto(`/timeline/13?event=${i === 4 ? "kimpa-vita-1706" : "kimpa-vita-1706"}`).catch(() => null);
    break;
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/4-kimpa-low.png` });
  // Make the sheet full height (the detent engine listens to drags; emulate with a pointer drag on the grab area).
  const grab = page.locator(".bs-sheet__grab").first();
  const b = await grab.boundingBox();
  if (b) { await page.mouse.move(b.x + b.width / 2, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, 60, { steps: 12 }); await page.mouse.up(); }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/5-kimpa-full.png` });
  for (const y of [700, 1400, 2100, 2800]) { await body.evaluate((el, yy) => el.scrollTo(0, yy), y); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/6-kimpa-${y}.png` }); }
});
