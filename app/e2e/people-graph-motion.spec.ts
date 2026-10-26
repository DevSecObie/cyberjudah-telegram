import { expect, test, type Locator, type Page } from "@playwright/test";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
async function setup(page: Page) {
  const ref = (id: string) => ({ id, name: id });
  const make = (id: string, family = {}) => ({ id, name: id, names: [id], type: "Male", description: "", tribe: "", father: [], mother: [], siblings: [], partners: [], children: [], verses: [], taught: [], source: { name: "Motion fixture", license: "", url: "" }, ...family });
  const people: Record<string, ReturnType<typeof make>> = {
    root: make("root", { children: [ref("one"), ...Array.from({ length: 7 }, (_, i) => ref(`child${i}`))] }),
    one: make("one", { father: [ref("root")], children: [ref("two"), ref("extra")] }),
    two: make("two", { father: [ref("one")], children: [ref("three")] }),
    three: make("three", { father: [ref("two")] }),
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => r.fulfill({ status: 404, body: "" }));
  await page.route(/\/api\/people\/(index|root|one|two|three)\.json$/, r => {
    const id = new URL(r.request().url()).pathname.split("/").pop()!.slice(0, -5);
    return r.fulfill({ json: id === "index" ? Object.values(people) : people[id] });
  });
  await page.goto("/person/root");
  await expect(page.locator(".fg__static-center b")).toHaveText("root");
  await page.clock.install();
  await page.clock.pauseAt(new Date());
}
const current = (page: Page) => page.locator(".fg__layer[data-current]");
const satellite = (page: Page, name: string) => current(page).locator(".fg__sat").filter({ has: page.locator("b", { hasText: new RegExp(`^${name}$`) }) });
// The clock is held so the initial frame can be asserted before any animation RAF runs.
const press = (button: Locator) => button.evaluate(el => (el as HTMLButtonElement).click());
async function walk(page: Page, id: string) {
  await press(satellite(page, id).getByRole("button"));
  await expect(current(page).locator(".fg__label--center b")).toHaveText(id);
}
async function frame(node: Locator) {
  return node.evaluate(el => { const s = getComputedStyle(el), m = new DOMMatrixReadOnly(s.transform); return { scale: m.a, x: m.e, y: m.f, opacity: Number(s.opacity) }; });
}

test("family motion: camera keeps both scenes, uses the pinned role scales and translates toward the selected node", async ({ page }) => {
  await setup(page);
  await walk(page, "one");
  await expect(page.locator(".fg__layer")).toHaveCount(2);
  expect((await frame(current(page).locator(".fg__center"))).scale).toBeCloseTo(.71, 5);
  expect((await frame(satellite(page, "root"))).scale).toBeCloseTo(1.42, 5);
  expect((await frame(satellite(page, "two"))).scale).toBeCloseTo(.3, 5);
  expect((await frame(current(page))).opacity).toBe(0);
  await page.clock.runFor(176);
  const target = await frame(current(page)), source = await frame(page.locator(".fg__layer:not([data-current])"));
  expect(target.opacity).toBeGreaterThan(0); expect(target.opacity).toBeLessThan(1);
  expect(target.x).toBeLessThan(0); expect(target.y).toBeLessThan(0);
  expect(source.x).toBeGreaterThan(0); expect(source.y).toBeGreaterThan(0);
  expect(source.opacity + target.opacity).toBeCloseTo(1, 5);
  const borders = await page.locator(".fg__layer:not([data-current])").evaluate(el => {
    const width = (selector: string) => parseFloat((el.querySelector(selector) as HTMLElement).style.borderWidth);
    return { selected: width(".fg__sat .avatar"), center: width(".fg__center .avatar") };
  });
  expect(borders.selected).toBeGreaterThan(1); expect(borders.selected).toBeLessThan(2);
  expect(borders.center).toBeGreaterThan(1); expect(borders.center).toBeLessThan(2);
  const backLine = await current(page).locator(".fg__line--back").evaluate(el => (el as SVGElement).style.stroke);
  expect(backLine).toContain("color-mix");
  await page.clock.runFor(600);
  await expect(page.locator(".fg__layer")).toHaveCount(1);
  await expect(page.locator(".fg__static-center b")).toHaveText("one");
  expect((await frame(current(page))).x).toBe(0);
});

