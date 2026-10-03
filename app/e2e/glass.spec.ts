import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

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

/** Conservative budget: includes intersecting surfaces even if another panel covers them. */
async function filteredSurfaces(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("body *")].flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const s = getComputedStyle(ancestor);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return [];
    }
    return [undefined, "::before", "::after"].flatMap(pseudo => {
      const s = getComputedStyle(element, pseudo);
      const filter = s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter");
      return filter && filter !== "none" && (!pseudo || !["none", "normal"].includes(s.content)) ? [`${element.className}${pseudo ?? ""}`] : [];
    });
  }));
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

async function dragStart(page: Page) {
  const dock = page.getByRole("navigation", { name: "Sections" });
  const from = (await dock.locator(".tab[data-on]").boundingBox())!;
  const to = (await dock.getByRole("button", { name: "Classes", exact: true }).boundingBox())!;
  await dock.evaluate(nav => nav.addEventListener("pointerdown", e => nav.setAttribute("data-test-pointer", String((e as PointerEvent).pointerId)), { once: true }));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await expect(dock).toHaveAttribute("data-drag", "");
  return dock;
}

for (const theme of ["default", "sepia", "nature", "sunset", "dark", "black", "mauve", "night"]) {
  test(`glass: ${theme} uses one material behind crisp, reachable controls`, async ({ page }) => {
    await setup(page, theme);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    await expect(page.locator("#verset-1")).toBeVisible();
    const dock = page.getByRole("navigation", { name: "Sections" });
    await expect(page.locator("html")).toHaveAttribute("data-palette", theme);
    // Palette changes can start color transitions; sample the settled theme without
    // changing the contrast threshold.
    await dock.evaluate(async nav => {
      await Promise.all(nav.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
    const material = await dock.evaluate(nav => {
      const get = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
      const layers = [...nav.querySelectorAll("*")].map(el => ({ filter: get(el).filter, backdrop: get(el).backdropFilter || get(el).getPropertyValue("-webkit-backdrop-filter") }));
      return { backdrop: get(nav, "::before").backdropFilter || get(nav, "::before").getPropertyValue("-webkit-backdrop-filter"), layers };
    });
    expect(material.backdrop).toContain("blur(");
    expect(material.layers.every(s => s.filter === "none" && (!s.backdrop || s.backdrop === "none"))).toBe(true);
    await expect(dock.getByRole("button", { name: "Bible", exact: true })).toHaveAttribute("aria-current", "page");
    // The tabs fade their ink when the theme applies (transition: color); measure them at rest,
    // not mid-fade, which WebKit can catch right after load.
    await page.waitForFunction(() => document.getAnimations().every(a => !(a instanceof CSSTransition) || a.playState !== "running"));
    // Check actual computed material/ink colours against both extreme backdrops. A translucent
    // selection must remain legible even when a bright picture or dark passage moves underneath.
    const minimumContrast = await dock.evaluate(nav => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const sample = (...colours: string[]) => {
        ctx.clearRect(0, 0, 1, 1);
        for (const colour of colours) { ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1); }
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
      const material = getComputedStyle(nav, "::before").backgroundColor;
      const selected = getComputedStyle(nav.querySelector(".tabs__pill")!).backgroundColor;
      return Math.min(...["#000", "#fff"].flatMap(backdrop => [...nav.querySelectorAll(".tab")].map(button => {
        const ink = lum(sample(getComputedStyle(button).color));
        const ground = lum(sample(backdrop, material, ...(button.hasAttribute("data-on") ? [selected] : [])));
        return (Math.max(ink, ground) + .05) / (Math.min(ink, ground) + .05);
      })));
    });
    expect(minimumContrast).toBeGreaterThanOrEqual(4.5);

    for (const button of await dock.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await dock.getByRole("button", { name: "Search", exact: true }).click();
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
  // The drawer pushes the dock offscreen; Escape closes it and returns to its trigger.
  await page.keyboard.press("Escape");
  await expect(page.locator(".drawer--more")).not.toHaveAttribute("data-open");
  await menu.click();
  await expect(page.locator(".drawer--more")).toHaveAttribute("data-open", "");
});

test("glass: a canceled drag restores selection and the next keyboard activation works", async ({ page }) => {
  await setup(page);
  await page.goto(`/search${LAUNCH}`);
  const dock = await dragStart(page);
  await dock.evaluate(nav => nav.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: Number(nav.getAttribute("data-test-pointer")), isPrimary: true })));
  await page.mouse.up();
  await expect(dock).not.toHaveAttribute("data-lift");
  await expect(page).toHaveURL(/\/search/);
  await dock.getByRole("button", { name: "Classes", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/classes/);
});

test("glass: reduced motion keeps the selection and icons steady while dragging still navigates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await setup(page);
  await page.goto(`/search${LAUNCH}`);
  const dock = await dragStart(page);
  const styles = await dock.evaluate(nav => {
    const pill = getComputedStyle(nav.querySelector(".tabs__pill")!);
    const matrix = new DOMMatrix(pill.transform);
    return { scale: pill.scale, x: matrix.a, y: matrix.d, icons: [...nav.querySelectorAll(".tab__glyph")].map(el => getComputedStyle(el).scale) };
  });
  expect(styles.scale).toBe("none");
  expect(styles.x).toBe(1); expect(styles.y).toBe(1);
  expect(styles.icons.every(scale => scale === "none")).toBe(true);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/classes/);
});

