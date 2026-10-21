import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const LAUNCH = "#tgWebAppData=query_id%3Dtab-flow&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

async function setup(page: Page, mode = "normal") {
  await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
  await page.addInitScript(({ mode }) => {
    const tabs = Array.from({ length: 8 }, (_, i) => ({ id: `tab-${i}`, path: i === 5 ? "/read/genesis/1" : i === 0 ? "/timeline" : i === 1 ? "/search?q=kept" : `/classes?tab=${i}` }));
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "tab-5", tabs }] }));
    // View Transitions are not used for a tab's open or close; their absence or failure changes nothing.
    if (mode === "fallback") Object.defineProperty(document, "startViewTransition", { configurable: true, value: undefined });
    if (mode === "rejected") Object.defineProperty(document, "startViewTransition", { configurable: true, writable: true, value: () => { throw new Error("Snapshot unavailable"); } });
    const state = window as unknown as { __tabAnimations: { el: string; frames: Keyframe[]; duration: number; easing: string }[] };
    state.__tabAnimations = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = animate.call(this, keyframes, options);
      const timing = animation.effect!.getTiming();
      state.__tabAnimations.push({ el: (this as Element).className.toString(), frames: (animation.effect as KeyframeEffect).getKeyframes(), duration: Number(timing.duration), easing: String(timing.easing) });
      return animation;
    };
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
    await page.getByRole("button", { name: "Open selected tab", exact: true }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
    await expect(page.locator("head style").filter({ hasText: /--tab-from:\s*translate/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\/read\/genesis\/1/);
    // Firefox can retain a fractional CSS pixel after the transformed viewport settles.
    await expect.poll(() => page.locator(".bs-scroll").evaluate(e => Math.abs(e.scrollTop - 740))).toBeLessThanOrEqual(1);
    const motion = await page.evaluate(() => (window as unknown as { __tabAnimations: { el: string; frames: Keyframe[]; duration: number; easing: string }[] }).__tabAnimations);
    // Bible Strong's useTabAnimations: the card resizes (not scales) over 500 ms on its curve, to its
    // place on the way out and to full screen on the way back; then the tab fades in over 300 ms.
    const resizes = motion.filter(m => m.el.includes("tabcard") && m.frames.some(f => f.width));
    if (mode === "reduced") { expect(resizes).toHaveLength(0); return; }
    expect(resizes).toHaveLength(2);
    for (const r of resizes) { expect(r.duration).toBe(500); expect(r.easing).toBe("cubic-bezier(0.36, 0.77, 0.44, 1)"); }
    expect(resizes[0].frames[0].width).toBe("390px"); expect(resizes[1].frames.at(-1)!.width).toBe("390px");
    expect(motion.some(m => m.el.includes("route") && m.duration === 300 && Number(m.frames[0].opacity) === 0)).toBe(true);
  });
}

test("tab flow: the switcher has no Back or Escape, as in Bible Strong; closing a card preserves its neighbors", async ({ page }) => {
  await setup(page);
  await overview(page);
  await expect(page.getByRole("button", { name: "Open Bible timeline", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as unknown as { __tg: { press: (button: string) => void } }).__tg.press("back"));
  await expect(page).toHaveURL(/\/tabs/);
  await page.locator('.tabcard[data-tab-id="tab-2"] .tabcard__close').click();
  await expect(page.locator(".tabcard")).toHaveCount(7);
  // Bible Strong keeps the current position (useTabPreview, clampTabIndex): closing a card before it moves the selection on to the next tab.
  await expect(page.locator('.tabcard[data-current]')).toHaveAttribute("data-tab-id", "tab-6");
  await page.getByRole("button", { name: "Add a tab", exact: true }).click();
  await expect(page.locator(".nt-heading")).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
  const added = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("cj:tabgroups")!);
    const group = saved.groups.find((g: { id: string }) => g.id === saved.group);
    const grew = (window as unknown as { __tabAnimations: { el: string; frames: Keyframe[] }[] }).__tabAnimations.filter(m => m.el.includes("tabcard") && m.frames.some(f => f.width)).at(-1);
    return { current: group.current, count: group.tabs.length, grewTo: grew?.frames.at(-1)?.width };
  });
  expect(added.count).toBe(8);
  expect(added.current).not.toBe("tab-6");
  // The new tab's card grew to full screen (useExpandNewTab).
  expect(added.grewTo).toBe("390px");
});

test("tab flow: Search slides into its own saved tab", async ({ page }) => {
  await setup(page);
  // Bible Strong's switcher bar has no Search: it is on the bar over a tab (BottomTabBar).
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search CyberJudah" })).toHaveValue("kept");
  await expect(page.locator("html")).not.toHaveAttribute("data-tab-motion");
  const motion = await page.evaluate(() => (window as unknown as { __tabAnimations: { el: string; frames: Keyframe[] }[] }).__tabAnimations);
  // No card resizes: Search has its own slide entrance.
  expect(motion.some(m => m.el.includes("tabcard") && m.frames.some(f => f.width))).toBe(false);
  expect(motion.some(m => m.el.includes("route") && m.frames.some(f => String(f.transform).includes("translate")))).toBe(true);
});

for (const width of [390, 768, 1280]) {
  test(`tab flow: ${width}px preview cards fit the actual content width at 200% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await page.addStyleTag({ content: "html { font-size: 200% !important }" });
    await overview(page);
    // Each group is a page of the pager; the cards fit the page that is showing.
    const shown = page.locator(".switcher__page[data-active]");
    expect(await shown.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = (await shown.boundingBox())!;
    for (const card of await shown.locator(".tabcard").all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
  });
}
