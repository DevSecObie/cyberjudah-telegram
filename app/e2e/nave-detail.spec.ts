import { expect, test, type Page } from "@playwright/test";

// Bible Strong's NaveDetailTabScreen, which a precept's and a topic's page follow: the name in the
// header with the ⋮ menu, the relations' chip, then the page; loading, failure and empty states.
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const PRECEPT = { slug: "sin", title: "Sin", url: "/precepts/sin", refs: [
  { label: "1 John 3:4", slug: "1-john", chapter: 3, verses: "4", url: "/bible/1-john/3#v4", key: true, text: [{ verse: 4, text: "Whosoever committeth sin transgresseth also the law: for sin is the transgression of the law." }] },
  { label: "Romans 6:23", slug: "romans", chapter: 6, verses: "23", url: "/bible/romans/6#v23", text: [{ verse: 23, text: "For the wages of sin is death." }] },
] };
const TOPIC = { slug: "captivity", label: "Captivity", url: "/topics/captivity", items: [
  { kind: "class", title: "The Fourth Beast", url: "/classes/2025/fourth-beast", date: "2025-05-01", teacher: "Bishop Nathanyel" },
  { kind: "case", title: "Judah taken to Babylon", url: "/cases/kings/babylon", charge: "Idolatry", verdict: "Guilty" },
], thread: [
  { book: "2 Kings", chapter: 24, verses: "14", label: "2 Kings 24:14", url: "/bible/2-kings/24#v14", text: "And he carried away all Jerusalem.", classes: [{ title: "The Fourth Beast", url: "/classes/2025/fourth-beast", date: "2025-05-01", teacher: "Bishop Nathanyel", ts: "12:04", t: 724 }], precepts: [{ label: "Deuteronomy 28:68", url: "/bible/deuteronomy/28#v68" }] },
] };

async function setup(page: Page, { failPrecept = false } = {}) {
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => { w.__copied.push(s); } } });
  });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/precepts/sin.json") return failPrecept ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ json: PRECEPT });
    if (path === "/api/topics/captivity.json") return r.fulfill({ json: TOPIC });
    return r.fulfill({ status: 404, body: "" });
  });
}
const menu = (page: Page) => page.getByRole("button", { name: "More options", exact: true });

test("the phone ellipsis stays anchored through opening, navigation and reopening", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    const w = window as unknown as { __menuMotion: { from: string; to: string; animation: string }[] };
    w.__menuMotion = [];
    if (!original) return;
    document.startViewTransition = (...args) => {
      const transition = original(...args);
      void transition.ready.then(() => {
        const style = getComputedStyle(document.documentElement, "::view-transition-group(action-popover)");
        w.__menuMotion.push({ from: getComputedStyle(document.documentElement).getPropertyValue("--popover-from"), to: getComputedStyle(document.documentElement).getPropertyValue("--popover-to"), animation: style.animationName });
      }).catch(() => {});
      return transition;
    };
  });
  await page.goto("/precepts/sin");
  const native = await page.evaluate(() => !!document.startViewTransition);
  const open = async () => {
    const trigger = (await menu(page).boundingBox())!;
    const count = await page.evaluate(() => (window as unknown as { __menuMotion: unknown[] }).__menuMotion.length);
    await menu(page).click();
    const popup = page.locator(".sheet[data-popover]");
    await expect(popup).toBeVisible();
    await expect(popup).toHaveAttribute("data-placed");
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(8);
    expect(bounds!.y).toBeGreaterThanOrEqual(8);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    if (!native) return;
    await expect.poll(() => page.evaluate(() => (window as unknown as { __menuMotion: unknown[] }).__menuMotion.length)).toBeGreaterThan(count);
    const motion = await page.evaluate(() => (window as unknown as { __menuMotion: { from: string; to: string; animation: string }[] }).__menuMotion.at(-1)!);
    expect(motion.animation).toContain("popover-morph");
    const origin = motion.from.match(/^translate\((\d+)px, (\d+)px\)/);
    expect(origin).not.toBeNull();
    expect(Number(origin![1])).toBeGreaterThanOrEqual(trigger.x);
    expect(Number(origin![1])).toBeLessThanOrEqual(trigger.x + trigger.width);
    expect(Number(origin![2])).toBeGreaterThanOrEqual(trigger.y);
    expect(Number(origin![2])).toBeLessThanOrEqual(trigger.y + trigger.height);
    expect(motion.to).toContain(`translate(${Math.round(bounds!.x)}px, ${Math.round(bounds!.y)}px)`);
  };
  await open();
  await page.getByRole("button", { name: "Edit relations", exact: true }).click();
  await expect(page).toHaveURL(/\/relations\?/);
  await expect(page.locator(".sheet[data-popover]")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".head h1")).toHaveText("Sin");
  await open();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet[data-popover]")).toHaveCount(0);
  await expect(menu(page)).toBeFocused();
});

