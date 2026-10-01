import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
/** The library from a local build when DATA_DIR is set, as in telegram.spec, else from the data origin. */
const DATA = process.env.DATA_DIR ?? "";

/** A device voice that speaks a verse when the test says so: `__speech.next()` ends the current one. */
async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  if (DATA) await page.route("https://data.cyberjudah.io/**", (r) => {
    const f = path.join(DATA, decodeURIComponent(new URL(r.request().url()).pathname));
    return f.startsWith(DATA) && fs.existsSync(f) && fs.statSync(f).isFile() ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: "" });
  });
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route("**/api/voices", (r) => r.fulfill({ json: { voices: [] } }));
  await page.route("**/api/recordings/**", (r) => r.fulfill({ json: { narrators: [] } }));
  await page.addInitScript(() => {
    const state = { last: null as null | { onstart?: () => void; onend?: () => void }, next() { state.last?.onend?.(); } };
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { constructor(public text: string) {} } });
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [{ name: "Test device", lang: "en-GB" }], addEventListener() {}, removeEventListener() {},
      speak(u: { onstart?: () => void }) { state.last = u; u.onstart?.(); }, cancel() {}, pause() {}, resume() {},
    } });
    (window as unknown as { __speech: unknown }).__speech = state;
  });
}
const next = (page: Page, times = 1) => page.evaluate((n) => { for (let i = 0; i < n; i++) (window as unknown as { __speech: { next(): void } }).__speech.next(); }, times);
const reading = (page: Page) => page.locator(".bs-verse[data-reading]");
/** Where the verse sits in the reading column: 0 at the top under the header, 1 at the bottom. */
const place = (page: Page, verse: number) => page.evaluate((v) => {
  const sc = document.querySelector(".bs-scroll")!.getBoundingClientRect(), r = document.querySelector(`#verset-${v}`)!.getBoundingClientRect();
  return (r.top - sc.top) / sc.height;
}, verse);
const scrollTop = (page: Page) => page.evaluate(() => Math.round(document.querySelector(".bs-scroll")!.scrollTop));

for (const viewport of [{ width: 390, height: 780 }, { width: 1280, height: 860 }]) {
  test(`the reading follows the passage, lets the reader scroll away, and brings them back (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.goto("/read/psalms/119");
    await expect(page.locator("#verset-1")).toBeVisible();
    await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
    await next(page); // the chapter's title, then verse 1
    await expect(reading(page)).toHaveAttribute("id", "verset-1");
    await expect(reading(page)).toHaveAttribute("aria-current", "true");

    // As the reading goes on, the verse being read is marked and stays in view.
    await next(page, 30);
    await expect(reading(page)).toHaveAttribute("id", "verset-31");
    await expect.poll(() => place(page, 31)).toBeGreaterThan(0.05);
    await expect.poll(() => place(page, 31)).toBeLessThan(0.6);
    await expect(page.locator(".bs-follow")).not.toHaveAttribute("data-at");

    // The reader scrolls back up: the page is theirs; the reading goes on without moving it.
    await page.locator(".bs-scroll").hover();
    await page.mouse.wheel(0, -2500);
    await expect.poll(() => place(page, 31)).toBeGreaterThan(1);
    const pill = page.locator(".bs-follow");
    await expect(pill).toHaveAttribute("data-at", "bottom");
    await expect(pill).toHaveText("Back to verse 31");
    const held = await scrollTop(page);
    await next(page, 2);
    await expect(reading(page)).toHaveAttribute("id", "verset-33");
    await expect(pill).toHaveText("Back to verse 33");
    expect(Math.abs(await scrollTop(page) - held)).toBeLessThan(4);

    // Back to the verse: in view again, and the reading follows once more.
    await pill.click();
    await expect(pill).not.toHaveAttribute("data-at");
    await expect.poll(() => place(page, 33)).toBeLessThan(0.6);
    await next(page, 10);
    await expect(reading(page)).toHaveAttribute("id", "verset-43");
    await expect.poll(() => place(page, 43)).toBeLessThan(0.6);
    await expect.poll(() => place(page, 43)).toBeGreaterThan(0.05);

    // Scrolled past it downwards, the way back points up.
    await page.locator("#verset-43").hover();
    await page.mouse.wheel(0, 4000);
    await expect(pill).toHaveAttribute("data-at", "top");
    await pill.click();
    await expect.poll(() => place(page, 43)).toBeLessThan(0.6);

    // Stopping clears the mark and the way back.
    await page.getByRole("button", { name: "Stop audio playback", exact: true }).click();
    await expect(reading(page)).toHaveCount(0);
    await expect(pill).not.toHaveAttribute("data-at");
  });
}
