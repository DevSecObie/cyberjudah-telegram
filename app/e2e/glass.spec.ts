import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

test.use({ hasTouch: true });

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
// Material and pointer tests don't require live library data or a signed-in account.
const LAUNCH = "#tgWebAppData=query_id%3Dglass-review&tgWebAppVersion=9.1&tgWebAppPlatform=ios";

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
