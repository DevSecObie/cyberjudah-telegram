import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { filteredSurfaces } from "./material-surfaces";

test.use({ hasTouch: true });

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
// Material and pointer tests don't require live library data or a signed-in account.
const LAUNCH = "#tgWebAppData=query_id%3Dglass-review&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

/** Read the material itself, including its pseudo-element, rather than an unrelated wrapper. */
async function materials(page: Page, selectors: [string, string?][]) {
  return page.evaluate(selectors => selectors.map(([selector, pseudo]) => {
    const element = document.querySelector(selector)!;
    const style = getComputedStyle(element, pseudo);
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
    return { selector, filter: style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter"), alpha: context.getImageData(0, 0, 1, 1).data[3] };
  }), selectors);
}


async function setup(page: Page, theme = "default", reduced = false) {
  await page.addInitScript(({ theme, reduced }) => {
    (window as unknown as { __cloud: Record<string, string> }).__cloud = {
      bs: JSON.stringify({ preferredColorScheme: ["dark", "black", "mauve", "night"].includes(theme) ? "dark" : "light", preferredLightTheme: theme, preferredDarkTheme: theme }),
      transparency: JSON.stringify(reduced ? "reduced" : "system"),
    };
  }, { theme, reduced });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA_ORIGIN}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis", chapterIds: [1] }] });
    if (path === "/api/kjv/genesis/1.json") return r.fulfill({ json: {
      book: "Genesis", chapter: 1, translation: "KJV", url: "/bible/genesis/1",
      verses: Array.from({ length: 31 }, (_, i) => ({ verse: i + 1, text: `Reading layout fixture ${i + 1}. Long content lets the navigation float above the page while scrolling.` })),
    } });
    if (path === "/api/concordance/genesis/1.json") return r.fulfill({ json: { book: "Genesis", chapter: 1, cited_by: [] } });
    if (path === "/api/library/materials/book.json") return r.fulfill({ json: {
      slug: "materials", title: "Material test book", subtitle: "", author: "Test", year: 2026, publisher: "", license: "Test fixture", source: "", items: [], scan: "", chapters: [], reads: [],
      figures: [{ kind: "figure", title: "Test picture", caption: "", vol: 1, page: 1, img: 1, file: "fixture.png", width: 1, height: 1, chapter: 0, reads: 0, readings: [], url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=" }],
    } });
    return r.fulfill({ status: 404, body: "" });
  });
}

for (const theme of ["default", "sepia", "nature", "sunset", "dark", "black", "mauve", "night"]) {
  test(`bar: ${theme} is Bible Strong's flat bar, on the page colour, with legible 48 px icon buttons`, async ({ page }) => {
    await setup(page, theme);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    await expect(page.locator("#verset-1")).toBeVisible();
    const bar = page.getByRole("navigation", { name: "Sections" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    const style = await bar.evaluate(nav => {
      const s = getComputedStyle(nav), filters = [nav, ...nav.querySelectorAll("*")].map(el => getComputedStyle(el).backdropFilter || getComputedStyle(el).getPropertyValue("-webkit-backdrop-filter"));
      return { background: s.backgroundColor, page: getComputedStyle(document.querySelector(".bs")!).backgroundColor, line: s.borderTopWidth, filters };
    });
    expect(style.background).toBe(style.page);
    expect(style.line).toBe("1px");
    expect(style.filters.every(f => !f || f === "none")).toBe(true);
    const box = (await bar.boundingBox())!;
    expect(box.x).toBe(0); expect(box.width).toBe(page.viewportSize()!.width);
    expect(box.y + box.height).toBe(page.viewportSize()!.height); expect(box.height).toBe(48);
    // Home, Search, Bible, the reader's own buttons, Tabs and then Menu, as Bible Strong orders them.
    expect(await bar.locator(".tab").evaluateAll(buttons => buttons.map(b => (b as HTMLElement).dataset.nav))).toEqual(["home", "search", "bible", "classes", "ask", "tabs", "more"]);
    await expect(bar.getByRole("button", { name: "Bible", exact: true })).toHaveAttribute("aria-current", "page");
    await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== "running"));
    const minimumContrast = await bar.evaluate(nav => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const sample = (colour: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const ground = lum(sample(getComputedStyle(nav).backgroundColor));
      return Math.min(...[...nav.querySelectorAll(".tab")].map(button => { const ink = lum(sample(getComputedStyle(button).color)); return (Math.max(ink, ground) + .05) / (Math.min(ink, ground) + .05); }));
    });
    // Icon buttons: the non-text minimum, 3:1, in Bible Strong's own palettes.
    expect(minimumContrast).toBeGreaterThanOrEqual(3);
    for (const button of await bar.getByRole("button").all()) {
      const b = (await button.boundingBox())!;
      expect(b.width).toBe(48); expect(b.height).toBe(48);
    }
    await bar.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search/);
  });
}

