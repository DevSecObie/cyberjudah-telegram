import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const LAUNCH = "#tgWebAppData=query_id%3Dtab-flow&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

async function setup(page: Page, mode = "normal") {
  await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
  await page.addInitScript(({ mode }) => {
    const tabs = Array.from({ length: 8 }, (_, i) => ({ id: `tab-${i}`, path: i === 5 ? "/read/genesis/1" : i === 0 ? "/timeline" : `/classes?tab=${i}` }));
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "tab-5", tabs }] }));
    if (mode === "fallback") Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    if (mode === "rejected") Object.defineProperty(document, "startViewTransition", { configurable: true, writable: true, value: (update: () => void) => {
      const updateCallbackDone = Promise.resolve().then(update);
      return { updateCallbackDone, ready: Promise.reject(new Error("Snapshot unavailable")), finished: updateCallbackDone, skipTransition() {} };
    } });
    const state = window as unknown as { __tabAnimations: Keyframe[][]; __tabTransitions: number; __tabReady: boolean[] };
    state.__tabAnimations = []; state.__tabTransitions = 0; state.__tabReady = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches(".switcher__grid, .route")) state.__tabAnimations.push((animation.effect as KeyframeEffect).getKeyframes());
      return animation;
    };
    if (document.startViewTransition) {
      const start = document.startViewTransition.bind(document);
      document.startViewTransition = (...args) => {
        state.__tabTransitions++;
        const transition = start(...args);
        void transition.ready.then(() => state.__tabReady.push(true), () => state.__tabReady.push(false));
        return transition;
      };
    }
  }, { mode });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    if (new URL(r.request().url()).pathname === "/api/kjv/genesis/1.json") return r.fulfill({ json: {
      book: "Genesis", chapter: 1, translation: "KJV", verses: Array.from({ length: 31 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}. Long reading content keeps a meaningful scroll position when the tab is minimized and reopened. `.repeat(3) })),
    } });
    if (new URL(r.request().url()).pathname === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, chapterIds: [1] }] });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
}

async function overview(page: Page) {
  await page.getByRole("button", { name: "Tabs, 8 open", exact: true }).click();
  await expect(page.getByRole("main", { name: "Your tabs" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
}

for (const mode of ["normal", "fallback", "reduced", "rejected"]) {
  test(`tab flow: ${mode} collapses and reopens the selected reader without losing its place`, async ({ page }) => {
    await setup(page, mode);
    await page.locator(".bs-scroll").evaluate(e => { e.scrollTop = 740; });
    await overview(page);
    await expect(page.locator('.tabcard[data-current]')).toBeInViewport();
    await expect(page.locator(".tabcard")).toHaveCount(8);
    await page.getByRole("button", { name: "Open the selected tab", exact: true }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
    await expect(page).toHaveURL(/\/read\/genesis\/1/);
    // Firefox can retain a fractional CSS pixel after the transformed viewport settles.
    await expect.poll(() => page.locator(".bs-scroll").evaluate(e => Math.abs(e.scrollTop - 740))).toBeLessThanOrEqual(1);
    const motion = await page.evaluate(() => {
      const s = window as unknown as { __tabAnimations: Keyframe[][]; __tabTransitions: number; __tabReady: boolean[] };
      return { frames: s.__tabAnimations, native: s.__tabTransitions, ready: s.__tabReady, supported: !!document.startViewTransition };
    });
    if (mode === "normal" && motion.supported) { expect(motion.native).toBe(2); expect(motion.ready).toEqual([true, true]); }
    else {
      expect(motion.native).toBe(mode === "rejected" ? 2 : 0);
      if (mode === "rejected") expect(motion.ready).toEqual([false, false]);
      expect(motion.frames.length).toBeGreaterThanOrEqual(2);
      if (mode === "reduced") expect(motion.frames.flat().every(f => !f.transform || f.transform === "none")).toBe(true);
      else expect(motion.frames.flat().some(f => String(f.transform).includes("translate"))).toBe(true);
    }
  });
}

test("tab flow: Escape and Telegram Back resume the selected tab; closing a card preserves its neighbors", async ({ page }) => {
  await setup(page);
  await overview(page);
  await expect(page.getByRole("button", { name: "Open Bible timeline", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
  await overview(page);
  await page.evaluate(() => (window as unknown as { __tg: { press: (button: string) => void } }).__tg.press("back"));
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
  await overview(page);
  await page.locator('.tabcard[data-tab-id="tab-2"] .tabcard__close').click();
  await expect(page.locator(".tabcard")).toHaveCount(7);
  await expect(page.locator('.tabcard[data-current]')).toHaveAttribute("data-tab-id", "tab-5");
  await page.getByRole("button", { name: "Add a tab", exact: true }).click();
  await expect(page.locator(".nt-heading")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
});

for (const width of [390, 768, 1280]) {
  test(`tab flow: ${width}px preview cards fit the actual content width at 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important }" });
    await overview(page);
    expect(await page.locator(".switcher").evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = (await page.locator(".switcher").boundingBox())!;
    for (const card of await page.locator(".tabcard").all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  });
}
