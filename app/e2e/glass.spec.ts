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
  await expect(page.getByRole("menu", { name: "Passage options" })).toBeVisible();
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

for (const theme of ["default", "sepia", "nature", "sunset", "dark", "black", "mauve", "night"]) {
  test(`navigation: ${theme} reserves the remaining width and keeps every sidebar control reachable`, async ({ page }) => {
    await setup(page, theme);
    await page.setViewportSize({ width: 899, height: 844 });
    await page.goto(`/settings${LAUNCH}`);
    await expect(page.getByRole("switch", { name: "Justify the text", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav).toBeVisible();
    const labels = await nav.locator(".tab").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")));
    const badge = await nav.locator(".tab__count").innerText();
    await expect(nav).toHaveCSS("flex-direction", "row");
    for (const width of [900, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(nav).toHaveCSS("flex-direction", "column");
      await expect(nav).not.toHaveAttribute("data-mini");
      expect(await nav.locator(".tab").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")))).toEqual(labels);
      await expect(nav.locator(".tab__count")).toHaveText(badge);
      for (const button of await nav.getByRole("button").all()) {
        expect(await button.evaluate(b => b.tabIndex)).toBe(0);
        const box = (await button.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const rail = (await nav.boundingBox())!, content = (await page.locator(".route > .screen").boundingBox())!;
      expect(content.x).toBeGreaterThanOrEqual(rail.x + rail.width);
      expect(content.x + content.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(2);
    }
  });
}

test("navigation: resizing a minimized dock restores keyboard and first-click navigation", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 899, height: 844 });
  await page.goto(`/settings${LAUNCH}`);
    await expect(page.getByRole("switch", { name: "Justify the text", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Sections" });
  await page.getByRole("switch", { name: "Justify the text", exact: true }).hover();
  await page.mouse.wheel(0, 300);
  await expect(nav).toHaveAttribute("data-mini", "");
  const mini = (await nav.boundingBox())!;
  expect(mini.width).toBeGreaterThanOrEqual(44); expect(mini.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(nav).not.toHaveAttribute("data-mini");
  const classes = nav.getByRole("button", { name: "Classes", exact: true });
  await expect(classes).not.toHaveAttribute("tabindex", "-1");
  await classes.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/classes/);
  await page.goto(`/settings${LAUNCH}`);
    await expect(page.getByRole("switch", { name: "Justify the text", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Justify the text", exact: true }).hover();
  await page.mouse.wheel(0, 300);
  await expect(nav).not.toHaveAttribute("data-mini");
  await nav.getByRole("button", { name: "Bible", exact: true }).click();
  await expect(page).toHaveURL(/\/read\//);
});

test("navigation: document, Bible and Timeline scrolls minimize down and expand up", async ({ page }) => {
  await setup(page, "sepia");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nav = page.getByRole("navigation", { name: "Sections" });
  for (const [path, selector] of [["/settings", "html"], ["/read/genesis/1", ".bs-scroll"], ["/timeline", "html"], ["/timeline/0", ".tl-scroll"]]) {
    await page.goto(`${path}${LAUNCH}`);
    const scroller = page.locator(selector);
    await expect(scroller).toBeVisible();
    if (selector === "html") await expect(page.getByRole("heading", { name: path === "/settings" ? "Settings" : "The Bible Timeline", exact: true })).toBeVisible();
    if (selector === ".bs-scroll") await expect(page.locator("#verset-1")).toBeVisible();
    await scroller.hover({ position: { x: 250, y: 300 } });
    const travel = await scroller.evaluate(el => Math.min(180, (el.scrollHeight - el.clientHeight) / 2));
    expect(travel, path).toBeGreaterThan(48);
    await page.mouse.wheel(0, travel);
    await expect(nav, path).toHaveAttribute("data-mini", "");
    const mini = (await nav.boundingBox())!;
    expect(mini.width).toBeGreaterThanOrEqual(44); expect(mini.height).toBeGreaterThanOrEqual(44);
    // The first wheel is asynchronous, even with reduced CSS motion. Reverse after
    // its real scroll reaches the requested position, then verify upward travel too.
    await expect.poll(() => scroller.evaluate(el => el.scrollTop), path).toBeGreaterThanOrEqual(travel - 1);
    const down = await scroller.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, -80);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop), path).toBeLessThan(down - 14);
    await expect(nav, path).not.toHaveAttribute("data-mini");
  }
  await page.goto(`/timeline/0${LAUNCH}`);
  const canvas = page.locator(".tl-scroll");
  await canvas.hover();
  await expect(nav).not.toHaveAttribute("data-mini");
  const vertical = await canvas.evaluate(el => el.scrollTop);
  await page.mouse.wheel(700, 0);
  await expect.poll(() => canvas.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await canvas.evaluate(el => el.scrollTop)).toBe(vertical);
  await expect(nav).not.toHaveAttribute("data-mini");
});

for (const preference of ["normal", "app", "contrast", "forced"] as const) {
  test(`navigation: approved period art extends behind the sidebar without another backdrop (${preference})`, async ({ page }) => {
    await setup(page, "default", preference === "app");
    await page.route("**/api/photos", r => r.fulfill({ json: {} }));
    await page.emulateMedia({ contrast: preference === "contrast" ? "more" : "no-preference", forcedColors: preference === "forced" ? "active" : "none" });
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(`/timeline/0${LAUNCH}`);
    const extension = page.locator(".rail-background");
    await expect(extension).toHaveAttribute("aria-hidden", "true");
    await expect(extension.locator("img")).toHaveAttribute("src", /timeline\/periods\/1\.webp$/);
    if (preference === "normal") {
      await expect(extension).toBeVisible();
      expect(await extension.locator("img").evaluate(e => new DOMMatrix(getComputedStyle(e).transform).a)).toBe(-1);
      const rail = (await page.locator("nav.tabs").boundingBox())!, content = (await page.locator(".tl-period").boundingBox())!;
      expect(content.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    } else await expect(extension).toBeHidden();
    expect(await extension.evaluate(e => getComputedStyle(e).backdropFilter || getComputedStyle(e).getPropertyValue("-webkit-backdrop-filter"))).toBe("none");
    expect((await filteredSurfaces(page)).length).toBeLessThanOrEqual(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(extension).toBeHidden();
  });
}

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
    await picker.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".bs-picker")).toHaveCount(0);
    await expect(pickerTrigger).toBeFocused();
    const motion = await page.evaluate(() => ({ native: !!document.startViewTransition, calls: (window as any).__popoverTransitions, frames: (window as any).__popoverFrames }));
    if (mode === "native" && motion.native) expect(motion.calls).toBeGreaterThanOrEqual(4);
    else expect(motion.calls).toBe(0);
    if (mode === "reduced") {
      expect(motion.frames.length).toBeGreaterThanOrEqual(4);
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
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".sheet[data-popover]")).toHaveCount(0);
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
  test(`sheets: half expands to full with safe insets and ${reduced ? "reduced" : "normal"} motion`, async ({ page }) => {
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
    await expect(selection).toHaveCSS("border-top-left-radius", "36px");
    await expect(selection).toHaveCSS("border-bottom-right-radius", "36px");
    await expect(page.locator(".bs-scrim--clear")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".bs-scrim--clear")).toHaveCSS("pointer-events", "none");
    await expect.poll(async () => Math.round((await selection.boundingBox())!.x)).toBe(22);
    await expect.poll(async () => { const r = (await selection.boundingBox())!; return Math.round(844 - r.y - r.height); }).toBe(38);
    const rect = (await selection.boundingBox())!;
    expect(Math.round(390 - rect.x - rect.width)).toBe(28);
    await page.getByRole("button", { name: "Tag", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Edit tags", exact: true });
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "36px");
    await expect(sheet).toHaveClass(/bs-sheet--half/);
    await sheet.evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
    const handle = (await sheet.locator(".bs-sheet__handle").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 2); await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 6 }); await page.mouse.up();
    await expect(sheet).toHaveClass(/bs-sheet--full/);
    await expect(sheet).toHaveCSS("border-bottom-left-radius", "0px");
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(390);
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.x)).toBe(0);
    const frames = await page.evaluate(() => (window as any).__sheetFrames);
    expect(frames).toHaveLength(1);
    expect(frames[0].every((f: object) => Object.keys(f).every(k => ["transform", "opacity", "offset", "easing", "composite"].includes(k)))).toBe(true);
    if (reduced) expect(frames[0].every((f: { transform: string }) => f.transform === "none")).toBe(true);
    expect((await materials(page, [[".bs-sheet--full"]]))[0]).toMatchObject({ filter: "none", alpha: 255 });
    await sheet.getByRole("button", { name: "Collapse sheet", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(sheet).toHaveClass(/bs-sheet--half/);
    await expect(sheet.getByRole("button", { name: "Expand sheet", exact: true })).toBeFocused();
    await sheet.getByRole("button", { name: "Expand sheet", exact: true }).click();
    await expect(sheet).toHaveClass(/bs-sheet--full/);
    await sheet.getByRole("button", { name: "Close", exact: true }).click(); await expect(sheet).toHaveCount(0);
  });
}

for (const width of [390, 768, 1280]) {
  test(`sheets: actions at ${width} anchor and keep the page usable on large screens`, async ({ page }) => {
    await setup(page); await page.setViewportSize({ width, height: 844 });
    await page.goto(`/tabs${LAUNCH}`);
    const trigger = page.getByRole("button", { name: /\. Groups$/ }); await trigger.click();
    const menu = page.getByRole("dialog", { name: "Groups", exact: true });
    await expect(menu).toBeVisible(); await expect(menu).toHaveAttribute("aria-modal", String(width < 768));
    if (width >= 768) {
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
    } else {
      await expect(page.locator("html")).toHaveAttribute("data-modal", "");
      await expect.poll(async () => Math.round((await menu.boundingBox())!.x)).toBe(8);
      await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    }
    await trigger.click(); await expect(menu).toBeVisible();
    await page.setViewportSize({ width: width < 768 ? 1280 : 390, height: 844 });
    await expect(menu).toHaveAttribute("aria-modal", String(width >= 768));
    if (width >= 768) await expect(page.locator("html")).toHaveAttribute("data-modal", "");
    else await expect(page.locator("html")).not.toHaveAttribute("data-modal");
    await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute("data-modal"); await expect(trigger).toBeFocused();
  });
}

// The native snapshot can arrive after the selector's parent effects have run.
// The current book must scroll when the list actually mounts, including slow snapshots.
test("menus: a delayed picker mount still brings the current book into view", async ({ page }) => {
  await setup(page);
  await page.route(`${DATA_ORIGIN}/api/kjv/books.json`, r => r.fulfill({ json: Array.from({ length: 41 }, (_, i) => ({
    book: i === 40 ? "Genesis" : `Book fixture ${i + 1}`, slug: i === 40 ? "genesis" : `fixture-${i}`, chapters: 50, verses: 1533, testament: "Old Testament", url: "/bible/genesis", chapterIds: [1],
  })) }));
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    document.startViewTransition = ((update: () => void | Promise<void>) => {
      const gate = new Promise<void>(resolve => { (window as any).__releasePicker = resolve; });
      const run = async () => { (window as any).__pickerSnapshotWaiting = true; await gate; await update(); };
      if (original) return original(run);
      const finished = run();
      return { finished, ready: finished, updateCallbackDone: finished, skipTransition() {} };
    }) as typeof document.startViewTransition;
  });
  await page.goto(`/read/genesis/1${LAUNCH}`); await page.locator("#verset-1").waitFor();
  await page.getByRole("button", { name: /Choose book and chapter/ }).click();
  await page.waitForFunction(() => (window as any).__pickerSnapshotWaiting);
  // Let the parent's already-queued effects/timers finish before releasing the mount.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  await page.evaluate(() => (window as any).__releasePicker());
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
    await photo.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`/ask${LAUNCH}`); await page.getByRole("button", { name: "Your chats", exact: true }).click();
    const chats = page.getByRole("dialog", { name: "Your chats", exact: true });
    await expect(chats).toHaveCSS("border-top-left-radius", "36px"); await expect(chats).toHaveCSS("border-bottom-left-radius", "0px");
    await chats.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(`/read/genesis/1${LAUNCH}`); await page.getByRole("button", { name: "Scripture options" }).click();
    await page.getByRole("menuitem", { name: "Font and settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Font and settings", exact: true });
    await expect(settings).toBeVisible(); await expect(settings).toHaveCSS("border-bottom-left-radius", "0px");
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
          expect(rect.height, `${scene} at ${width}/${scale}`).toBeGreaterThanOrEqual(44);
          expect(rect.width).toBeGreaterThanOrEqual(44);
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
        if (scene === "chats") { await page.getByRole("dialog", { name: "Your chats", exact: true }).getByRole("button", { name: "Close", exact: true }).click(); await expect(page.getByRole("dialog", { name: "Your chats", exact: true })).toHaveCount(0); }
      }
    });
  }
}