test("glass: the selected Menu still responds to an ordinary tap", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings${LAUNCH}`);
  const menu = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-current", "page");
  await menu.click();
  await expect(page.locator(".drawer--more")).toHaveAttribute("data-open", "");
  // The drawer pushes the bar offscreen; Escape closes it and returns to its trigger.
  await page.keyboard.press("Escape");
  await expect(page.locator(".drawer--more")).not.toHaveAttribute("data-open");
  await menu.click();
  await expect(page.locator(".drawer--more")).toHaveAttribute("data-open", "");
});

for (const preference of ["app", "contrast"] as const) {
  test(`bar: ${preference === "app" ? "Reduce transparency" : "increased contrast"} keeps it on the page colour with nothing frosted`, async ({ page }) => {
    if (preference === "contrast") await page.emulateMedia({ contrast: "more" });
    await setup(page, "dark", preference === "app");
    await page.goto(`/settings${LAUNCH}`);
    await expect(page.getByRole("switch", { name: "Justify the text", exact: true })).toBeVisible();
    const style = await page.locator("nav.tabs").evaluate(nav => ({ background: getComputedStyle(nav).backgroundColor, canvas: getComputedStyle(document.body).backgroundColor, filter: getComputedStyle(nav).backdropFilter || getComputedStyle(nav).getPropertyValue("-webkit-backdrop-filter") }));
    expect(style.background).toBe(style.canvas);
    expect(style.filter).toBe("none");
  });
}

test("bar: wide windows keep Bible Strong's bar along the bottom, and its buttons navigate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await page.goto(`/search${LAUNCH}`);
  const bar = page.getByRole("navigation", { name: "Sections" });
  const box = (await bar.boundingBox())!;
  expect(box.x).toBe(0); expect(box.width).toBe(1280); expect(box.y + box.height).toBe(900);
  await bar.getByRole("button", { name: "Classes", exact: true }).click();
  await expect(page).toHaveURL(/\/classes/);
  await expect(bar.getByRole("button", { name: "Classes", exact: true })).toHaveAttribute("aria-current", "page");
  await bar.getByRole("button", { name: "Search", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search/);
});

for (const theme of ["default", "dark", "sepia"]) {
  for (const mode of ["system", "app", "contrast", "forced"] as const) {
    test(`materials: ${theme} ${mode} keeps headers, dock, menus and selection opaque`, async ({ page, browserName }) => {
      test.skip(mode === "system" && browserName !== "chromium", "Playwright only exposes this OS preference through Chromium CDP");
      if (mode === "system") {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      }
      if (mode === "contrast") await page.emulateMedia({ contrast: "more" });
      if (mode === "forced") await page.emulateMedia({ forcedColors: "active" });
      await setup(page, theme, mode === "app");
      for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`/read/genesis/1${LAUNCH}`);
        await expect(page.locator("#verset-1")).toBeVisible();
        if (mode === "system") expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(true);
        await page.getByRole("button", { name: "Scripture options" }).click();
        await expect(page.getByRole("menu", { name: "Passage options" })).toBeVisible();
        for (const material of await materials(page, [[".bs-header", "::before"], [".tabs"], [".bs-dropdown"]])) {
          expect(material.filter, material.selector).toBe("none");
          expect(material.alpha, material.selector).toBe(255);
        }
        await page.keyboard.press("Escape");
        await page.locator("#verset-1").click();
        await expect(page.locator(".bs-selected")).toBeVisible();
        expect((await materials(page, [[".bs-selected"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
        await expect.poll(() => filteredSurfaces(page)).toEqual([]);
        // Selection is saved with the reader tab; clear it before checking the next viewport.
        await page.locator("#verset-1").click();
        await expect(page.locator(".bs-selected")).toHaveCount(0);
      }
      await page.goto(`/books/materials${LAUNCH}`);
      await expect(page.locator(".book__figure")).toBeVisible();
      expect((await materials(page, [[".head"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
      await page.locator(".book__figure").click();
      await expect(page.locator(".pv")).toBeVisible();
      expect((await materials(page, [[".pv__bar", "::before"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
      await expect.poll(() => filteredSurfaces(page)).toEqual([]);
    });
  }
}

test("materials: header, menu and selection stay within budget without stacked glass", async ({ page, browserName }) => {
  await setup(page);
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Scripture options" }).click();
  const menu = page.getByRole("menu", { name: "Passage options" });
  await expect(menu).toBeVisible();
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(2);
  expect(await menu.evaluate(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const filter = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
      if (filter && filter !== "none") return false;
    }
    return true;
  })).toBe(true);
  const header = (await page.locator(".bs-header").boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height);
  await page.keyboard.press("Escape");
  await page.locator("#verset-1").click();
  await expect(page.locator(".bs-selected")).toBeVisible();
  // While verses are selected Bible Strong's header is solid (the page colour, no glass), so the
  // selection sheet is the one frosted surface.
  await expect.poll(() => filteredSurfaces(page)).toEqual(["bs-sheet bs-sheet--auto bs-selected"]);
  expect(await page.locator(".bs-header").evaluate(e => getComputedStyle(e, "::before").content)).toBe("none");
  // The mobile action row scrolls without turning the action page or selecting an action.
  const row = page.locator("#sv-panel-0 .bs-actions");
  await expect.poll(() => row.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.locator(".bs-selected").evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
  const bounds = (await row.boundingBox())!;
  const x = bounds.x + bounds.width - 24, y = bounds.y + bounds.height / 2;
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 14; i++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - i * 18, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y); await page.mouse.wheel(300, 0);
  }
  await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole("tab", { name: "Annotate", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(row.getByRole("button", { name: "Focus", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
});

test("materials: content stays unfiltered at 200% shared text size with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.goto(`/books/materials${LAUNCH}`);
  await expect(page.locator(".book__figure")).toBeVisible();
  const title = page.locator(".head .title");
  const normal = await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect.poll(() => title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(normal * 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // The page header and the bottom bar are both flat, as Bible Strong's: nothing is frosted at rest.
  await expect.poll(() => filteredSurfaces(page)).toEqual([]);
  expect((await materials(page, [[".book__figure"]]))[0].filter).toBe("none");
  await page.locator(".book__figure").click();
  await expect(page.locator(".pv__bar")).toBeVisible();
  await expect(page.locator(".pv")).toHaveCSS("opacity", "1");
  await expect.poll(() => filteredSurfaces(page)).toEqual(["pv__bar::before"]);
  await page.locator(".pv").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".pv")).toHaveCount(0);
});

test("pictures: reduced motion opens without an animation frame and Back closes the viewer", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.goto(`/books/materials${LAUNCH}`);
  const figure = page.locator(".book__figure");
  await expect(figure).toBeVisible();
  // A suspended rendering callback must not leave a mounted modal transparent.
  await figure.evaluate(element => {
    window.requestAnimationFrame = () => 0;
    (element as HTMLElement).click();
  });
  await expect(page.locator(".pv")).toHaveCSS("opacity", "1");
  await expect.poll(() => filteredSurfaces(page)).toEqual(["pv__bar::before"]);
  await page.locator(".pv").dispatchEvent("cj:close");
  await expect(page.locator(".pv")).toHaveCount(0);
});

test("pictures: Escape closes the viewer and returns keyboard focus", async ({ page }) => {
  await setup(page);
  await page.goto(`/books/materials${LAUNCH}`);
  const figure = page.locator(".book__figure");
  await figure.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".pv")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pv")).toHaveCount(0);
  await expect(figure).toBeFocused();
});

test("materials: unsupported-filter CSS branch yields opaque reader surfaces", async ({ page }) => {
  await setup(page, "sepia");
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  // CSS support cannot be disabled by Playwright. Activate the real fallback blocks in place,
  // preserving their cascade order, so this verifies their declarations rather than a test copy.
  const changed = await page.evaluate(() => {
    let changed = 0;
    for (const sheet of document.styleSheets) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        if (rule instanceof CSSSupportsRule && rule.conditionText.startsWith("not") && rule.conditionText.includes("backdrop-filter")) {
          const body = [...rule.cssRules].map(r => r.cssText).join("\n");
          sheet.deleteRule(i); sheet.insertRule(`@media all { ${body} }`, i); changed++;
        }
      }
    }
    return changed;
  });
  expect(changed).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Scripture options" }).click();
  await expect(page.getByRole("menu", { name: "Passage options" })).toBeVisible();
  for (const material of await materials(page, [[".bs-header", "::before"], [".tabs"], [".bs-dropdown"]])) expect(material).toMatchObject({ filter: "none", alpha: 255 });
});

for (const theme of ["default", "dark", "sepia"]) {
  for (const preference of ["normal", "system", "app", "motion", "contrast", "forced"] as const) {
    test(`controls: ${theme} ${preference} stays usable at 200% with Telegram insets`, async ({ page, browserName }) => {
      test.skip(preference === "system" && browserName !== "chromium", "OS transparency emulation requires CDP; app preference runs in both engines");
      await setup(page, theme, preference === "app");
      await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK.replace(
        'safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }, contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }',
        'safeAreaInset: { top: 24, bottom: 16, left: 8, right: 12 }, contentSafeAreaInset: { top: 20, bottom: 14, left: 6, right: 8 }',
      ) }));
      await page.emulateMedia({ reducedMotion: preference === "motion" ? "reduce" : "no-preference", contrast: preference === "contrast" ? "more" : "no-preference", forcedColors: preference === "forced" ? "active" : "none" });
      if (preference === "system") await (await page.context().newCDPSession(page)).send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
      for (const [width, height] of [[390, 844], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await page.goto(`/settings${LAUNCH}`);
        const toggle = page.getByRole("switch", { name: "Justify the text", exact: true });
        await expect(toggle).toBeVisible();
        const initialFont = await toggle.locator("b").evaluate(e => parseFloat(getComputedStyle(e).fontSize));
        const captions = page.getByRole("tablist", { name: "Theme" }).locator("button > span");
        const initialCaptionFonts = await captions.evaluateAll(labels => labels.map(e => parseFloat(getComputedStyle(e).fontSize)));
        await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        await expect.poll(() => toggle.locator("b").evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBe(initialFont * 2);
        await expect.poll(() => captions.evaluateAll(labels => labels.map(e => parseFloat(getComputedStyle(e).fontSize)))).toEqual(initialCaptionFonts.map(size => size * 2));
        expect(await captions.evaluateAll(labels => labels.every(label => {
          const l = label.getBoundingClientRect(), b = label.parentElement!.getBoundingClientRect();
          // Inline spans have clientWidth=0; Firefox still reports their scrollWidth.
          // Measure the painted text fragments so every wrapped line must fit the button.
          const text = document.createRange(); text.selectNodeContents(label);
          const fragments = [...text.getClientRects()];
          return l.left >= b.left && l.right <= b.right && l.top >= b.top && l.bottom <= b.bottom && fragments.length > 0 &&
            fragments.every(r => r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom);
        }))).toBe(true);
        await toggle.focus();
        const before = await toggle.getAttribute("aria-checked");
        await page.keyboard.press("Space");
        await expect(toggle).toHaveAttribute("aria-checked", String(before !== "true"));
        const knob = toggle.locator(".switch");
        const restShadow = await knob.evaluate(e => getComputedStyle(e, "::after").boxShadow);
        await toggle.hover(); await page.mouse.down();
        await expect.poll(() => knob.evaluate(e => new DOMMatrix(getComputedStyle(e, "::after").transform).a)).toBeCloseTo(preference === "motion" ? 1 : 1.2, 5);
        // The pressed look waits out the 50 ms press delay (ui/press.ts).
        if (preference !== "forced") await expect.poll(() => knob.evaluate(e => getComputedStyle(e, "::after").boxShadow)).not.toBe(restShadow);
        if (["system", "app", "contrast", "forced"].includes(preference)) expect((await materials(page, [[".switch", "::after"]]))[0].alpha).toBe(255);
        await page.mouse.up();
        const label = (await toggle.locator("b").boundingBox())!, thumb = (await toggle.locator(".switch").boundingBox())!;
        expect(label.x + label.width).toBeLessThanOrEqual(thumb.x);
        // Bible Strong's bar spans the bottom, its 48 px row above Telegram's bottom inset.
        const dock = page.locator("nav.tabs");
        const bounds = (await dock.boundingBox())!;
        expect(bounds.x).toBe(0); expect(bounds.width).toBe(width);
        expect(bounds.y + bounds.height).toBe(height); expect(bounds.height).toBeGreaterThan(48);
        for (const button of await dock.getByRole("button").all()) {
          const b = (await button.boundingBox())!;
          expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(width); expect(b.y).toBeGreaterThanOrEqual(bounds.y);
        }
        // Navigate in-app to retain 200% text; a reload would silently reset the style tag.
        await dock.getByRole("button", { name: "Bible", exact: true }).click();
        await expect(page.locator("#verset-1")).toBeVisible();
        await page.getByRole("button", { name: "Scripture options" }).click();
        const menu = page.getByRole("menu", { name: "Passage options" });
        await expect(menu).toBeVisible();
        await expect.poll(() => menu.getByRole("menuitem").first().evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBe(30);
        for (const item of await menu.getByRole("menuitem").all()) {
          await item.scrollIntoViewIfNeeded();
          const b = (await item.boundingBox())!;
          expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44);
          expect(b.x).toBeGreaterThanOrEqual(14); expect(b.x + b.width).toBeLessThanOrEqual(width - 20);
        }
        if (["system", "app", "contrast", "forced"].includes(preference)) {
          for (const m of await materials(page, [[".bs-header", "::before"], [".tabs"], [".bs-dropdown"]])) {
            expect(m.filter).toBe("none"); expect(m.alpha).toBe(255);
          }
        }
        await page.keyboard.press("Escape");
        await page.locator("#verset-1").click();
        const sheet = page.locator(".bs-selected");
        await expect(sheet).toBeVisible();
        // Every label fits its own action at large text; do not merely hide overflow.
        const clipped = await sheet.locator(".bs-action:visible").evaluateAll(buttons => buttons.flatMap(button => {
          const label = button.querySelector(".bs-action__label")!, b = button.getBoundingClientRect(), l = label.getBoundingClientRect();
          return l.left < b.left - 1 || l.right > b.right + 1 || label.scrollWidth > label.clientWidth + 1 ? [label.textContent] : [];
        }));
        expect(clipped).toEqual([]);
        expect(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    });
  }
}

for (const theme of ["default", "dark", "sepia"]) {
  test(`controls: ${theme} nested sheet actions share accessible accent ink and keyboard behavior`, async ({ page }) => {
    await setup(page, theme);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    await page.getByRole("button", { name: "Scripture options" }).click();
    await page.getByRole("menuitem", { name: /Font and settings/ }).click();
    await page.getByRole("button", { name: "Color palette", exact: true }).click();
    await page.getByRole("button", { name: "Edit Color 1", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Edit Color 1", exact: true });
    const save = sheet.getByRole("button", { name: "Validate", exact: true });
    await expect(save).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expect.poll(() => save.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBe(30);
    expect(await sheet.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const contrast = await save.evaluate(button => {
      const style = getComputedStyle(button), canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!;
      const lum = (color: string) => {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      };
      const a = lum(style.color), b = lum(style.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await save.focus(); await page.keyboard.press("Enter");
    await expect(sheet).toHaveCount(0);
  });
}


for (const reduced of [false, true]) {
  test(`controls: every active bar shares a material-only scroll fade (reduced=${reduced})`, async ({ page }) => {
    await setup(page, "default", reduced);
    for (const [path, selector] of [["/search", ".srch__bar"], ["/ask", ".chat2__bar"], ["/read/genesis/1", ".bs-header"], ["/timeline", ".tlh"]]) {
      await page.goto(`${path}${LAUNCH}`);
      await expect(page.locator(selector)).toBeVisible();
      for (const bar of [selector]) {
        const masks = await page.locator(bar).evaluate(e => ({ material: getComputedStyle(e, "::before").maskImage, content: getComputedStyle(e).maskImage }));
        expect(masks.content).toBe("none");
        if (reduced) expect(masks.material).toBe("none"); else expect(masks.material).toContain("linear-gradient");
      }
      expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(2);
    }
    await page.goto(`/books/materials${LAUNCH}`);
    await page.locator(".book__figure").click();
    const viewer = page.locator(".pv__bar");
    await expect(viewer).toBeVisible();
    const masks = await viewer.evaluate(e => [getComputedStyle(e).maskImage, getComputedStyle(e, "::before").maskImage]);
    expect(masks[0]).toBe("none");
    if (reduced) expect(masks[1]).toBe("none"); else expect(masks[1]).toContain("linear-gradient");
    expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(1);
  });
}

for (const preference of ["normal", "motion", "app", "forced"] as const) {
  test(`controls: native range drag and keyboard still adjust photo zoom (${preference})`, async ({ page }) => {
    await setup(page, "default", preference === "app");
    await page.emulateMedia({ reducedMotion: preference === "motion" ? "reduce" : "no-preference", forcedColors: preference === "forced" ? "active" : "none" });
    await page.route("**/api/me", r => r.fulfill({ json: { admin: true, canEdit: true } }));
    await page.route("**/api/photos", r => r.fulfill({ json: {} }));
    await page.goto(`/timeline/event/iuic-founded-2003${LAUNCH}`);
    await page.getByRole("button", { name: "Change photo" }).click();
    await page.locator(".photo-edit input[type=file]").setInputFiles({ name: "layout.png", mimeType: "image/png", buffer: await page.screenshot() });
    const sheet = page.getByRole("dialog", { name: "Leader's portrait" });
    const slider = sheet.getByRole("slider", { name: "Zoom" });
    await expect(slider).toBeVisible();
    const b = (await slider.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await slider.focus(); await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("1.01");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width * .8, b.y + b.height / 2, { steps: 8 });
    expect(Number(await slider.inputValue())).toBeGreaterThan(2);
    await page.mouse.up();
    const afterDrag = Number(await slider.inputValue());
    await page.keyboard.press("ArrowLeft");
    expect(Number(await slider.inputValue())).toBeCloseTo(afterDrag - .01);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await slider.evaluate(e => getComputedStyle(e).backdropFilter || getComputedStyle(e).getPropertyValue("-webkit-backdrop-filter"))).toBe("none");
    // Cancel: this visual check never uploads a portrait.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
}

for (const theme of ["default", "sepia", "nature", "sunset", "dark", "black", "mauve", "night"]) {
  test(`navigation: ${theme} keeps the same bar along the bottom at every width, every button reachable`, async ({ page }) => {
    await setup(page, theme);
    await page.setViewportSize({ width: 899, height: 844 });
    await page.goto(`/settings${LAUNCH}`);
    await expect(page.getByRole("switch", { name: "Justify the text", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav).toBeVisible();
    const labels = await nav.locator(".tab").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")));
    const badge = await nav.locator(".tab__count").innerText();
    for (const width of [899, 900, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(nav).toHaveCSS("flex-direction", "row");
      expect(await nav.locator(".tab").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")))).toEqual(labels);
      await expect(nav.locator(".tab__count")).toHaveText(badge);
      for (const button of await nav.getByRole("button").all()) {
        expect(await button.evaluate(b => b.tabIndex)).toBe(0);
        const box = (await button.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const bar = (await nav.boundingBox())!, content = (await page.locator(".route > .screen").boundingBox())!;
      expect(bar.x).toBe(0); expect(bar.width).toBe(width); expect(bar.y + bar.height).toBe(800);
      expect(content.x).toBeGreaterThanOrEqual(0);
      expect(content.x + content.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(2);
    }
  });
}

test("header: Bible Strong's 54 px bar, its title in 14 px bold, stays put while the page scrolls under it", async ({ page }) => {
  await setup(page, "sepia");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/settings${LAUNCH}`);
  const head = page.locator(".screen > .head");
  const title = page.getByRole("heading", { name: "Settings", exact: true });
  await expect(title).toBeVisible();
  await expect(title).toHaveCSS("font-size", "14px");
  await expect(title).toHaveCSS("font-weight", "700");
  const back = head.getByRole("button", { name: "Back", exact: true });
  expect(await back.evaluate(el => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([54, 54]);
  const height = async () => Math.round(await head.evaluate(el => el.getBoundingClientRect().height));
  expect(await height()).toBe(55);
  await expect(head).toHaveCSS("border-bottom-width", "1px");
  await page.evaluate(() => { document.documentElement.scrollTop = 400; });
  expect(await height()).toBe(55);
  expect(Math.round(await head.evaluate(el => el.getBoundingClientRect().top))).toBe(0);
});