test("glass: Reduce transparency keeps the reader's dock opaque, including while pressed", async ({ page }) => {
  await setup(page, "sepia", true);
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-transparency", "reduced");
  const dock = await dragStart(page);
  const material = await dock.evaluate(nav => {
    const s = getComputedStyle(nav, "::before");
    return { background: s.backgroundColor, canvas: getComputedStyle(document.body).backgroundColor, filter: s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter") };
  });
  expect(material.background).toBe(material.canvas);
  expect(material.filter).toBe("none");
  await page.mouse.up();
  await expect(page).toHaveURL(/\/classes/);
});

test("glass: increased contrast removes transparency and marks selection with an outline", async ({ page }) => {
  await page.emulateMedia({ contrast: "more" });
  await setup(page, "dark");
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  const material = await page.locator("nav.tabs").evaluate(nav => {
    const s = getComputedStyle(nav, "::before");
    return { background: s.backgroundColor, canvas: getComputedStyle(document.body).backgroundColor, filter: s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter"), outline: getComputedStyle(nav.querySelector(".tabs__pill")!).outlineStyle };
  });
  expect(material.background).toBe(material.canvas);
  expect(material.filter).toBe("none");
  expect(material.outline).toBe("solid");
});

test("glass: the desktop rail drags vertically and the next tap still works", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await setup(page);
  await page.goto(`/search${LAUNCH}`);
  const dock = await dragStart(page);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/classes/);
  await expect(dock.getByRole("button", { name: "Classes", exact: true })).toHaveAttribute("aria-current", "page");
  await dock.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
});

