import { expect, test, type Page } from "@playwright/test";
import { bibleAt, bibleFrame, bibleReady } from "./telegram-harness";
const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const verses = Array.from({ length: 31 }, (_, i) => ({ verse: i + 1, text: i === 0 ? "In the beginning God created the heaven and the earth." : `Verse ${i + 1}: And God said, Let there be light: and there was light.` }));
async function setup(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [
      { book: "Genesis", slug: "genesis", chapters: 2, verses: 62, chapterIds: [1, 2] },
      { book: "John", slug: "john", chapters: 3, verses: 93, chapterIds: [1, 2, 3] },
      { book: "Wisdom of Solomon", slug: "wisdom-of-solomon", chapters: 1, verses: 31, chapterIds: [1] },
    ] });
    const chapter = /\/api\/kjv\/([^/]+)\/(\d+).json/.exec(path);
    if (chapter) return r.fulfill({ json: { book: chapter[1], chapter: +chapter[2], translation: "KJV", verses } });
    return r.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/verse-of-day*", r => r.fulfill({ json: { ref: new URL(r.request().url()).searchParams.has("date") ? "Genesis 1:2" : "Genesis 1:1", slug: "genesis", chapter: 1, verse: new URL(r.request().url()).searchParams.has("date") ? 2 : 1, text: "In the beginning God created the heaven and the earth." } }));
  // Init scripts run in every frame, and the Bible's frame (/app/strong) shares the app's
  // localStorage: seeding there too would undo what a test has since changed.
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress" }));
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "bible-one", tabs: [{ id: "bible-one", path: "/read/genesis/1" }, { id: "bible-two", path: "/read/john/3?v=16-18" }] }] }));
  });
}
test.beforeEach(async ({ page }) => setup(page));

test("daily verses have five days, sharing and images on Home", async ({ page, browserName }) => {
  await page.route(`${DATA}/search/{classes,captains}.json`, r => r.fulfill({ json: [] }));
  await page.route(`${DATA}/api/strongs/index.json`, r => r.fulfill({ json: [
    { n: "G1", lemma: "Α", xlit: "alpha", def: "Alpha", count: 100 },
    { n: "G2", lemma: "Ἀαρών", xlit: "Aaron", def: "Aaron", count: 10 },
  ] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const days = page.getByRole("region", { name: "Daily scripture" });
  const card = days.locator(".today-card[data-active]");
  await expect(card).toContainText("Genesis 1:1");
  await expect(card.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
  await days.press("ArrowRight");
  await expect(card).toContainText("Yesterday"); await expect(card).toContainText("Genesis 1:2");
  await card.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Verse image" }).getByRole("img")).toHaveAttribute("src", "/card/genesis/1/2.svg");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await days.press("ArrowLeft");
  await expect(card).toContainText("Genesis 1:1");

  // Home opens over the Bible, which stays where it is underneath.
  await page.goto("/read/genesis/1");
  await bibleReady(page);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const home = page.locator(".drawer--home");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const stack = home.getByRole("region", { name: "Daily scripture" });
  const active = stack.locator(".today-card[data-active]");
  const touch = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
  const swipe = async (right: boolean) => {
    const b = (await stack.boundingBox())!;
    const x = b.x + b.width * (right ? .2 : .8), end = b.x + b.width * (right ? .8 : .2), y = b.y + 110;
    if (touch) {
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let n = 1; n <= 12; n++) {
        await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (end - x) * n / 12, y }] });
        await page.waitForTimeout(25);
      }
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(end, y, { steps: 12 }); await page.mouse.up();
    }
  };
  await expect(stack.locator(".today-card[inert]")).toHaveCount(4);
  for (const day of ["Yesterday", "Two days ago", "Three days ago", "Four days ago", "Four days ago"]) {
    await swipe(true); await expect(active.locator("header b")).toHaveText(day);
    await expect(home).toHaveAttribute("data-open", "");
    await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  }
  for (const day of ["Three days ago", "Two days ago", "Yesterday", "Today", "Today"]) {
    await swipe(false); await expect(active.locator("header b")).toHaveText(day);
  }
  await touch?.detach();
  await stack.press("ArrowRight"); await expect(active.locator("header b")).toHaveText("Yesterday");
  await active.getByRole("button", { name: "Image", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Verse image" }).getByRole("img")).toHaveAttribute("src", "/card/genesis/1/2.svg");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const word = home.locator(".widget").first();
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G1");
  await page.evaluate(() => { Math.random = () => .99; });
  await word.getByRole("button", { name: "Another one" }).click();
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G2");
  const shelf = home.locator(".widgets");
  await expect(home.locator(".feed__card--skel")).toHaveCount(0);
  await shelf.evaluate(el => { el.scrollIntoView({ block: "center" }); el.scrollLeft = 200; });
  await expect.poll(() => shelf.evaluate(el => el.scrollLeft)).toBeGreaterThan(20);
  const position = await home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft]);
  await home.getByRole("button", { name: "Close Home" }).click();
  await expect(home).toHaveAttribute("inert", "");
  // Stay away beyond the closing animation, which used to discard Home's state.
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(active.locator("header b")).toHaveText("Yesterday");
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G2");
  await expect.poll(() => home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft])).toEqual(position);
});