test("navigation: the bar stays put while pages scroll, and slides away while the Bible is full screen", async ({ page }) => {
  await setup(page, "sepia");
  await page.setViewportSize({ width: 390, height: 844 });
  // By class: while it is out of sight it is out of the accessibility tree, so a role finds nothing.
  const nav = page.locator("nav.tabs");
  await page.goto(`/settings${LAUNCH}`);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Justify the text", exact: true }).hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(nav).not.toHaveAttribute("data-hidden");
  expect((await nav.boundingBox())!.height).toBe(48);
  await nav.getByRole("button", { name: "Bible", exact: true }).click();
  await expect(page.locator("#verset-1")).toBeVisible();
  // Bible Strong's isFullScreenBible: scrolling down the chapter collapses the header and slides the bar out.
  await page.waitForTimeout(800);
  await page.locator(".bs-scroll").evaluate(async el => { for (const top of [40, 120, 600]) { el.scrollTop = top; await new Promise(r => setTimeout(r, 30)); } });
  await expect(page.locator(".bs-header__summary")).toBeVisible();
  await expect(nav).toHaveAttribute("data-hidden", "");
  await expect(nav).toBeHidden();
  await expect.poll(() => nav.evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(844);
  // The reader holds still for 600 ms after its header changes height, then follows the scroll again.
  await page.waitForTimeout(800);
  await page.locator(".bs-scroll").evaluate(async el => { for (const top of [560, 480, 300]) { el.scrollTop = top; await new Promise(r => setTimeout(r, 30)); } });
  await expect(nav).not.toHaveAttribute("data-hidden");
  await expect.poll(async () => { const b = (await nav.boundingBox())!; return b.y + b.height; }).toBe(844);
});

for (const mode of ["native", "fallback", "reduced"] as const) {
  test(`menus: ${mode} keeps origin, keyboard actions and focus when opening and closing`, async ({ page }) => {
    await setup(page);
    if (mode === "reduced") await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(mode => {
      const original = document.startViewTransition?.bind(document);
      (window as any).__popoverTransitions = 0;
      (window as any).__popoverFrames = [];
      if (mode === "fallback") Object.defineProperty(document, "startViewTransition", { value: undefined });
      else if (original) document.startViewTransition = (...args) => { (window as any).__popoverTransitions++; return original(...args); };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.hasAttribute("data-popover")) (window as any).__popoverFrames.push(frames);
        return animate.call(this, frames, options);
      };
    }, mode);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    const trigger = page.getByRole("button", { name: "Scripture options" });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Passage options" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Search the Scriptures" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Open in new tab" })).toBeFocused();
    for (const name of ["search", "share", "bookmark"]) await expect(menu.locator(`[data-icon="${name}"]`)).toHaveCount(1);
    await expect.poll(() => menu.evaluate(el => el.style.transformOrigin)).not.toBe("");
    expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(3);
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-dropdown")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const pickerTrigger = page.getByRole("button", { name: /Choose book and chapter/ });
    await pickerTrigger.click();
    const picker = page.getByRole("dialog", { name: "Books", exact: true });
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-picker-sheet")).toHaveCount(0);
    await expect(pickerTrigger).toBeFocused();
    const motion = await page.evaluate(() => ({ native: !!document.startViewTransition, calls: (window as any).__popoverTransitions, frames: (window as any).__popoverFrames }));
    // The ⋮ menu opens and closes by a morph (2 transitions); the book picker is a bottom sheet and rises instead.
    if (mode === "native" && motion.native) expect(motion.calls).toBeGreaterThanOrEqual(2);
    else expect(motion.calls).toBe(0);
    if (mode === "reduced") {
      expect(motion.frames.length).toBeGreaterThanOrEqual(2);
      expect(motion.frames.flat().every((frame: { transform: string }) => frame.transform === "none")).toBe(true);
    }
  });
}