test("a precept's page is Bible Strong's Nave page: its name, the ⋮ menu with Share the link, Copy the text, Edit relations and Open in new tab, then its scriptures", async ({ page }) => {
  await setup(page);
  await page.goto("/precepts/sin");
  await expect(page.locator(".head h1")).toHaveText("Sin");
  await expect(page.locator(".head .kicker")).toHaveText("Precept · 2 scriptures");
  await expect(page.locator(".lawrow")).toHaveCount(2);
  // The share is in the menu, not under the page.
  await expect(page.locator(".pageactions")).toHaveCount(0);
  // No relations yet: no chip.
  await expect(page.locator(".nave-detail__chips")).toHaveCount(0);

  await menu(page).click();
  const items = page.locator(".sheet__item");
  await expect(items).toHaveText(["Share the link", "Copy the text", "Edit relations", "Open in new tab"]);
  await page.getByRole("button", { name: "Copy the text", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "Copied to the clipboard." })).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual(["Sin\n\n1 John 3:4\nWhosoever committeth sin transgresseth also the law: for sin is the transgression of the law.\n\nRomans 6:23\nFor the wages of sin is death."]);

  await menu(page).click();
  await page.getByRole("button", { name: "Open in new tab", exact: true }).click();
  await expect(page.locator(".toast", { hasText: "New tab created" })).toBeVisible();
  const paths = await page.evaluate(() => JSON.parse(localStorage.getItem("cj:tabgroups")!).groups[0].tabs.map((t: { path: string }) => t.path));
  expect(paths).toContain("/precepts/sin");

  await menu(page).click();
  await page.getByRole("button", { name: "Edit relations", exact: true }).click();
  await expect(page).toHaveURL(/\/relations\?endpoint=entry%3A%2Fprecepts%2Fsin&label=Sin$/);
});

test("a topic with relations shows their count as a chip that opens them", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("cj:rel_other", JSON.stringify([{ id: "r1", type: "linked", direction: "none", endpoints: [{ type: "entry", url: "/topics/captivity", kind: "topic", label: "Captivity" }, { type: "dictionary", slug: "babylon", label: "Babylon" }], createdAt: 1, updatedAt: 1 }])));
  await page.goto("/topics/captivity");
  await expect(page.locator(".head h1")).toHaveText("Captivity");
  await expect(page.locator(".thread__ref b")).toHaveText(["2 Kings 24:14"]);
  await page.locator(".thread__head").click();
  await expect(page.locator(".thread__stop--open .thread__class")).toContainText("The Fourth Beast");
  await expect(page.locator(".section__head h2")).toHaveText(["The Thread", "Classes and Episodes", "Cases"]);
  const chip = page.locator(".nave-detail__chips .tagd-chip");
  await expect(chip).toHaveText("1");
  await chip.click();
  await expect(page).toHaveURL(/\/relations\?endpoint=entry%3A%2Ftopics%2Fcaptivity&label=Captivity$/);
});

test("a page that fails to load says so with Retry, and loads on Retry", async ({ page }) => {
  await setup(page, { failPrecept: true });
  await page.goto("/precepts/sin");
  await expect(page.getByText("This precept did not load")).toBeVisible();
  await page.unroute(`${DATA}/**`);
  await page.route(`${DATA}/**`, r => new URL(r.request().url()).pathname === "/api/precepts/sin.json" ? r.fulfill({ json: PRECEPT }) : r.fulfill({ status: 404, body: "" }));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".head h1")).toHaveText("Sin");
});