test("keyboard palette switches to an existing tab and opens a passage with its range", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await bibleReady(page);
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Find a tab or tool" });
  await input.fill("John"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await expect(page.getByRole("button", { name: "2 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k"); await input.fill("Genesis 1:2-3"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2-3/);
  await expect(page.getByRole("button", { name: "3 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Alt+w"); await expect(page.getByRole("button", { name: "2 Tabs open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k"); await input.fill("study");
  await expect(page.getByRole("option", { name: /My studies/ })).toBeVisible();
  await input.press("Enter"); await expect(page).toHaveURL(/\/studies$/);
  await page.keyboard.press("Control+k");
  await input.fill("Bible"); await input.press("Tab");
  const dialog = page.getByRole("dialog", { name: "Find a tab or tool" });
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden(); await expect(page).toHaveURL(/\/studies$/);
});

test("plan completion can be corrected by keyboard and its read action stays inside the app", async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem("cj:plan", JSON.stringify({ startedAt: new Date().toISOString().slice(0, 10), day: 0, streak: 0, perDay: 1, books: ["john"], name: "John" }));
    localStorage.setItem("cj:read", JSON.stringify({ genesis: "1-2" }));
  });
  const base = (process.env.CYBERJUDAH_APP_BASE ?? "/").replace(/\/$/, "");
  await page.goto(`${base}/plan`);
  await expect(page.locator(".card__ref")).toContainText("0% of this plan");
  const check = page.getByRole("button", { name: "John 1 read", exact: true });
  await check.focus(); await page.keyboard.press("Space"); await expect(check).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space"); await expect(check).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Read John 1", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/read/john/1$`));
  await bibleReady(page);
  await expect(bibleAt(page, "John 1")).toBeVisible();
});

test("restarting a selected plan keeps its books and resets its streak date", async ({ page }) => {
  await page.addInitScript(() => { if (window === window.top) localStorage.setItem("cj:plan", JSON.stringify({ startedAt: "2026-10-01", day: 1, streak: 3, lastDone: "2026-10-07", perDay: 1, books: ["john"], name: "John" })); });
  await page.goto("/plan");
  page.once("dialog", d => d.accept());
  await page.getByRole("button", { name: "Start over", exact: true }).click();
  await expect(page.getByRole("link", { name: "John · Change plan", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "John 1", exact: true })).toBeVisible();
  // The restart is saved after the confirm resolves; wait for the saved plan, not only the screen.
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("cj:plan")!));
  await expect.poll(saved).toMatchObject({ day: 0, streak: 0, books: ["john"], name: "John" });
  expect((await saved()).lastDone).toBeUndefined();
});

test("the reading guide is reachable from Settings and has usable tab shortcuts", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Help & reading guide", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/help$/);
  await expect(page.getByRole("heading", { name: "Keyboard controls", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My studies", exact: true })).toHaveAttribute("href", "/studies");
});

test("Mac shortcuts cycle recent tabs and do not interrupt a study editor", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }));
  await page.goto("/read/genesis/1");
  await bibleReady(page);
  await page.keyboard.down("Control"); await page.keyboard.press("q");
  await expect(page.getByRole("dialog", { name: "Recent tabs", exact: true })).toBeVisible();
  await page.keyboard.up("Control");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await page.keyboard.press("Meta+Alt+n"); await expect(page).toHaveURL(/\/new$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("study"); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/studies$/);
  await page.getByRole("button", { name: "New study", exact: true }).click();
  const writing = page.getByRole("textbox", { name: "Writing 1", exact: true });
  await writing.fill("Keep my writing");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Find a tab or tool" })).toHaveCount(0);
  await expect(writing).toHaveValue("Keep my writing");
});

test("reader annotation mode suppresses native text selection and WebKit callouts", async ({ page, browserName }) => {
  await page.goto("/read/genesis/1");
  await bibleReady(page);
  const bible = bibleFrame(page);
  // As a reader enters it in Bible Strong: tap the verse, then Free mode under Annotate.
  await bible.locator('[data-verse-key="1-1-1"]').first().click();
  await bible.getByRole("tab", { name: "Annotate", exact: true }).click();
  await bible.getByRole("button", { name: "Free mode" }).click();
  const finish = bible.getByRole("button", { name: "Finish annotation mode", exact: true });
  await expect(finish).toBeVisible();
  // The span that styles verse 1 and holds its words (BibleDOM/ContainerText.tsx).
  const text = bible.locator('span:has(> [data-verse-key="1-1-1"])').first();
  await expect(text).toContainText("In the beginning God created the heaven and the earth.");
  await expect(text).toHaveCSS("user-select", "none");
  if (browserName === "webkit") await expect(text).toHaveCSS("-webkit-user-select", "none");
  // Desktop engines may omit the iOS-only property from computed styles: read the rule itself.
  const rules = await text.evaluate(el => {
    const css = Array.from(el.ownerDocument.querySelectorAll("style")).map(s => s.textContent ?? "").join("\n");
    return Array.from(el.classList).flatMap(c => css.match(new RegExp(`\\.${c}\\{[^}]*\\}`, "g")) ?? []);
  });
  expect(rules.join("\n")).toMatch(/user-select:none;[^}]*-webkit-touch-callout:none/);
  await finish.click();
  await expect(finish).toHaveCount(0);
});