test("menus: main routes expose named buttons and tooltips for icon-only controls", async ({ page }) => {
  await setup(page);
  for (const path of ["/", "/read/genesis/1", "/classes", "/books", "/timeline", "/people", "/ask", "/settings", "/bookmarks"]) {
    await page.goto(`${path}${LAUNCH}`);
    if (path.includes("/read/")) await page.locator("#verset-1").waitFor();
    else await page.locator(".route").getByRole("heading").first().waitFor();
    const buttons = page.locator("button:visible");
    expect(await buttons.count(), path).toBeGreaterThan(0);
    for (const button of await buttons.all()) {
      await expect(button, path).toHaveAccessibleName(/\S/);
      if (!(await button.innerText()).trim() && await button.locator("svg").count()) {
        await expect(button, path).toHaveAttribute("aria-label", /\S/);
        await expect(button, path).toHaveAttribute("title", /\S/);
      }
    }
  }
});

test("menus: collapsed Bible header removes its hidden controls and restores whole groups", async ({ page }) => {
  await setup(page); await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await page.locator("#verset-1").waitFor();
  await page.clock.runFor(1000);
  await page.locator("#verset-3").hover(); await page.mouse.wheel(0, 80);
  await expect.poll(() => page.locator(".bs-scroll").evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(0, 500);
  await expect(page.locator(".bs-header")).toHaveCSS("height", "20px");
  await expect(page.locator(".bs-header button")).toHaveCount(0);
  await expect(page.locator(".bs-header__summary")).toHaveText("Genesis 1 · KJV");
  await expect.poll(() => page.locator(".bs-scroll").evaluate(el => el.scrollTop)).toBeGreaterThanOrEqual(579);
  await page.clock.runFor(1000);
  const down = await page.locator(".bs-scroll").evaluate(el => el.scrollTop);
  await page.mouse.wheel(0, -80);
  await expect.poll(() => page.locator(".bs-scroll").evaluate(el => el.scrollTop)).toBeLessThanOrEqual(down - 79);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole("group", { name: "Passage", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Scripture actions", exact: true })).toBeVisible();
});

for (const reduced of [false, true]) {
  test(`menus: navigation and group actions share one elevated surface (${reduced ? "solid" : "glass"})`, async ({ page }) => {
    await setup(page, "dark", reduced);
    await page.goto(`/settings${LAUNCH}`);
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Menu", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "More", exact: true });
    await expect(drawer).toBeVisible();
    const more = (await materials(page, [[".drawer--more"]]))[0];
    if (reduced) expect(more).toMatchObject({ filter: "none", alpha: 255 });
    else expect(more.filter).toContain("blur(");
    expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(3);
    await page.keyboard.press("Escape");
    await page.goto(`/tabs${LAUNCH}`);
    const groups = page.getByRole("button", { name: /\. Groups$/ });
    await groups.click();
    const menu = page.getByRole("dialog", { name: "Groups", exact: true });
    await expect(menu).toBeVisible();
    const actions = (await materials(page, [[".sheet[data-actions]"]]))[0];
    if (reduced) expect(actions).toMatchObject({ filter: "none", alpha: 255 });
    else expect(actions.filter).toContain("blur(");
    await expect(menu.locator(".sheet__item").last()).toHaveAttribute("data-destructive", "");
    expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(3);
    await menu.getByRole("button", { name: "New group", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "New group", exact: true }).getByRole("textbox", { name: "Name" })).toBeFocused();
    // Bible Strong's RenameModal has no Cancel: Escape (a swipe or a tap outside on a phone) closes it.
    await page.keyboard.press("Escape");
    await expect(page.locator(".sheet[data-popover], .action-sheet")).toHaveCount(0);
    await expect(groups).toBeFocused();
  });
}

for (const focus of ["field", "current Search control", "another control"] as const) {
  test(`search: a delayed mount respects focus on ${focus}`, async ({ page }) => {
    await setup(page);
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { requested = resolve; });
    // Hold the real lazy-loaded screen, in production builds and the development server.
    await page.route(/\/(?:assets\/Search-[^/]+\.js|src\/screens\/Search\.tsx)(?:\?.*)?$/, async route => { requested(); await gate; await route.continue(); });
    await page.goto(`/search${LAUNCH}`, { waitUntil: "domcontentloaded" });
    await waiting;
    const next = page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Classes", exact: true });
    try {
      if (focus === "another control") await next.focus();
      else if (focus === "current Search control") await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Search", exact: true }).focus();
    }
    finally { release(); }
    const field = page.getByRole("searchbox", { name: "Search CyberJudah", exact: true });
    await expect(field).toBeVisible();
    if (focus !== "another control") await expect(field).toBeFocused();
    else {
      await expect(next).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/classes/);
    }
  });
}