test("glass: transferring touch capture from the button to the dock does not cancel a drag", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Real touch dispatch uses Chromium's device input protocol; WebKit covers pointer interactions above.");
  await setup(page);
  await page.goto(`/search${LAUNCH}`);
  const dock = page.getByRole("navigation", { name: "Sections" });
  const from = (await dock.locator(".tab[data-on]").boundingBox())!;
  const to = (await dock.getByRole("button", { name: "Classes", exact: true }).boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const y = from.y + from.height / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x + from.width / 2, y }] });
  for (let i = 1; i <= 8; i++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + from.width / 2 + (to.x - from.x) * i / 8, y }] });
  }
  await expect(dock).toHaveAttribute("data-drag", "");
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/classes/);
  // Let the selection settle before starting a separate touch gesture.
  await expect(dock.locator(".tabs__pill")).not.toHaveAttribute("data-flow");
  await dock.getByRole("button", { name: "Search", exact: true }).tap();
  await expect(page).toHaveURL(/\/search/);
  await session.detach();
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
        for (const material of await materials(page, [[".bs-header", "::before"], [".tabs", "::before"], [".bs-dropdown"]])) {
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
      expect((await materials(page, [[".head", "::before"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
      await page.locator(".book__figure").click();
      await expect(page.locator(".pv")).toBeVisible();
      expect((await materials(page, [[".pv__bar", "::before"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
      await expect.poll(() => filteredSurfaces(page)).toEqual([]);
    });
  }
}

test("materials: header, menu and selection stay within budget without stacked glass", async ({ page }) => {
  await setup(page);
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Scripture options" }).click();
  const menu = page.getByRole("menu", { name: "Passage options" });
  await expect(menu).toBeVisible();
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(3);
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
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(2);
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
  await expect.poll(() => filteredSurfaces(page)).toHaveLength(2);
  expect((await materials(page, [[".book__figure"]]))[0].filter).toBe("none");
  await page.locator(".book__figure").click();
  await expect(page.locator(".pv__bar")).toBeVisible();
  await expect.poll(() => filteredSurfaces(page)).toEqual(["pv__bar::before"]);
  await page.locator(".pv").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".pv")).toHaveCount(0);
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
  for (const material of await materials(page, [[".bs-header", "::before"], [".tabs", "::before"], [".bs-dropdown"]])) expect(material).toMatchObject({ filter: "none", alpha: 255 });
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
          return l.left >= b.left && l.right <= b.right && l.top >= b.top && l.bottom <= b.bottom && label.scrollWidth <= label.clientWidth + 1;
        }))).toBe(true);
        await toggle.focus();
        const before = await toggle.getAttribute("aria-checked");
        await page.keyboard.press("Space");
        await expect(toggle).toHaveAttribute("aria-checked", String(before !== "true"));
        const knob = toggle.locator(".switch");
        const restShadow = await knob.evaluate(e => getComputedStyle(e, "::after").boxShadow);
        await toggle.hover(); await page.mouse.down();
        await expect.poll(() => knob.evaluate(e => new DOMMatrix(getComputedStyle(e, "::after").transform).a)).toBe(preference === "motion" ? 1 : 1.2);
        if (preference !== "forced") expect(await knob.evaluate(e => getComputedStyle(e, "::after").boxShadow)).not.toBe(restShadow);
        if (["system", "app", "contrast", "forced"].includes(preference)) expect((await materials(page, [[".switch", "::after"]]))[0].alpha).toBe(255);
        await page.mouse.up();
        const label = (await toggle.locator("b").boundingBox())!, thumb = (await toggle.locator(".switch").boundingBox())!;
        expect(label.x + label.width).toBeLessThanOrEqual(thumb.x);
        const dock = page.locator("nav.tabs");
        if (await dock.getAttribute("data-mini") !== null) await dock.click();
        await expect(dock).not.toHaveAttribute("data-mini");
        const bounds = (await dock.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(14);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width - 20);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 30);
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
          for (const m of await materials(page, [[".bs-header", "::before"], [".tabs", "::before"], [".bs-dropdown"]])) {
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

test("controls: an overflowing rail scrolls natively and restores drag after resizing", async ({ page, browserName }) => {
  await setup(page);
  await page.addInitScript(() => {
    (window as unknown as { __cloud: Record<string, string> }).__cloud.nav = JSON.stringify(["plan", "bookmarks", "precepts", "library", "bible", "search"]);
  });
  await page.setViewportSize({ width: 1280, height: 550 });
  await page.goto(`/read/genesis/1${LAUNCH}`);
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const dock = page.getByRole("navigation", { name: "Sections" });
  await expect(dock).toHaveAttribute("data-scrollable", "");
  const bounds = (await dock.boundingBox())!, menu = dock.getByRole("button", { name: "Menu", exact: true });
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeGreaterThan(bounds.y + bounds.height);
  // Start on the selected Bible control: scrolling must not drag the pill to another route.
  const selected = (await dock.getByRole("button", { name: "Bible", exact: true }).boundingBox())!;
  const x = selected.x + selected.width / 2, y = selected.y + selected.height / 2;
  if (browserName === "chromium") {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 20 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    // Playwright exposes native wheel input in WebKit, but no touch-move protocol.
    await expect(dock).toHaveCSS("touch-action", "pan-y");
    await page.mouse.move(x, y); await page.mouse.wheel(0, 500);
  }
  await expect.poll(() => dock.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  await expect(dock).not.toHaveAttribute("data-lift");
  await expect.poll(async () => { const m = (await menu.boundingBox())!; return m.y + m.height; }).toBeLessThanOrEqual(bounds.y + bounds.height);
  const m = (await menu.boundingBox())!;
  // Coordinate input cannot secretly scroll an offscreen target into view.
  await page.touchscreen.tap(m.x + m.width / 2, m.y + m.height / 2);
  await expect(page.locator(".drawer--more")).toHaveAttribute("data-open", "");
  await page.keyboard.press("Escape");
  await expect(dock).toHaveCSS("transform", "none");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dock).not.toHaveAttribute("data-scrollable");
  const from = (await dock.getByRole("button", { name: "Bible", exact: true }).boundingBox())!;
  const to = (await dock.getByRole("button", { name: "Search", exact: true }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(page).toHaveURL(/\/search/);
});

for (const theme of ["default", "dark", "sepia"]) {
  test(`controls: ${theme} nested sheet actions share accessible accent ink and keyboard behavior`, async ({ page }) => {
    await setup(page, theme);
    await page.goto(`/read/genesis/1${LAUNCH}`);
    await page.getByRole("button", { name: "Scripture options" }).click();
    await page.getByRole("menuitem", { name: /Font and settings/ }).click();
    await page.getByRole("button", { name: "Color palette", exact: true }).click();
    await page.locator(".bs-palette__row").first().click();
    const sheet = page.getByRole("dialog", { name: "Edit color", exact: true });
    const save = sheet.getByRole("button", { name: "Save", exact: true });
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
    for (const [path, selector] of [["/settings", ".screen > .head"], ["/search", ".srch__bar"], ["/ask", ".chat2__bar"], ["/read/genesis/1", ".bs-header"], ["/timeline", ".tlh"]]) {
      await page.goto(`${path}${LAUNCH}`);
      await expect(page.locator(selector)).toBeVisible();
      for (const bar of [selector, ".tabs"]) {
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
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  });
}