test("family motion: pagination preserves the centre and has the150ms exit,200ms delay and350ms entry endpoint", async ({ page }) => {
  await setup(page);
  await page.locator(".fg__static-center").evaluate(el => el.setAttribute("data-identity", "same-centre"));
  await press(page.getByRole("button", { name: "Next page", exact: true }));
  await expect(page.locator(".fg__foot")).toHaveAttribute("aria-label", "Page 2 of 2");
  await expect(page.locator(".fg__layer")).toHaveCount(2);
  const target = current(page).locator(".fg__sat").first(), old = page.locator(".fg__layer:not([data-current]) .fg__sat").first();
  expect((await frame(target)).opacity).toBe(0); expect((await frame(old)).opacity).toBe(1);
  await page.clock.runFor(176);
  expect((await frame(target)).opacity).toBe(0); expect((await frame(old)).opacity).toBe(0);
  await page.clock.runFor(96);
  const entry = await frame(target);
  expect(entry.opacity).toBeGreaterThan(0); expect(entry.opacity).toBeLessThan(1);
  expect(entry.scale).toBeCloseTo(1, 5);
  const aligned = await target.evaluate(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform), x = parseFloat((el as HTMLElement).style.left) + 29 + m.e, y = parseFloat((el as HTMLElement).style.top) + 29 + m.f;
    const line = el.closest(".fg__layer")!.querySelector("line")!;
    return { x, y, lineX: Number(line.getAttribute("x2")), lineY: Number(line.getAttribute("y2")) };
  });
  // CSS serializes computed matrices at six significant digits; compare below one thousandth of a pixel.
  expect(aligned.x).toBeCloseTo(aligned.lineX, 3); expect(aligned.y).toBeCloseTo(aligned.lineY, 3);
  await page.clock.runFor(160);
  await expect(page.locator(".fg__layer")).toHaveCount(1);
  await expect(current(page).locator(".fg__sat")).toHaveCount(2);
  await expect(page.locator(".fg__static-center")).toHaveAttribute("data-identity", "same-centre");
  await expect(page.locator(".fg__static-center b")).toHaveText("root");
  await press(page.getByRole("button", { name: "Previous page", exact: true }));
  await page.clock.runFor(400);
  await expect(current(page).locator(".fg__sat")).toHaveCount(6);
});

test("family motion: overlapping selections and Back reuse at most three layers and old finishes cannot hide the current scene", async ({ page }) => {
  await setup(page); await walk(page, "one"); await walk(page, "two");
  await expect(page.locator(".fg__layer")).toHaveCount(3);
  await press(page.getByRole("button", { name: "Back", exact: true }));
  await expect(current(page).locator(".fg__label--center b")).toHaveText("one");
  await press(page.getByRole("button", { name: "Back", exact: true }));
  await expect(current(page).locator(".fg__label--center b")).toHaveText("root");
  await expect(page.locator(".fg__layer")).toHaveCount(3);
  await page.clock.runFor(800);
  await expect(page.locator(".fg__layer")).toHaveCount(1);
  await expect(page.locator(".fg__static-center b")).toHaveText("root");
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
});

test("family motion: Start again retraces each history entry350ms apart and blocks interaction until the final camera finishes", async ({ page }) => {
  await setup(page);
  for (const id of ["one", "two", "three"]) { await walk(page, id); await page.clock.runFor(700); }
  await press(page.getByRole("button", { name: "Start again from root", exact: true }));
  await expect(page.locator(".fg")).toHaveAttribute("inert", "");
  await page.clock.runFor(1); await expect(current(page).locator(".fg__label--center b")).toHaveText("two");
  await page.clock.runFor(350); await expect(current(page).locator(".fg__label--center b")).toHaveText("one");
  await page.clock.runFor(350); await expect(current(page).locator(".fg__label--center b")).toHaveText("root");
  await expect(page.locator(".fg")).toHaveAttribute("inert", "");
  expect(await page.locator(".fg__layer").count()).toBeLessThanOrEqual(3);
  await page.clock.runFor(700);
  await expect(page.locator(".fg")).not.toHaveAttribute("inert");
  await expect(page.locator(".fg__layer")).toHaveCount(1);
  await expect(page.locator(".fg__static-center b")).toHaveText("root");
  await expect(page.getByRole("button", { name: "Start again from root", exact: true })).toHaveCount(0);
});

test("family motion: reduced motion changes scenes immediately, while reset still retraces its scheduled history", async ({ page }) => {
  await setup(page); await page.emulateMedia({ reducedMotion: "reduce" });
  for (const id of ["one", "two"]) {
    await press(satellite(page, id).getByRole("button"));
    await expect(page.locator(".fg__static-center b")).toHaveText(id);
    await expect(page.locator(".fg__layer")).toHaveCount(1);
  }
  await press(page.getByRole("button", { name: "Start again from root", exact: true }));
  await page.clock.runFor(1); await expect(page.locator(".fg__static-center b")).toHaveText("one");
  await page.clock.runFor(350); await expect(page.locator(".fg__static-center b")).toHaveText("root");
  await expect(page.locator(".fg")).not.toHaveAttribute("inert");
  await expect(page.locator(".fg__layer")).toHaveCount(1);
});