for (const theme of ["default", "dark", "sepia"]) {
  test(`sheets: ${theme} main routes fit arbitrary window widths`, async ({ page }) => {
    await setup(page, theme);
    for (const path of ["/", "/read/genesis/1", "/classes", "/books", "/timeline", "/people", "/ask", "/settings", "/bookmarks", "/search", "/tabs", "/plan", "/precepts", "/settings/reminders"]) {
      await page.goto(`${path}${LAUNCH}`);
      if (path.includes("/read/")) await page.locator("#verset-1").waitFor();
      else if (path === "/tabs") await page.getByRole("toolbar", { name: "Tabs" }).waitFor();
      else if (path === "/search") await page.getByRole("searchbox", { name: "Search CyberJudah" }).waitFor();
      else await page.locator(".route").getByRole("heading").first().waitFor();
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}`).toBeLessThanOrEqual(width);
        await expect.poll(() => page.locator(".route").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${path} at ${width}`).toBe(true);
      }
    }
  });
}

for (const reduced of [false, true]) {
  test(`sheets: Bible Strong's detents, with safe insets and ${reduced ? "reduced" : "normal"} motion`, async ({ page }) => {
    await setup(page);
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK.replace(
      'safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }, contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }',
      'safeAreaInset: { top: 24, bottom: 30, left: 14, right: 20 }, contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 }',
    ) }));
    await page.addInitScript(() => {
      (window as any).__sheetFrames = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.classList.contains("bs-sheet")) (window as any).__sheetFrames.push(frames);
        return animate.call(this, frames, options);
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/read/genesis/1${LAUNCH}`); await page.locator("#verset-1").click();
    const selection = page.locator(".bs-selected");
    await expect(selection).toBeVisible();
    await selection.focus();
    // Bible Strong's selection sheet (a TrueSheet) runs edge to edge along the bottom: rounded on
    // top only, its content kept inside the safe insets.
    await expect(selection).toHaveCSS("border-top-left-radius", "36px");
    await expect(selection).toHaveCSS("border-top-right-radius", "36px");
    await expect(selection).toHaveCSS("border-bottom-right-radius", "0px");
    await expect(page.locator(".bs-scrim--clear")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".bs-scrim--clear")).toHaveCSS("pointer-events", "none");
    await expect.poll(async () => Math.round((await selection.boundingBox())!.x)).toBe(0);
    await expect.poll(async () => { const r = (await selection.boundingBox())!; return Math.round(844 - r.y - r.height); }).toBe(0);
    const rect = (await selection.boundingBox())!;
    expect(Math.round(rect.width)).toBe(390);
    await expect(selection).toHaveCSS("padding-left", "14px");
    await expect(selection).toHaveCSS("padding-right", "20px");
    expect(parseFloat(await selection.evaluate(e => getComputedStyle(e).paddingBottom))).toBeGreaterThanOrEqual(30);
    // It keeps its content's height: there is no expanding it, only a grabber.
    await expect(selection.getByRole("button", { name: "Expand sheet", exact: true })).toHaveCount(0);
    // Bible Strong's tags sheet keeps one detent (70%): a pull up does not grow it.
    await page.getByRole("button", { name: "Tag", exact: true }).click();
    const tags = page.getByRole("dialog", { name: /^Tags for / });
    await expect(tags).toHaveCSS("border-bottom-left-radius", "36px");
    await expect(tags.getByRole("button", { name: "Expand sheet", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(tags).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Font and settings has Bible Strong's two detents, 40% then full: a pull up on the grabber
    // takes it to full height, edge to edge; the grabber goes back and forth.
    await page.getByRole("button", { name: "Scripture options" }).click();
    await page.getByRole("menuitem", { name: "Font and settings", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Font and settings", exact: true });
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "36px");
    const max = 844 - 24 - 8;
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(Math.round(.4 * max));
    await page.waitForTimeout(550);
    const handle = (await sheet.locator(".bs-sheet__handle").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 2); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 6 }); await page.mouse.up();
    await expect(sheet).toHaveClass(/bs-sheet--full/);
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "0px");
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(390);
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.height)).toBe(max);
    await sheet.getByRole("button", { name: "Collapse sheet", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(sheet).not.toHaveClass(/bs-sheet--full/);
    await expect(sheet.getByRole("button", { name: "Expand sheet", exact: true })).toBeFocused();
    await sheet.getByRole("button", { name: "Expand sheet", exact: true }).click();
    await expect(sheet).toHaveClass(/bs-sheet--full/);
    await page.keyboard.press("Escape"); await expect(sheet).toHaveCount(0);
  });
}

for (const width of [390, 768, 1280]) {
  test(`sheets: actions at ${width} anchor to their control and keep the page usable`, async ({ page }) => {
    await setup(page); await page.setViewportSize({ width, height: 844 });
    await page.goto(`/tabs${LAUNCH}`);
    const trigger = page.getByRole("button", { name: /\. Groups$/ }); await trigger.click();
    const menu = page.getByRole("dialog", { name: "Groups", exact: true });
    await expect(menu).toBeVisible(); await expect(menu).toHaveAttribute("aria-modal", "false");
    // iOS 26: tapping outside closes an anchored menu, so it has no Cancel row.
    await expect(menu.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-modal");
    const from = (await trigger.boundingBox())!;
    // This trigger is at the bottom, so the anchored menu opens immediately above it.
    await expect.poll(async () => { const r = (await menu.boundingBox())!; return Math.abs(from.y - r.y - r.height - 8); }).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Add a tab", exact: true }).click();
    await expect(menu).toHaveCount(0); await expect(page).toHaveURL(/\/new/);
    await expect(page.getByRole("heading", { name: "What would you like to explore?" })).toBeVisible();
    await page.goto(`/tabs${LAUNCH}`);
    await trigger.click(); await expect(menu).toBeVisible();
    const outside = page.getByRole("button", { name: "Add a tab", exact: true });
    await outside.focus(); await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
    await expect(outside).toBeFocused();
    await trigger.click(); await expect(menu).toBeVisible();
    await page.setViewportSize({ width: width < 768 ? 1280 : 390, height: 844 });
    await expect(menu).toHaveAttribute("aria-modal", "false");
    await expect(page.locator("html")).not.toHaveAttribute("data-modal");
    await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-modal"); await expect(trigger).toBeFocused();
  });
}

// The native snapshot can arrive after the selector's parent effects have run.
// The current book must scroll when the list actually mounts, including slow snapshots.
test("menus: the book picker brings the current book into view, however long the list", async ({ page }) => {
  await setup(page);
  await page.route(`${DATA_ORIGIN}/api/kjv/books.json`, r => r.fulfill({ json: Array.from({ length: 41 }, (_, i) => ({
    book: i === 40 ? "Genesis" : `Book fixture ${i + 1}`, slug: i === 40 ? "genesis" : `fixture-${i}`, chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis", chapterIds: [1],
  })) }));
  await page.goto(`/read/genesis/1${LAUNCH}`); await page.locator("#verset-1").waitFor();
  await page.getByRole("button", { name: /Choose book and chapter/ }).click();
  await expect(page.getByRole("dialog", { name: "Books", exact: true })).toBeVisible();
  await expect(page.locator(".bs-bookrow[data-current]")).toBeInViewport();
});

for (const theme of ["default", "dark", "sepia"]) {
  test(`sheets: ${theme} photo framing and full forms fit resized windows`, async ({ page }) => {
    await setup(page, theme);
    await page.route("**/api/me", r => r.fulfill({ json: { admin: true, canEdit: true } }));
    await page.route("**/api/photos", r => r.fulfill({ json: {} }));
    await page.route("**/api/chats", r => r.fulfill({ json: { chats: [] } }));
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/timeline/event/iuic-founded-2003${LAUNCH}`);
    await page.getByRole("button", { name: "Change photo" }).click();
    await page.locator(".photo-edit input[type=file]").setInputFiles({ name: "layout.png", mimeType: "image/png", buffer: await page.screenshot() });
    const photo = page.getByRole("dialog", { name: "Leader's portrait" });
    await expect(photo.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    for (const width of [320, 1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      // At zoom 1 this portrait screenshot covers a square crop exactly across its width.
      await expect.poll(() => photo.locator(".photo-frame").evaluate(el => Math.abs(el.clientWidth - el.querySelector("canvas")!.getBoundingClientRect().width))).toBeLessThanOrEqual(1);
      expect(await photo.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const box = (await photo.boundingBox())!, frame = (await photo.locator(".photo-frame").boundingBox())!;
      expect(frame.x - box.x).toBeGreaterThanOrEqual(20);
      expect(box.x + box.width - frame.x - frame.width).toBeGreaterThanOrEqual(20);
    }
    await page.keyboard.press("Escape");
    await page.goto(`/ask${LAUNCH}`); await page.getByRole("button", { name: "Your chats", exact: true }).click();
    const chats = page.getByRole("dialog", { name: "Your chats", exact: true });
    await expect(chats).toHaveCSS("border-top-left-radius", "36px"); await expect(chats).toHaveCSS("border-bottom-left-radius", "0px");
    await page.keyboard.press("Escape");
    await page.goto(`/read/genesis/1${LAUNCH}`); await page.getByRole("button", { name: "Scripture options" }).click();
    await page.getByRole("menuitem", { name: "Font and settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Font and settings", exact: true });
    // It opens at Bible Strong's first detent (40%), floating inset.
    await expect(settings).toBeVisible(); await expect(settings).toHaveCSS("border-bottom-left-radius", "36px");
    expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  });
}

for (const theme of ["default", "dark", "sepia"]) {
  for (const scene of ["settings", "more", "books", "bookmarks", "reminders", "chats"]) {
    test(`lists: ${theme} ${scene} keeps grouped rows reachable at large text`, async ({ page }) => {
      await setup(page, theme);
      await page.addInitScript(() => { (window as any).__cloud.bs_bm = JSON.stringify([{ id: "layout-bookmark", name: "Genesis 1", book: "genesis", chapter: 1, verse: 1, color: "#0984e3", date: 1 }]); });
      await page.route(`${DATA_ORIGIN}/api/library/index.json`, r => r.fulfill({ json: [{ slug: "layout", title: "Library layout fixture", subtitle: "", author: "Test", year: 2026, pages: 12, volumes: 1, chapters: 1, figures: 0, cover: null, reads: 1, classes: 1 }] }));
      await page.route("**/api/chats", r => r.fulfill({ json: { chats: [{ id: "layout-chat", title: "Reading layout", updated: "2026-10-01T12:00:00Z", count: 1 }] } }));
      for (const [width, scale] of [[390, 100], [390, 200], [1280, 100], [1280, 200]]) {
        await page.setViewportSize({ width, height: 844 });
        const path = scene === "reminders" ? "/settings/reminders" : scene === "chats" ? "/ask" : `/${scene}`;
        await page.goto(`${path}${LAUNCH}`);
        await page.locator(".route").getByRole("heading").first().waitFor();
        await page.addStyleTag({ content: `html { font-size: ${scale}% !important; }` });
        if (scene === "chats") { await page.getByRole("button", { name: "Your chats", exact: true }).click(); await page.locator(".chats__open").waitFor();
          await page.getByRole("dialog", { name: "Your chats", exact: true }).evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
        }
        const selector = scene === "chats" ? ".chats__open, .chats__del" : scene === "more" ? ".mcard__row" : ".list .row, .list .toggle";
        const rows = page.locator(selector); await expect(rows.first()).toBeVisible();
        if (scene === "more" || scene === "chats") { const label = page.locator(scene === "more" ? ".mcard__label" : ".chats__open b").first(); expect(await label.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe((scene === "more" ? 15 : 15.5) * scale / 100); }
        for (const row of await rows.all()) {
          const rect = (await row.boundingBox())!;
          // 44 px targets; a hundredth of a pixel allows for float error in a sheet's layout (Firefox
          // reports 43.99999 for a 44 px row).
          expect(rect.height, `${scene} at ${width}/${scale}`).toBeGreaterThanOrEqual(43.99);
          expect(rect.width).toBeGreaterThanOrEqual(43.99);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const caps = await page.locator("h2, h3, .eyebrow, .mcard__head").evaluateAll(els => els.filter(el => getComputedStyle(el).textTransform === "uppercase").map(el => el.textContent));
        expect(caps).toEqual([]);
        if (["settings", "reminders"].includes(scene)) {
          if (scene === "reminders") await expect(page.getByRole("group", { name: "Settings", exact: true })).toBeVisible();
          const groups = page.locator("fieldset.form-section");
          expect(await groups.count()).toBeGreaterThan(0);
          if (scene === "settings") await expect(page.getByRole("group", { name: "Reading", exact: true })).toBeVisible();
        }
        if (scene === "more") await expect(page.getByRole("heading", { name: "Resources", exact: true })).toBeVisible();
        if (scene === "chats") { await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Your chats", exact: true })).toHaveCount(0); }
      }
    });
  }
}
