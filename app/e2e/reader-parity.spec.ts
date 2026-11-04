import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import { preferChips } from "./telegram-harness";
const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  // Today's verse is Genesis 1:1, every earlier day's Genesis 1:2 (the app asks by the reader's own date).
  await page.route("**/api/verse-of-day*", r => { const past = (new URL(r.request().url()).searchParams.get("date") ?? today()) < today(); return r.fulfill({ json: { ref: past ? "Genesis 1:2" : "Genesis 1:1", slug: "genesis", chapter: 1, verse: past ? 2 : 1, text: "In the beginning God created the heaven and the earth." } }); });
  await page.addInitScript(() => {
    if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress" }));
    localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "one", groups: [{ id: "one", name: "My tabs", color: "#2dd4bf", current: "bible-one", tabs: [{ id: "bible-one", path: "/read/genesis/1" }, { id: "bible-two", path: "/read/john/3?v=16-18" }] }] }));
  });
}
async function menu(page: Page, action: string) {
  await page.getByRole("button", { name: "Scripture options", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function overview(page: Page) {
  await page.getByRole("button", { name: /^Tabs, \d+ open$/ }).click();
  await expect(page.getByRole("main", { name: "Your tabs" })).toBeVisible();
}
test.beforeEach(async ({ page }) => setup(page));

for (const theme of ["light", "dark"]) test(`same-passage notes keep independent identities, edits, exports and deletion (${theme})`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(theme => {
    if (sessionStorage.getItem("notes-seeded")) return;
    sessionStorage.setItem("notes-seeded", "1");
    localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress", preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }));
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1": { id: "legacy", title: "Legacy note", description: "Keep legacy words", date: 1, tags: { faith: true } } }));
    localStorage.setItem("cj:bs_tags", JSON.stringify({ faith: { id: "faith", name: "Faith", date: 1 } }));
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([{ id: "legacy-relation", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-1"], label: "Genesis 1:1" }, { type: "note", verseKey: "genesis-1-1", label: "Legacy note" }], createdAt: 1, updatedAt: 1 }]));
  }, theme);
  const records = () => page.evaluate(() => JSON.parse(localStorage.getItem("cj:bs_n_genesis_1") ?? "{}"));
  const note = page.getByRole("dialog", { name: "Note", exact: true });
  await preferChips(page);
  await page.goto("/read/genesis/1");
  for (const title of ["First note", "Second note"]) {
    await page.locator("#verset-1 .bs-text").click();
    const selection = page.getByRole("dialog", { name: /^Selected:/ });
    await selection.getByRole("tab", { name: "Annotate", exact: true }).click();
    await selection.getByRole("button", { name: "Note", exact: true }).click();
    await note.getByRole("textbox", { name: "Title", exact: true }).fill(title);
    await note.getByRole("textbox", { name: "Description", exact: true }).fill(`${title} words`);
    await note.getByRole("button", { name: "Save", exact: true }).click();
    await expect(note).toBeHidden();
    await expect(page.locator("#verset-1 .rel-tag", { hasText: title })).toBeVisible();
  }
  await expect.poll(async () => Object.keys(await records()).length).toBe(3);
  const saved = await records();
  expect(saved["1"]).toEqual({ id: "legacy", title: "Legacy note", description: "Keep legacy words", date: 1, tags: { faith: true } });
  const firstId = Object.keys(saved).find(k => saved[k].title === "First note")!;
  const secondId = Object.keys(saved).find(k => saved[k].title === "Second note")!;
  expect(firstId).not.toBe(secondId);
  for (const id of [firstId, secondId]) expect(saved[id]).toMatchObject({ id, verses: [1] });
  await page.reload();
  await expect(page.locator("#verset-1 .rel-tag")).toHaveCount(3);
  for (const [title, words] of [["Second note", "Edited second words"], ["Legacy note", "Edited legacy words"]]) {
    await page.locator("#verset-1 .rel-tag", { hasText: title }).click();
    await expect(note).toContainText(title);
    await note.getByRole("button", { name: "Open", exact: true }).click();
    await expect(note.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
    await expect(note.locator(".bs-sheet__titles small")).toHaveText("Genesis 1:1");
    await note.getByRole("textbox", { name: "Description", exact: true }).fill(words);
    await note.getByRole("button", { name: "Save", exact: true }).click();
    await expect(note).toBeHidden();
  }
  expect((await records())[firstId]).toEqual(saved[firstId]);
  expect((await records())[secondId].description).toBe("Edited second words");
  expect((await records())["1"].tags).toEqual({ faith: true });
  await page.locator("#verset-1 .bs-text").click();
  const selection = page.getByRole("dialog", { name: /^Selected:/ });
  await selection.getByRole("tab", { name: "Share", exact: true }).click();
  await selection.getByRole("button", { name: "Export", exact: true }).click();
  const exported = page.getByRole("dialog", { name: "Export passage", exact: true });
  for (const words of ["First note words", "Edited second words", "Edited legacy words"]) await expect(exported.locator("pre")).toContainText(words);
  const download = page.waitForEvent("download");
  await exported.getByRole("button", { name: "Save text file", exact: true }).click();
  const text = await fs.readFile((await (await download).path())!, "utf8");
  for (const words of ["First note words", "Edited second words", "Edited legacy words"]) expect(text).toContain(words);
  await page.goto("/notes");
  await expect(page.locator(".noteitem")).toHaveCount(3);
  for (const row of await page.locator(".noteitem").all()) {
    await expect(row.locator(".noteitem__meta")).toContainText("Genesis 1:1");
    await expect(row.locator(".noteitem__link")).toHaveAttribute("href", /\/read\/genesis\/1\?v=1$/);
    await expect(row.getByRole("button", { name: "1", exact: true })).toBeVisible();
  }
  page.once("dialog", d => void d.accept());
  await page.locator(".noteitem", { hasText: "First note words" }).getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator(".noteitem")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".noteitem")).toHaveCount(2);
  expect(Object.keys(await records()).sort()).toEqual(["1", secondId].sort());
  const relations = await page.evaluate(() => JSON.parse(localStorage.getItem("cj:rel_genesis_1") ?? "[]"));
  expect(relations).toHaveLength(2);
  expect(relations.some((r: { endpoints: { noteId?: string }[] }) => r.endpoints.some(e => e.noteId === firstId))).toBe(false);
  await page.goto("/settings");
  const backupDownload = page.waitForEvent("download");
  await page.getByText("Download a backup", { exact: true }).click();
  const backup = JSON.parse(await fs.readFile((await (await backupDownload).path())!, "utf8"));
  expect(JSON.parse(backup.keys.bs_n_genesis_1)).toEqual(await records());
});

for (const theme of ["light", "dark"]) test(`note editor headings use saved passages for ID-keyed and legacy range notes (${theme})`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(theme => {
    localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress", preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }));
    const id = "724a8fa2-e4d1-4cb6-9621-7a25c4618438";
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({
      "1/2/4": { id: "legacy", title: "Legacy range note", description: "Legacy words", date: 1 },
      [id]: { id, verses: [1, 2, 4], title: "Independent range note", description: "Independent words", date: 2 },
    }));
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([undefined, id].map(noteId => ({
      id: noteId ?? "legacy-relation", type: "linked", direction: "none",
      endpoints: [{ type: "verse", verseKeys: ["genesis-1-1"], label: "Genesis 1:1" }, { type: "note", verseKey: "genesis-1-1", ...(noteId ? { noteId } : {}), label: noteId ? "Independent range note" : "Legacy range note" }],
      createdAt: 1, updatedAt: 1,
    }))));
  }, theme);
  await preferChips(page);
  await page.goto("/read/genesis/1");
  const note = page.getByRole("dialog", { name: "Note", exact: true });
  for (const title of ["Independent range note", "Legacy range note"]) {
    await page.locator("#verset-1 .rel-tag", { hasText: title }).click();
    await note.getByRole("button", { name: "Open", exact: true }).click();
    await expect(note.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
    await expect(note.locator(".bs-sheet__titles small")).toHaveText("Genesis 1:1-2,4");
    await note.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(note).toBeHidden();
  }
});

test("the relation picker and note relation pages distinguish notes on the same passage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({
    "1": { id: "legacy", title: "Legacy note", description: "Old words", date: 1 },
    first: { id: "first", verses: [1], title: "First note", description: "First words", date: 2 },
    second: { id: "second", verses: [1], title: "Second note", description: "Second words", date: 3 },
  })));
  await page.goto("/relations?endpoint=genesis-1-3");
  for (const title of ["Legacy note", "First note", "Second note"]) {
    await page.getByRole("button", { name: "Add a precept", exact: true }).click();
    for (const candidate of ["Legacy note", "First note", "Second note"]) await expect(page.locator(".rel-result", { hasText: candidate })).toBeVisible();
    await page.locator(".rel-result", { hasText: title }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect(page.locator(".rel-row")).toHaveCount(3);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("cj:rel_genesis_1") ?? "[]"));
  expect(saved.map((r: { endpoints: { noteId?: string; type: string }[] }) => r.endpoints.find(e => e.type === "note")?.noteId ?? "legacy").sort()).toEqual(["first", "legacy", "second"]);
  await page.goto("/notes");
  await page.locator(".noteitem", { hasText: "First words" }).getByRole("button", { name: "1", exact: true }).click();
  await expect(page).toHaveURL(/endpoint=note%3Agenesis-1-1%3Afirst$/);
  await expect(page.locator(".rel-row")).toHaveCount(1);
  await page.goto("/notes");
  await page.locator(".noteitem", { hasText: "Old words" }).getByRole("button", { name: "1", exact: true }).click();
  await expect(page).toHaveURL(/endpoint=note%3Agenesis-1-1$/);
  await expect(page.locator(".rel-row")).toHaveCount(1);
});

for (const theme of ["light", "dark"]) test(`reader book and version use separate half-capsules (${theme})`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(theme => localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" })), theme);
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  const group = page.getByRole("group", { name: "Passage", exact: true });
  await expect(group).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(group).toHaveCSS("gap", "3px");
  await expect(group).toHaveCSS("padding-left", "10px");
  for (const [kind, radius, padding] of [["book", "20px 0px 0px 20px", "0px 7px 0px 12px"], ["version", "0px 20px 20px 0px", "0px 12px 0px 7px"]]) {
    const pill = group.locator(`.bs-pill--${kind}`);
    // The capsule is 32 px, as in Bible Strong; the button keeps a 44 px tap area around it.
    expect(await pill.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await expect(pill).toHaveCSS("padding", padding);
    await expect(pill.locator("b")).toHaveCSS("font-size", "14px");
    await expect(pill.locator("b")).toHaveCSS("font-weight", "700");
    const bg = pill.locator(".bs-pill__bg");
    await expect(bg).toBeVisible();
    await expect(bg).toHaveCSS("border-radius", radius);
    await expect(bg).toHaveCSS("height", "32px");
    expect(await bg.evaluate(el => {
      const expected = document.createElement("span");
      expected.style.backgroundColor = "var(--bs-light-grey)";
      el.append(expected);
      const matches = getComputedStyle(el).backgroundColor === getComputedStyle(expected).backgroundColor;
      expected.remove();
      return matches;
    })).toBe(true);
  }
});

async function gestureClock(page: Page) {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-2 .bs-num")).toBeVisible();
  await page.clock.install({ time: new Date("2026-10-08T18:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-08T18:00:01Z"));
}
async function touchVerse(page: Page, type: string, fingers: number, verse = 1, offsetY = 0) {
  await page.locator(`#verset-${verse} .bs-num`).evaluate((el, { type, fingers, offsetY }) => {
    const r = el.getBoundingClientRect();
    const point = { identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 + offsetY };
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      touches: { value: Array.from({ length: fingers }, (_, i) => ({ ...point, identifier: i + 1, clientX: point.clientX + i * 20 })) },
      changedTouches: { value: [point] },
    });
    el.dispatchEvent(event);
  }, { type, fingers, offsetY });
}

for (const input of ["mouse", "touch"] as const) test(`reader rapid ${input} taps retain each distinct verse selection`, async ({ page }) => {
  await gestureClock(page);
  for (const n of [1, 2]) {
    if (input === "touch") {
      await touchVerse(page, "touchstart", 1, n);
      await touchVerse(page, "touchend", 0, n);
    } else {
      const b = (await page.locator(`#verset-${n} .bs-num`).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
    await page.clock.runFor(50);
  }
  await page.clock.runFor(250);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(2);
  await expect(page.getByRole("dialog", { name: "Selected: Genesis 1:1-2", exact: true })).toBeVisible();
});

test("reader cancelled touch cannot select a verse on a later release", async ({ page }) => {
  await gestureClock(page);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(100);
  await touchVerse(page, "touchcancel", 0);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(600);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
});

test("reader adding a second finger cancels the pending long press", async ({ page }) => {
  await gestureClock(page);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(100);
  await touchVerse(page, "touchstart", 2);
  await page.clock.runFor(500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await touchVerse(page, "touchend", 1);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(500);
  await touchVerse(page, "touchend", 0);
  await page.clock.runFor(250);
  await expect(page.locator(".bs-resfooter")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Lexicon", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
});

test("reader focus loss cancels a held press and the next click still works", async ({ page }) => {
  await gestureClock(page);
  const b = (await page.locator("#verset-1 .bs-num").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.clock.runFor(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(500);
  await page.mouse.up();
  await page.clock.runFor(250);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.clock.runFor(250);
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
});

test("reader pressing a verse shows no touch light, as in Bible Strong", async ({ page }) => {
  await gestureClock(page);
  const lit = () => page.locator("#verset-1 .bs-text").evaluate(el => getComputedStyle(el.parentElement!).backgroundColor);
  const before = await lit();
  await touchVerse(page, "touchstart", 1);
  await page.clock.runFor(200);
  expect(await lit()).toBe(before);
  await touchVerse(page, "touchend", 1);
});

test("reader chapter changes stay in place: Back leaves the reader and a collapsed header holds", async ({ page }) => {
  // Long chapters, so the reader can scroll far enough to collapse its header.
  const long = Array.from({ length: 40 }, (_, i) => ({ verse: i + 1, text: "And the light shineth in darkness; and the darkness comprehended it not. ".repeat(3) }));
  await page.route(`${DATA}/api/kjv/john/*.json`, r => r.fulfill({ json: { book: "john", chapter: +/(\d+)\.json/.exec(r.request().url())![1], translation: "KJV", verses: long } }));
  await page.goto("/more");
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  // A jump from the book picker changes the chapter in place too, as Bible Strong's picker does.
  await page.locator(".bs-pill--book").click();
  await page.locator(".bs-picker-sheet").getByRole("button", { name: "John", exact: true }).click();
  await page.getByRole("button", { name: "Chapter 1", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/john\/1$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.click('.bs-chapterbtn[aria-label="Next chapter"]');
  await expect(page).toHaveURL(/\/read\/john\/2$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  // Scrolling fast collapses the header, as Bible Strong's SWIPE_DOWN does (after the reader's
  // 600 ms settle following a chapter change).
  await page.waitForTimeout(800);
  await page.locator(".bs-scroll").evaluate(async el => { for (const top of [40, 120, 600]) { el.scrollTop = top; await new Promise(r => setTimeout(r, 30)); } });
  await expect(page.locator(".bs-header__summary")).toBeVisible();
  // A swipe to the next chapter keeps it collapsed: one fullscreen state, as upstream's atom.
  const y = 400;
  await page.mouse.move(340, y);
  await page.mouse.down();
  await page.mouse.move(60, y, { steps: 4 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/read\/john\/3$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeAttached();
  await expect(page.locator(".bs-header__summary")).toBeVisible();
  // Picking and paging chapters left no trail: Back leaves the reader.
  await page.goBack();
  await expect(page).toHaveURL(/\/more$/);
});

test("book picker long press opens the chapter in a new tab, as Bible Strong's web picker does", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tabs, 2 open", exact: true })).toBeVisible();
  await page.locator(".bs-pill--book").click();
  await page.locator(".bs-picker-sheet").getByRole("button", { name: "John", exact: true }).click();
  const tile = page.getByRole("button", { name: "Chapter 2", exact: true });
  const t = (await tile.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  await expect(page).toHaveURL(/\/read\/john\/2$/);
  await expect(page.getByRole("button", { name: "Tabs, 3 open", exact: true })).toBeVisible();
  await expect(page.locator(".bs-picker-sheet")).toHaveCount(0);
});

test("Go to verse never collapses the header, even when the jump's scroll lands after its settle time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    // The jump's 400 ms settle runs out before the browser hands over the jump's scroll event, as
    // WebKit's can: here the settle ends as soon as it starts.
    const later = window.setTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms === 400 && typeof fn === "function") { queueMicrotask(() => fn()); return 0; }
      return later(fn, ms, ...rest);
    }) as typeof window.setTimeout;
    // A collapse the clamp at the chapter's end undoes a frame later still counts.
    new MutationObserver(() => { if (document.querySelector(".bs-header__summary")) document.documentElement.dataset.collapsed = ""; }).observe(document.body, { childList: true, subtree: true });
  });
  await page.keyboard.press("v");
  const dialog = page.getByRole("dialog", { name: "Go to verse" });
  await dialog.getByRole("textbox", { name: "Verse" }).fill("28");
  await dialog.getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#verset-28")).toBeInViewport();
  await page.waitForTimeout(300);
  await expect(page.locator("html")).not.toHaveAttribute("data-collapsed");
  await expect(page.locator(".bs-pill--book")).toBeVisible();
});

test("reader v opens Go to verse and jumps to a valid verse, as Bible Strong's web reader does", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.keyboard.press("v");
  const dialog = page.getByRole("dialog", { name: "Go to verse" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Verse" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Verse" }).fill("99");
  await expect(dialog.getByRole("button", { name: "Go" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Verse" }).fill("28");
  await dialog.getByRole("button", { name: "Go" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#verset-28")).toBeInViewport();
  // Typing in a field never opens it.
  await page.locator(".bs-pill--book").click();
  await page.getByRole("textbox", { name: "Search books" }).press("v");
  await expect(page.getByRole("dialog", { name: "Go to verse" })).toHaveCount(0);
});

test("reader keeps the current chapter on screen until the next one arrives, as Bible Strong's keepPreviousData", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  await page.route(`${DATA}/api/kjv/john/*.json`, async r => {
    const n = +/(\d+)\.json/.exec(r.request().url())![1];
    if (n === 2) await held;
    await r.fulfill({ json: { book: "john", chapter: n, translation: "KJV", verses: [{ verse: 1, text: `John chapter ${n} first verse.` }, { verse: 2, text: `John chapter ${n} second verse.` }] } });
  });
  await page.goto("/read/john/1");
  await expect(page.locator("#verset-1 .bs-text")).toHaveText("John chapter 1 first verse.");
  await page.click('.bs-chapterbtn[aria-label="Next chapter"]');
  await expect(page).toHaveURL(/\/read\/john\/2$/);
  // While John 2 loads, John 1 stays up and the arrows wait.
  await expect(page.locator(".bs-chapterbtn[aria-label='Next chapter']")).toBeDisabled();
  await expect(page.locator("#verset-1 .bs-text")).toHaveText("John chapter 1 first verse.");
  release();
  await expect(page.locator("#verset-1 .bs-text")).toHaveText("John chapter 2 first verse.");
  await expect(page.locator(".bs-chapterbtn[aria-label='Next chapter']")).toBeEnabled();
});

test("reader press preference still swaps resources and verse selection", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await menu(page, "Font and settings");
  await page.getByRole("button", { name: "Showing strongs: Long press", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator("#verset-1 .bs-num").click();
  await expect(page.locator(".bs-resfooter")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Lexicon", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const b = (await page.locator("#verset-1 .bs-num").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true })).toBeVisible();
  await expect(page.locator(".bs-resfooter")).toHaveCount(0);
});

test("reader selections and expanded passage context belong to their own tabs", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await page.locator("#verset-1 .bs-text").click();
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("John"); await page.keyboard.press("Enter");
  await expect(page.locator(".bs-verse")).toHaveCount(3);
  await expect(page.locator("#verset-15")).toHaveCount(0);
  await page.locator(".bs-context__main").click();
  await expect(page.locator(".bs-verse")).toHaveCount(31);
  await overview(page); await page.getByRole("button", { name: "Open Genesis 1 - KJV", exact: true }).click();
  await expect(page.locator("#verset-1")).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("John"); await page.keyboard.press("Enter");
  await expect(page.locator(".bs-context__main")).toHaveText("Back to the Scripture");
  await expect(page.locator("#verset-1")).not.toHaveAttribute("data-selected");
});

test("a new Bible tab carries its focused passage, and the reader stays in their tab until Go to tab", async ({ page }) => {
  await page.goto("/read/genesis/1?v=1-2");
  await menu(page, "Open in new tab");
  const current = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cj:tabgroups")!); return s.groups[0].current; });
  await expect(page.getByRole("button", { name: "Tabs, 3 open", exact: true })).toBeVisible();
  expect(await current()).toBe("bible-one");
  await page.locator(".toast", { hasText: "New tab created" }).getByRole("button", { name: "Go to tab" }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1-2/);
  await expect.poll(current).not.toBe("bible-one");
  await expect(page.locator(".bs-verse")).toHaveCount(2);
});

test("export saves the chosen scope and notes, and supports a whole book", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1/2": { id: "n", title: "Creation", description: "My saved note", date: 1 }, "7": { id: "other", title: "Unrelated note", description: "Do not include", date: 1 } })));
  await page.goto("/read/genesis/1"); await page.locator("#verset-1 .bs-text").click();
  const selected = page.getByRole("dialog", { name: /^Selected:/ });
  await selected.getByRole("tab", { name: "Share", exact: true }).click();
  await selected.getByRole("button", { name: "Export", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Export passage" });
  await expect(sheet.locator("pre")).toContainText("My saved note");
  const download = page.waitForEvent("download"); await sheet.getByRole("button", { name: "Save text file" }).click();
  const text = await fs.readFile((await (await download).path())!, "utf8");
  expect(text).toContain("1. In the beginning"); expect(text).toContain("My saved note"); expect(text).toContain("outside this selection"); expect(text).not.toContain("Unrelated note");
  await sheet.getByRole("switch", { name: "Notes", exact: true }).click();
  await expect(sheet.locator("pre")).not.toContainText("My saved note");
  await sheet.getByLabel("Export scope").selectOption("book");
  await expect(sheet.locator("pre")).toContainText("Genesis 1");
  const whole = page.waitForEvent("download"); await sheet.getByRole("button", { name: "Save text file" }).click();
  expect(await fs.readFile((await (await whole).path())!, "utf8")).toContain("Genesis 2 · Scripture");
});

test("the book picker changes the chapter in place, so Back from it does not step back a chapter", async ({ page }) => {
  await page.goto("/more");
  await page.goto("/read/genesis/1");
  await page.locator(".bs-pill--book").click();
  await page.locator(".bs-picker-sheet").getByRole("button", { name: "John", exact: true }).click();
  await page.getByRole("button", { name: "Chapter 3", exact: true }).click();
  await expect(page).toHaveURL(/\/read\/john\/3/);
  await page.goBack();
  await expect(page).toHaveURL(/\/more$/);
});

test("search applies filters on the server, sorts, and preserves a typed verse range", async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await page.route("**/bs/v1/bibles/KJV/search?*", r => {
    const q = new URL(r.request().url()).searchParams; queries.push(q);
    const offset = Number(q.get("offset")), limit = Number(q.get("limit")), book = Number(q.get("book") || (q.get("section") === "apoc" ? 72 : 1));
    return r.fulfill({ json: { count: 52, results: Array.from({ length: Math.min(limit, 52 - offset) }, (_, i) => ({ book, chapter: Math.floor((i + offset) / 31) + 1, verse: (i + offset) % 31 + 1, text: `God created ${offset + i}` })) } });
  });
  await page.goto("/read/genesis/1"); await menu(page, "Search the Scriptures");
  const sheet = page.getByRole("dialog", { name: "Search the Scriptures", exact: true });
  await sheet.getByRole("searchbox").fill("God created");
  // Paging is Bible Strong's scroll-to-load, covered in reader-search.spec.ts.
  await expect(sheet.locator(".bs-search__hit").first()).toBeVisible();
  await sheet.getByLabel("One book").selectOption("john");
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("John");
  expect(queries.some((q) => q.get("book") === "43" && q.get("offset") === "0")).toBe(true);
  await sheet.getByRole("button", { name: "Apocrypha", exact: true }).click();
  await expect(sheet.locator(".bs-search__hit").first()).toContainText("Wisdom of Solomon");
  expect(queries.some((q) => q.get("section") === "apoc")).toBe(true);
  await sheet.getByLabel("Result order").selectOption("book");
  await expect.poll(() => queries.some((q) => q.get("sortOrder") === "book")).toBe(true);
  await sheet.getByRole("searchbox").fill("John 3:16-18");
  await sheet.getByRole("button", { name: /Go to John 3:16-18/ }).click();
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await expect(page.locator(".bs-verse")).toHaveCount(3);
});

test("reader verse numbers can be hidden without hiding them from assistive technology", async ({ page }) => {
  await page.goto("/read/genesis/1"); await menu(page, "Font and settings");
  await page.getByRole("switch", { name: "Verse numbers", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#verset-1 .bs-num")).toHaveCount(0);
  await expect(page.locator("#verset-1 .sr-only")).toHaveText("1");
  await page.reload(); await expect(page.locator("#verset-1")).toBeVisible();
  await expect(page.locator("#verset-1 .bs-num")).toHaveCount(0);
});

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

  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
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
  // The shelf can rest between cards instead of snapping to the next entry.
  await expect.poll(() => shelf.evaluate(el => el.scrollLeft)).toBeCloseTo(200, 0);
  const position = await home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft]);
  await home.getByRole("button", { name: "Close Home" }).click();
  await expect(home).toHaveAttribute("inert", "");
  // Stay away beyond the closing animation, which used to discard Home's state.
  await page.waitForTimeout(500);
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchmove", 1, 1, 160);
  await expect(home.locator(".pull")).toHaveCSS("height", "0px");
  await touchVerse(page, "touchend", 0, 1, 160);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(active.locator("header b")).toHaveText("Yesterday");
  await expect(word.locator(".widget__body")).toHaveAttribute("href", "/lexicon/G2");
  await expect.poll(() => home.evaluate(el => [el.querySelector(".drawer__scroll")!.scrollTop, el.querySelector(".widgets")!.scrollLeft])).toEqual(position);
  // A chapter first saved while Home is closed must join its displayed totals on reopening.
  const highlights = home.locator(".stats__cell").filter({ hasText: "Highlight" }).locator("b");
  await expect(highlights).toHaveText("0");
  await home.getByRole("button", { name: "Close Home" }).click();
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchend", 0);
  await page.locator(".bs-colors__cell").nth(1).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(highlights).toHaveText("1");
  // Entry, resource footer and shuffle remain independent controls in the shorter card.
  await word.locator(".widget__foot").click();
  await expect(page).toHaveURL(/\/lexicon\?lang=greek$/);
  await expect(home).toHaveAttribute("inert", "");
  // Back from a page opened from Home opens Home again, as Bible Strong's drawer stays open under the page.
  await page.goBack();
  await expect(home).toHaveAttribute("data-open", "");
  await word.locator(".widget__body").click();
  await expect(page).toHaveURL(/\/lexicon\/G2$/);
  await expect(home).toHaveAttribute("inert", "");
});

test("keyboard palette switches to an existing tab and opens a passage with its range", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "Find a tab or tool" });
  await input.fill("John"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await expect(page.getByRole("button", { name: "Tabs, 2 open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k"); await input.fill("Genesis 1:2-3"); await input.press("Enter");
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=2-3/);
  await expect(page.getByRole("button", { name: "Tabs, 3 open", exact: true })).toBeVisible();
  await page.keyboard.press("Control+Alt+w"); await expect(page.getByRole("button", { name: "Tabs, 2 open", exact: true })).toBeVisible();
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
    localStorage.setItem("cj:plan", JSON.stringify({ startedAt: new Date().toISOString().slice(0, 10), day: 0, streak: 0, perDay: 1, books: ["john"], name: "John" }));
    localStorage.setItem("cj:read", JSON.stringify({ genesis: "1-2" }));
  });
  const base = (process.env.CYBERJUDAH_APP_BASE ?? "/").replace(/\/$/, "");
  await page.goto(`${base}/plan`);
  const check = page.getByRole("checkbox", { name: "John 1", exact: true });
  await check.focus(); await page.keyboard.press("Space");
  // Finishing the day's reading is celebrated, as in Bible Strong; its sheet hides the page until Continue.
  await page.getByRole("dialog", { name: "Congratulations" }).getByRole("button", { name: "Continue", exact: true }).click();
  await expect(check).toHaveAttribute("aria-checked", "true");
  await check.focus(); await page.keyboard.press("Space"); await expect(check).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Continue my journey", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}/read/john/1$`));
  await expect(page.locator("#verset-1")).toBeVisible();
});

test("resetting a selected plan starts it again on day one and unmarks only its own chapters", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1");
    localStorage.setItem("cj:plan", JSON.stringify({ startedAt: "2026-10-01", day: 1, streak: 3, lastDone: "2026-10-07", perDay: 1, books: ["john"], name: "John", seenCompleted: 1 }));
    localStorage.setItem("cj:read", JSON.stringify({ john: "1", genesis: "1-2" }));
  });
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Day 2 of 3" })).toBeVisible();
  // Bible Strong's Reset, from the plan menu, after its warning.
  await page.getByRole("button", { name: "Plan options", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Day 1 of 3" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "John 1", exact: true })).toHaveAttribute("aria-checked", "false");
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cj:plan")!))).toMatchObject({ startedAt: today, day: 0, streak: 0, books: ["john"], name: "John" });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cj:plan")!).lastDone)).toBeUndefined();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cj:read")!))).toEqual({ genesis: "1-2" });
});

test("the reading guide is reachable from Settings and has usable tab shortcuts", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Help & reading guide", { exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/help$/);
  await expect(page.getByRole("heading", { name: "Keyboard controls", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My studies", exact: true })).toHaveAttribute("href", "/studies");
});

test("Mac shortcuts cycle recent tabs and do not interrupt a note editor", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }));
  await page.goto("/read/genesis/1");
  await page.keyboard.down("Control"); await page.keyboard.press("q");
  await expect(page.getByRole("dialog", { name: "Recent tabs", exact: true })).toBeVisible();
  await page.keyboard.up("Control");
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16-18/);
  await page.keyboard.press("Meta+Alt+n"); await expect(page).toHaveURL(/\/new$/);
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Find a tab or tool" }).fill("Genesis"); await page.keyboard.press("Enter");
  await page.locator("#verset-1 .bs-text").click();
  const selected = page.getByRole("dialog", { name: /^Selected:/ });
  await selected.getByRole("tab", { name: "Annotate", exact: true }).click();
  await selected.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Keep my writing");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog", { name: "Find a tab or tool" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep my writing");
});

test("notes list searches and sorts as Bible Strong's BibleVerseNotesScreen, and filters by tag", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cj:bs_tags", JSON.stringify({ t1: { id: "t1", name: "Light", date: 1 } }));
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({
      "3": { id: "n1", title: "Light was the first", description: "The fair light out of God's treasures.", date: 3000, tags: { t1: true } },
      "1": { id: "n2", title: "Beginning", description: "In the beginning, Christ.", date: 1000 },
    }));
    localStorage.setItem("cj:bs_n_john_1", JSON.stringify({ "4": { id: "n3", title: "Ark of the word", description: "The life was the light of men.", date: 2000 } }));
  });
  await page.goto("/notes");
  // The list as drawn: an open panel's dimmed page is hidden from the accessibility tree, as a modal dialog's is.
  const order = () => page.locator("a").filter({ hasText: /Light was the first|Beginning|Ark of the word/ }).allInnerTexts().then(t => t.map(s => /Light was the first|Beginning|Ark of the word/.exec(s)![0]));
  await expect.poll(order).toEqual(["Light was the first", "Ark of the word", "Beginning"]);
  // Bible Strong's filter panel: Order, Search, Tags.
  const choose = async (row: string, choice: string) => {
    await page.locator(".head .bs-filter").click();
    await page.locator(".panel-filter", { hasText: row }).click();
    await page.getByRole("radio", { name: choice, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await choose("Order", "Title A–Z");
  await expect.poll(order).toEqual(["Ark of the word", "Beginning", "Light was the first"]);
  await choose("Order", "Oldest");
  await expect.poll(order).toEqual(["Beginning", "Ark of the word", "Light was the first"]);
  // Fuzzy search over titles and text, as upstream's searchWithMatches.
  await page.locator(".head .bs-filter").click();
  await page.locator(".panel-filter", { hasText: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("beginning");
  await expect.poll(order).toEqual(["Beginning"]);
  await page.getByRole("searchbox", { name: "Search" }).fill("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await choose("Tags", "Light");
  await expect.poll(order).toEqual(["Light was the first"]);
});

test("history keeps the verse gone to and opens on it, as Bible Strong's history does", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.keyboard.press("v");
  await page.getByRole("dialog", { name: "Go to verse" }).getByRole("textbox", { name: "Verse" }).fill("28");
  await page.getByRole("dialog", { name: "Go to verse" }).getByRole("button", { name: "Go" }).click();
  await expect(page.locator("#verset-28")).toBeInViewport();
  await page.goto("/history");
  // One row per passage: the chapter itself and verse 28 of it.
  const row = (title: string) => page.locator(".histitem", { has: page.locator(".histitem__title", { hasText: new RegExp(`^${title}$`) }) });
  await expect(row("Genesis 1:28 KJV")).toBeVisible();
  await expect(row("Genesis 1 KJV")).toBeVisible();
  await row("Genesis 1:28 KJV").click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?at=28$/);
  await expect(page.locator("#verset-28")).toBeVisible();
});

test("a cyberjudah.io chapter link's #v anchor opens the whole chapter at that verse", async ({ page }) => {
  await page.goto("/read/genesis/1#v28");
  await expect(page.locator("#verset-28")).toBeInViewport();
  await expect(page.locator("#verset-1 .bs-num")).toBeAttached();
  // A focused passage keeps its own verse; the anchor does not pull it elsewhere.
  await page.goto("/read/genesis/1?v=3#v28");
  await expect(page.locator(".bs-context__main")).toHaveText("Read whole chapter");
  await expect(page.locator("#verset-3")).toBeInViewport();
});

test("reader annotation mode suppresses native text selection and WebKit callouts", async ({ page, browserName }) => {
  await page.goto("/read/genesis/1");
  await page.locator("#verset-1 .bs-num").click();
  const sheet = page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true });
  await sheet.getByRole("tab", { name: "Annotate", exact: true }).click();
  await sheet.getByRole("button", { name: "Free mode", exact: true }).click();
  await expect(page.locator(".bs-container")).toHaveAttribute("data-annotating", "");
  const text = page.locator("#verset-1 .bs-text");
  await expect(text).toHaveCSS("user-select", "none");
  if (browserName === "webkit") {
    await expect(text).toHaveCSS("-webkit-user-select", "none");
    // Desktop WebKit may omit the iOS-only property from computed styles.
    const hrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(links => links.map(link => (link as HTMLLinkElement).href));
    const css = (await Promise.all(hrefs.map(async href => (await page.request.get(href)).text()))).join("\n");
    expect(css).toMatch(/\.bs-container\[data-annotating\][^{]*\.bs-text[^{]*\{[^}]*-webkit-touch-callout:none/);
  }
  await page.getByRole("button", { name: "Exit annotation mode", exact: true }).click();
  await expect(page.locator(".bs-container")).not.toHaveAttribute("data-annotating");
});

// A finger put on a page still gliding from a swipe stops it and taps nothing, as in Bible Strong,
// where the browser decides tap or scroll: not a verse, and not the dock's sections (ui/fling.ts).
async function glide(page: Page) {
  await page.evaluate(() => {
    const fire = (type: string, target: EventTarget) => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches: [], changedTouches: [] }));
    const scroller = document.querySelector(".bs-scroll")!;
    fire("touchstart", document.body); scroller.dispatchEvent(new Event("scroll"));
    fire("touchend", document.body); scroller.dispatchEvent(new Event("scroll"));
  });
}
async function tapTab(page: Page, name: string) {
  await page.locator("nav.tabs").getByRole("button", { name, exact: true }).evaluate(el => {
    const r = el.getBoundingClientRect(), at = { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", at)); el.dispatchEvent(new PointerEvent("pointerup", at));
    el.dispatchEvent(Object.assign(new Event("touchend", { bubbles: true, cancelable: true }), { touches: [], changedTouches: [] }));
  });
}
test("a touch that stops a gliding page taps neither the verse nor the dock under it", async ({ page }) => {
  await gestureClock(page);
  await glide(page);
  await touchVerse(page, "touchstart", 1, 3); await touchVerse(page, "touchend", 0, 3);
  await page.clock.runFor(300);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await glide(page);
  await tapTab(page, "Search");
  await page.clock.runFor(300);
  await expect(page).toHaveURL(/\/read\/genesis\/1/);
  // Once the page has come to rest, the same taps work.
  await page.clock.runFor(200);
  await touchVerse(page, "touchstart", 1, 3); await touchVerse(page, "touchend", 0, 3);
  await page.clock.runFor(300);
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(1);
});

test("the verse sheet stays put under a resting finger and a verse in view barely moves, as Bible Strong's", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gestureClock(page);
  // How far the verse's middle sits from the middle of the reader.
  const offCentre = async () => page.locator("#verset-12").evaluate(el => { const r = el.getBoundingClientRect(), sc = el.closest(".bs-scroll")!, s = sc.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - (s.top + sc.clientHeight / 2)); });
  await touchVerse(page, "touchstart", 1, 12); await touchVerse(page, "touchend", 0, 12);
  await page.clock.runFor(300);
  const sheet = page.getByRole("dialog", { name: "Selected: Genesis 1:12", exact: true });
  await expect(sheet).toBeVisible();
  // Bible Strong centres the verse in the reader, not in what the sheet leaves showing.
  await page.clock.runFor(600);
  // Within the header's give: centring above the sheet put it about half the sheet higher.
  await expect.poll(offCentre).toBeLessThan(60);
  const top = async () => (await sheet.boundingBox())!.y;
  const rest = await top();
  const grab = (await sheet.locator(".bs-sheet__grab").boundingBox())!;
  // Pulled up, a sheet that cannot grow does not move at all (vaul damps it to nothing).
  await page.mouse.move(grab.x + 20, grab.y + 8); await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y - 30, { steps: 4 });
  expect(Math.abs((await top()) - rest)).toBeLessThan(1);
  await page.mouse.up();
});

// Bible Strong's Pressable: the pressed look comes 50 ms after the finger lands, a scroll takes it
// away, and a tap shorter than that still shows it briefly (ui/press.ts).
test("the pressed look waits 50 ms, a scroll cancels it, and a quick tap still shows it", async ({ page }) => {
  await gestureClock(page);
  const button = page.getByRole("button", { name: "Scripture options", exact: true });
  const send = (type: string) => button.evaluate((el, type) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, button: 0, pointerId: 3, pointerType: "touch", clientX: r.x + 5, clientY: r.y + 5 }));
  }, type);
  await send("pointerdown");
  await expect(button).not.toHaveAttribute("data-pressed");
  await page.clock.runFor(60);
  await expect(button).toHaveAttribute("data-pressed", "");
  await page.locator(".bs-scroll").evaluate(el => el.dispatchEvent(new Event("scroll")));
  await expect(button).not.toHaveAttribute("data-pressed");
  await send("pointerup");
  await send("pointerdown"); await page.clock.runFor(20); await send("pointerup");
  await expect(button).toHaveAttribute("data-pressed", "");
  await page.clock.runFor(150);
  await expect(button).not.toHaveAttribute("data-pressed");
});

// Bible Strong's TouchableOpacity: a pressed card, button or icon button fades to 0.2; nothing shrinks.
test("a press fades what is pressed and never scales it", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1")).toBeVisible();
  const looks = await page.evaluate(async () => {
    const out: Record<string, { opacity: string; transform: string }> = {};
    for (const cls of ["card", "btn", "icon-btn", "nt-item"]) {
      const el = document.createElement("button"); el.className = cls; el.textContent = cls; el.setAttribute("data-pressed", "");
      el.style.transition = "none"; document.getElementById("root")!.appendChild(el);
      const s = getComputedStyle(el); out[cls] = { opacity: s.opacity, transform: s.transform }; el.remove();
    }
    return out;
  });
  for (const [cls, look] of Object.entries(looks)) expect(look, cls).toEqual({ opacity: "0.2", transform: "none" });
});

// On a phone the browser takes a horizontal pan over the drawer's scroller and cancels the pointer;
// the swipe still closes the drawer from its touchend, unless it scrolled a row of cards.
test("a touch swipe closes Home even when the browser cancels its pointer, but not one that scrolls the shelf", async ({ page }) => {
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  const home = page.locator(".drawer--home");
  const swipe = (selector: string, scroll = false) => home.locator(selector).first().evaluate((el, scroll) => {
    const r = el.getBoundingClientRect(), y = r.y + Math.min(20, r.height / 2), x0 = r.x + r.width - 30, x1 = x0 - 160;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, pointerId: 9, pointerType: "touch", clientX: x0, clientY: y }));
    el.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, isPrimary: true, pointerId: 9, pointerType: "touch" }));
    if (scroll) { const row = el.closest<HTMLElement>(".widgets")!; row.scrollLeft += 80; }
    el.dispatchEvent(Object.assign(new Event("touchend", { bubbles: true, cancelable: true }), { touches: [], changedTouches: [{ clientX: x1, clientY: y }] }));
  }, scroll);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(home).toHaveAttribute("data-open", "");
  await expect(home.locator(".feed__card--skel")).toHaveCount(0);
  await home.locator(".widgets").scrollIntoViewIfNeeded();
  await swipe(".widgets .widget", true);
  await expect(home).toHaveAttribute("data-open", "");
  await swipe(".stats--six");
  await expect(home).not.toHaveAttribute("data-open");
});

// Bible Strong's drawers: Events at the top of Home (here the class on the air), the offline notice,
// the menu's account card and legal links, each drawer kept where it was, and a new tab closing them.
test("the drawers show the live class, the offline notice, the account and legal links, and keep their place", async ({ page, context }) => {
  await page.route("**/api/live", r => r.fulfill({ json: { live: true, upcoming: false, video: "abcdefghijk", title: "The Sabbath class", starts: null } }));
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const home = page.locator(".drawer--home");
  await expect(home.locator(".live-card")).toContainText("Live now");
  await expect(home.locator(".live-card")).toHaveAttribute("href", "/watch/abcdefghijk?live=1");
  await context.setOffline(true);
  await expect(home.getByRole("status").filter({ hasText: "You are offline" })).toBeVisible();
  await context.setOffline(false);
  await expect(home.getByText("You are offline")).toHaveCount(0);
  await home.getByRole("button", { name: "Close Home" }).click();
  await page.getByRole("button", { name: "Main menu", exact: true }).click();
  const more = page.locator(".drawer--more");
  await expect(more.locator(".more__account")).toHaveAttribute("href", "/settings/account");
  await expect(more.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(more.getByRole("link", { name: "Downloads" })).toHaveAttribute("href", "/resources");
  // The menu opens again where it was scrolled, as Bible Strong keeps it mounted.
  await more.locator(".drawer__scroll").evaluate(el => { el.scrollTop = 300; });
  await more.getByRole("button", { name: "Close the menu" }).click();
  await expect(more).not.toHaveAttribute("data-open");
  await page.getByRole("button", { name: "Main menu", exact: true }).click();
  await expect.poll(() => more.locator(".drawer__scroll").evaluate(el => el.scrollTop)).toBe(300);
});

test("a verse picked from History opens the whole chapter at that verse, not a focused passage", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:hist", JSON.stringify([{ slug: "genesis", chapter: 1, verse: 18, name: "Genesis 1", at: Date.now() }])));
  await page.goto("/history");
  await page.locator(".histitem", { hasText: "Genesis 1:18" }).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?at=18$/);
  await expect(page.locator("#verset-18")).toBeInViewport();
  await expect(page.locator("#verset-1")).toHaveCount(1);
  await expect(page.locator(".bs-context")).toHaveCount(0);
});

test("opening the app at its root reopens the tab that was current", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
});

test("opening the app at its root stays on Home when the kept tabs cannot be read", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("cj:tabgroups", JSON.stringify({ group: "gone", groups: [] })); localStorage.removeItem("cj:tabs"); });
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#verset-1")).toHaveCount(0);
});

test("going back to verse 1 of the same chapter scrolls the reader back to the top", async ({ page }) => {
  await page.goto("/read/genesis/1?at=28");
  await expect(page.locator("#verset-28")).toBeInViewport();
  await page.evaluate(() => { history.pushState({}, "", "/read/genesis/1"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.locator("#verset-1")).toBeInViewport();
});

test("a verse opened while the last chapter stands in is scrolled to again when its chapter arrives", async ({ page }) => {
  // John 3 is slow and longer than Genesis 1, so its verse 18 sits far lower than the stand-in's.
  const long = Array.from({ length: 36 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}: ${"For God so loved the world, that he gave his only begotten Son. ".repeat(6)}` }));
  await page.route(`${DATA}/api/kjv/john/3.json`, async r => { await new Promise(res => setTimeout(res, 800)); await r.fulfill({ json: { book: "john", chapter: 3, translation: "KJV", verses: long } }); });
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await page.evaluate(() => { history.pushState({}, "", "/read/john/3?at=18"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect(page.locator("#verset-18 .bs-text")).toContainText("For God so loved");
  await expect(page.locator("#verset-18")).toBeInViewport();
});

test("the relation picker offers the notes written in the reader", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1/2": { id: "n", title: "Creation", description: "My saved note", date: 1 } })));
  await page.goto("/relations?endpoint=john-3-16");
  await page.getByRole("button", { name: "Add a precept" }).click();
  const picker = page.getByRole("dialog", { name: "Add relation" });
  await expect(picker.locator("text=Creation")).toBeVisible();
});

test("the dictionary pages through every entry of a letter, and says when a page did not load", async ({ page }) => {
  let failNext = false;
  await page.route("**/api/dictionary?*", r => {
    const url = new URL(r.request().url()), p = +(url.searchParams.get("page") ?? 1);
    if (p === 2 && failNext) { failNext = false; return r.fulfill({ status: 500, body: "" }); }
    const all = Array.from({ length: 70 }, (_, i) => ({ slug: `a${i + 1}`, term: `Aentry ${i + 1}` }));
    return r.fulfill({ json: { count: 70, page: p, pages: 2, rows: all.slice((p - 1) * 60, p * 60), related: [], total: 3963 } });
  });
  await page.goto("/dictionary?letter=A");
  await expect(page.getByRole("link", { name: "Aentry 1", exact: true })).toBeVisible();
  await page.locator(".list-more").scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", { name: "Aentry 70" })).toBeVisible();
  // A failed list is a failure with Retry, not an empty letter.
  await page.unroute("**/api/dictionary?*");
  await page.route("**/api/dictionary?*", r => r.fulfill({ status: 503, body: "" }));
  await page.goto("/dictionary?letter=B");
  await expect(page.getByText("The dictionary did not load")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("a typed Strong's number is searched as written, whatever the language tab", async ({ page }) => {
  await page.route(`${DATA}/api/strongs/index.json`, r => r.fulfill({ json: [
    { n: "H26", lemma: "אֲבִיגַיִל", xlit: "Abigail", def: "Abigail", count: 17 },
    { n: "G26", lemma: "ἀγάπη", xlit: "agape", def: "love", count: 116 },
  ] }));
  await page.goto("/lexicon?lang=hebrew");
  await page.fill("#lex-q", "G26");
  await expect(page.locator("a[href='/lexicon/G26']").filter({ hasText: "love" })).toBeVisible();
  await expect(page.locator("a[href='/lexicon/H26']")).toHaveCount(0);
});

test.describe("verse resources navigation", () => {
  const passage = ["Beginning", "Darkness", "Light"].map((text, i) => ({ verse: i + 1, text, words: [[text, []]] }));
  test.beforeEach(async ({ page }) => {
    await page.route(`${DATA}/api/kjv/genesis/1.json`, r => r.fulfill({ json: { book: "Genesis", chapter: 1, translation: "KJV", verses: passage } }));
    await page.route("**/api/dictionary/lookup?*", r => {
      const word = new URL(r.request().url()).searchParams.get("word")!;
      return r.fulfill({ json: { slug: word.toLowerCase(), term: `${word} entry`, definitions: [`${word} definition`] } });
    });
    await page.route("**/api/nave/en/verses/*/topics", r => {
      const verseKey = new URL(r.request().url()).pathname.split("/").at(-2)!;
      const verse = Number(verseKey.split("-").at(-1));
      return r.fulfill({ json: { resource: { kind: "nave", language: "en", revision: "test" }, verseKey, verseTopics: [{ normalizedName: `verse-${verse}`, name: `Theme for verse ${verse}` }], chapterTopics: [] } });
    });
    await page.route(`${DATA}/api/concordance/genesis/1.json`, r => r.fulfill({ json: {
      book: "Genesis", chapter: 1,
      cited_by: passage.flatMap(v => [
        { url: `/topics/verse-${v.verse}`, kind: "topic", label: `Theme for verse ${v.verse}`, verses: String(v.verse) },
        { url: `/classes/verse-${v.verse}`, kind: "class", label: `Comment for verse ${v.verse}`, verses: String(v.verse) },
      ]),
    } }));
    await page.goto("/read/genesis/1");
    await page.locator("#verset-2 .bs-num").click({ delay: 600 });
    await expect(page.locator(".bs-resfooter")).toBeVisible();
  });

  for (const tab of ["Lexicon", "Dictionary", "Themes", "Comments"]) test(`${tab} keeps its tab while moving verses and stops at chapter boundaries`, async ({ page }) => {
    const sheet = page.locator(".bs-resources-sheet");
    const selected = sheet.getByRole("tab", { name: tab, exact: true });
    await selected.click();
    const previous = sheet.getByRole("button", { name: "Previous verse", exact: true });
    const next = sheet.getByRole("button", { name: "Next verse", exact: true });
    await expect(next).toBeVisible();
    const content = (verse: number) => tab === "Dictionary" ? `${passage[verse - 1].text} entry` : tab === "Themes" ? `Theme for verse ${verse}` : `Comment for verse ${verse}`;
    const checkVerse = async (verse: number) => {
      await expect(sheet.getByRole("heading", { name: `Genesis 1:${verse}`, exact: true })).toBeVisible();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect(sheet.locator(tab === "Lexicon" ? ".bs-vdetail__text" : ".bs-resources__verse")).toHaveText(passage[verse - 1].text);
      if (tab !== "Lexicon") {
        await expect(sheet.getByRole(tab === "Themes" ? "link" : "button", { name: content(verse), exact: false })).toBeVisible();
        for (const other of passage.filter(v => v.verse !== verse)) await expect(sheet.getByRole(tab === "Themes" ? "link" : "button", { name: content(other.verse), exact: false })).toHaveCount(0);
      }
      await expect(page).toHaveURL(/\/read\/genesis\/1$/);
      await expect(previous).toHaveCount(verse === 1 ? 0 : 1);
      await expect(next).toHaveCount(verse === passage.length ? 0 : 1);
    };
    await checkVerse(2);
    await previous.click();
    await checkVerse(1);
    await next.click();
    await checkVerse(2);
    await next.click();
    await checkVerse(3);
    await previous.click();
    await checkVerse(2);
    await sheet.getByRole("tab", { name: tab === "Dictionary" ? "Themes" : "Dictionary", exact: true }).click();
    await expect(sheet.getByRole("heading", { name: "Genesis 1:2", exact: true })).toBeVisible();
    await selected.click();
    await checkVerse(2);
  });

  test("References, Precepts and People keep their existing coverage without verse controls", async ({ page }) => {
    const sheet = page.locator(".bs-resources-sheet");
    for (const tab of ["References", "Precepts", "People"]) {
      await sheet.getByRole("tab", { name: tab, exact: true }).click();
      await expect(sheet.getByRole("heading", { name: "Genesis 1:2", exact: true })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /^(Previous|Next) verse$/ })).toHaveCount(0);
    }
  });
});

test("a verse's references that fail to load say so, with Retry, instead of 'none'", async ({ page }) => {
  let fail = true;
  await page.route(`${DATA}/api/xref/genesis/1.json`, r => (fail ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ json: { 1: [["john", 1, 1]] } })));
  await page.goto("/read/genesis/1");
  await expect(page.locator("#verset-1 .bs-num")).toBeVisible();
  await touchVerse(page, "touchstart", 1);
  await touchVerse(page, "touchend", 0);
  await page.getByRole("tab", { name: "Study" }).click();
  await page.getByRole("button", { name: "References", exact: true }).click();
  const sheet = page.locator(".bs-resources");
  await expect(sheet.getByText("This did not load.")).toBeVisible();
  const error = sheet.locator(".bs-unavailable");
  await expect(error.locator("svg")).toHaveAttribute("width", "72");
  await expect(error.locator("svg")).toHaveAttribute("height", "72");
  await expect(error.locator(".bs-unavailable__content")).toHaveCSS("max-width", "320px");
  await expect(error.locator(".bs-unavailable__title")).toHaveCSS("font-weight", "700");
  await expect(error.locator(".bs-unavailable__detail")).toHaveCSS("margin-top", "8px");
  await expect(error.getByRole("button", { name: "Retry" })).toHaveCSS("font-weight", "700");
  await expect(error.getByRole("button", { name: "Retry" })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(sheet.getByText("No cross references for this verse.")).toHaveCount(0);
  fail = false;
  await sheet.getByRole("button", { name: "Retry" }).click();
  await expect(sheet.getByText("This did not load.")).toHaveCount(0);
});

test("a running plan whose books fail to load says so, and never offers to start over", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:plan", JSON.stringify({ startedAt: "2026-10-01", day: 3, streak: 2, perDay: 4, books: ["john"], name: "John" })));
  await page.route(`${DATA}/api/kjv/books.json`, r => r.fulfill({ status: 500, body: "" }));
  await page.goto("/plan");
  await expect(page.getByText("Your plan did not load")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start the plan" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start over" })).toHaveCount(0);
});

test("the day's verse is asked for by the reader's own date", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", r => { if (r.url().includes("/api/verse-of-day")) asked.push(new URL(r.url()).searchParams.get("date") ?? ""); });
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect.poll(() => asked).toContain(await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }));
});

test("a saved relation between two non-verse items opens from the saved list", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cj:rel_other", JSON.stringify([{ id: "r1", type: "linked", direction: "none", endpoints: [{ type: "dictionary", slug: "eden", label: "Eden" }, { type: "entry", url: "/classes/2026/x", kind: "class", label: "A class" }], createdAt: 1, updatedAt: 1 }])));
  await page.goto("/relations");
  await page.locator(".nt-item", { hasText: "Eden" }).click();
  await expect(page).toHaveURL(/endpoint=dictionary%3Aeden/);
  await expect(page.locator(".rel-row", { hasText: "A class" })).toBeVisible();
});

test("a reference in content opens a preview card of the passage, with Open and nested Back, and closing leaves the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1/2": { id: "n", title: "Creation", description: "Light came first (Genesis 1:3)", date: 1 } }));
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([
      { id: "r1", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-20"], label: "Genesis 1:20" }, { type: "verse", verseKeys: ["john-3-16"], label: "John 3:16" }], createdAt: 1, updatedAt: 1 },
      { id: "r2", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-20"], label: "Genesis 1:20" }, { type: "note", verseKey: "genesis-1-2", label: "Creation" }], createdAt: 1, updatedAt: 2 },
    ]));
  });
  await preferChips(page);
  await page.goto("/read/genesis/1");
  const john = page.locator("#verset-20 .rel-tag", { hasText: "John 3:16" });
  await john.scrollIntoViewIfNeeded();
  const top = () => page.locator("#verset-20").evaluate((el) => Math.round(el.getBoundingClientRect().top));
  const before = await top();

  await john.click();
  const card = page.getByRole("dialog", { name: "John 3:16 · KJV" });
  await expect(card).toContainText("Verse 16:");
  await expect(card).not.toContainText("Verse 17:");
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  await expect(card.getByRole("button", { name: "Back" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  expect(await top()).toBe(before);

  // A tap outside only closes the card: it doesn't select the verse under it.
  await page.clock.install();
  await john.click();
  await expect(card).toBeVisible();
  const outside = (await page.locator("#verset-18 .bs-num").boundingBox())!;
  await page.mouse.click(outside.x + outside.width / 2, outside.y + outside.height / 2);
  await page.clock.runFor(300);
  await expect(card).toBeHidden();
  await expect(page.locator(".bs-verse[data-selected]")).toHaveCount(0);
  await expect(page.locator(".bs-action")).toHaveCount(0);
  expect(await top()).toBe(before);

  // A reference inside the card opens on top of it; Back returns.
  await page.locator("#verset-20 .rel-tag", { hasText: "Creation" }).click();
  const note = page.getByRole("dialog", { name: "Note" });
  await expect(note).toContainText("Light came first");
  await note.getByRole("link", { name: "Genesis 1:3" }).click();
  const nested = page.getByRole("dialog", { name: "Genesis 1:3 · KJV" });
  await expect(nested).toContainText("Verse 3:");
  await nested.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Note" })).toContainText("Light came first");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Note" })).toBeHidden();
  expect(await top()).toBe(before);

  await john.click();
  await card.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/read\/john\/3\?v=16/);
});

test("reference preview body includes its padding within the viewport cap and scrolls independently", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([
      { id: "r", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-2"], label: "Genesis 1:2" }, { type: "verse", verseKeys: Array.from({ length: 21 }, (_, i) => `john-3-${i + 1}`), label: "John 3:1-21" }], createdAt: 1, updatedAt: 1 },
    ]));
  });
  await preferChips(page);
  await page.goto("/read/genesis/1");
  const readerScroll = () => page.locator(".bs-scroll").evaluate((el) => el.scrollTop);
  const before = await readerScroll();
  await page.locator("#verset-2 .rel-tag", { hasText: "John 3:1-21" }).click();
  const card = page.getByRole("dialog", { name: "John 3:1-21 · KJV" });
  const body = card.locator(".refpreview__body");
  await expect(card).toContainText("Verse 21:");
  await expect(card).not.toContainText("Verse 22:");
  for (const height of [844, 600]) {
    await page.setViewportSize({ width: 390, height });
    const cap = Math.min(360, height * 0.55);
    await expect.poll(() => body.evaluate((el) => el.clientHeight)).toBe(cap);
    expect(await body.evaluate((el) => el.scrollHeight)).toBeGreaterThan(cap);
  }
  await body.hover();
  await page.mouse.wheel(0, 800);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await readerScroll()).toBe(before);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  expect(await readerScroll()).toBe(before);
});

test("mixed-chapter relations retain direct navigation instead of a single-chapter preview", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([
      { id: "r", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-2"], label: "Genesis 1:2" }, { type: "verse", verseKeys: ["john-3-16", "genesis-1-3"], label: "Across chapters" }], createdAt: 1, updatedAt: 1 },
    ]));
  });
  await preferChips(page);
  await page.goto("/read/genesis/1");
  await page.locator("#verset-2 .rel-tag", { hasText: "Across chapters" }).click();
  await expect(page).toHaveURL(/\/read\/john\/3\?/);
  await expect(page.locator(".refpreview")).toHaveCount(0);
});

test("reference previews filter a very large verse range without expanding it", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("cj:bs_n_genesis_1", JSON.stringify({ "1/2": { id: "n", title: "A large range", description: "Read (John 3:3-999999999999,1)", date: 1 } }));
    localStorage.setItem("cj:rel_genesis_1", JSON.stringify([
      { id: "r", type: "linked", direction: "none", endpoints: [{ type: "verse", verseKeys: ["genesis-1-2"], label: "Genesis 1:2" }, { type: "note", verseKey: "genesis-1-2", label: "A large range" }], createdAt: 1, updatedAt: 1 },
    ]));
  });
  await preferChips(page);
  await page.goto("/read/genesis/1");
  await page.locator("#verset-2 .rel-tag", { hasText: "A large range" }).click();
  await page.getByRole("dialog", { name: "Note", exact: true }).getByRole("link", { name: "John 3:3-999999999999,1" }).click();
  const card = page.getByRole("dialog", { name: "John 3:3-999999999999,1 · KJV" });
  await expect(card.locator(".refpreview__num")).toHaveText(Array.from({ length: 31 }, (_, i) => String(i + 1)).filter((v) => v !== "2"));
  await expect(page).toHaveURL(/\/read\/genesis\/1$/);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
});

test("Strong's mode puts each word's numbers after it, per tab, and a tapped number opens its entries", async ({ page }) => {
  const words = [["In the beginning", ["H7225"]], ["God", ["H430"]], ["created", ["H1254", "H853"]], ["the heaven", ["H8064"]], ["and", ["H853"]], ["the earth.", []]];
  await page.route(/\/api\/kjv\/genesis\/1\.json$/, r => r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses: verses.map(v => v.verse === 1 ? { ...v, words } : v) } }));
  const glosses: Record<string, [string, string, string]> = { H7225: ["רֵאשִׁית", "rêʼshîyth", "beginning"], H430: ["אֱלֹהִים", "ʼĕlôhîym", "god"], H1254: ["בָּרָא", "bârâʼ", "create"], H853: ["אֵת", "ʼêth", "untranslated"], H8064: ["שָׁמַיִם", "shâmayim", "heaven"] };
  await page.route(/\/api\/strongs\/H\d+\.json$/, r => {
    const n = /(H\d+)\.json$/.exec(r.request().url())![1];
    const [lemma, xlit, word] = glosses[n];
    return r.fulfill({ json: { number: n, language: "Hebrew", lemma, xlit, pron: "", derivation: "", def: `The definition of ${n}.`, kjv: "", count: 1, verses: 1, words: [{ word, count: 1 }], occurrences: [], source: "" } });
  });
  await page.goto("/read/genesis/1");
  const verse = page.locator("#verset-1");
  await expect(verse.locator(".bs-text")).toContainText("In the beginning God created");
  const s = page.getByRole("button", { name: "Choose the Strong Bible display", exact: true });
  await expect(s).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".bs-strongref-inline")).toHaveCount(0);

  // Text display: Text, Strong (with the Old Testament's H0430), and Reverse interlinear, which needs an original text.
  await s.click();
  const display = page.getByRole("dialog", { name: "Text display" });
  await expect(display.getByRole("radio", { name: "Text. Translation only" })).toHaveAttribute("aria-checked", "true");
  await expect(display.getByRole("radio", { name: "Strong. Text + numbers" })).toContainText("H0430");
  await expect(display.getByRole("radio", { name: "Reverse interlinear. Translation then original" })).toHaveAttribute("aria-disabled", "true");
  await display.getByRole("radio", { name: "Strong. Text + numbers" }).click();
  await expect(display).toBeHidden();
  await expect(s).toHaveAttribute("aria-pressed", "true");

  // Each keyed word keeps its text and gets its numbers after it, "the earth." none.
  const refs = verse.locator(".bs-strongref-inline");
  await expect(refs).toHaveText(["H7225", "H0430", "H1254 · H0853", "H8064", "H0853"]);
  expect(await verse.locator(".bs-text").evaluate((el) => [...el.childNodes].map((n) => (n as HTMLElement).dataset?.ignoreVerseTouch === undefined ? n.textContent : "").join(""))).toBe("In the beginning God created the heaven and the earth.");

  // A tapped reference opens its sheet, its numbers as pills, the tapped one first; every reference to that number is marked.
  await refs.nth(2).click();
  const sel = page.getByRole("dialog", { name: "created · KJV" });
  await expect(sel.getByRole("tab")).toHaveText(["H1254", "H0853"]);
  await expect(sel.getByRole("tab", { name: "H1254" })).toHaveAttribute("aria-selected", "true");
  await expect(sel.getByRole("button", { name: "H1254 · create" })).toBeVisible();
  await expect(refs.nth(2)).toHaveAttribute("data-selected", "");
  await expect(refs.nth(4)).not.toHaveAttribute("data-selected", "");
  await sel.getByRole("tab", { name: "H0853" }).click();
  await expect(sel.getByRole("tab", { name: "H0853" })).toHaveAttribute("aria-selected", "true");
  // The same reference again closes it.
  await refs.nth(2).click();
  await expect(sel).toBeHidden();
  await expect(refs.nth(2)).not.toHaveAttribute("data-selected", "");

  // A card opens the full entry.
  await refs.nth(1).click();
  const god = page.getByRole("dialog", { name: "God · KJV" });
  await god.getByRole("button", { name: "H0430 · god" }).click();
  await expect(god).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Word study" })).toBeVisible();
  await page.getByRole("dialog", { name: "Word study" }).press("Escape");
  await expect(page.getByRole("dialog", { name: "Word study" })).toBeHidden();

  // The mode is the tab's, kept on the device; "s" cycles it while nothing is open.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cj:strong-mode") ?? "{}"))).toEqual({ "bible-one": "visible" });
  await page.reload();
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(5);
  await page.locator("body").press("s");
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(0);
  await expect(s).toHaveAttribute("aria-pressed", "false");
  await page.locator("body").press("s");
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(5);
});

test("Strong's mode moves a background highlight to the verse number and hides its numbers while annotating", async ({ page }) => {
  await page.route(/\/api\/kjv\/genesis\/1\.json$/, r => r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses: verses.map(v => v.verse === 1 ? { ...v, words: [["In the beginning", ["H7225"]], ["God", ["H430"]], ["created the heaven and the earth.", []]] } : v) } }));
  await page.addInitScript(() => localStorage.setItem("cj:strong-mode", JSON.stringify({ "bible-one": "visible" })));
  await page.goto("/read/genesis/1");
  const verse = page.locator("#verset-1");
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(2);
  await verse.locator(".bs-num").click();
  const sheet = page.getByRole("dialog", { name: "Selected: Genesis 1:1", exact: true });
  await page.locator(".bs-colors__cell").nth(1).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Bible Strong's getNumberHighlight: the number takes the colour, the text and its numbers stay clear.
  await expect(verse.locator(".bs-num")).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(verse.locator(".bs-num")).toHaveCSS("border-radius", "3px");
  expect(await verse.locator(".bs-text").evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  // Annotating shows no numbers; leaving brings them back.
  await verse.locator(".bs-num").click();
  await sheet.getByRole("tab", { name: "Annotate", exact: true }).click();
  await sheet.getByRole("button", { name: "Free mode", exact: true }).click();
  await expect(page.locator(".bs-container")).toHaveAttribute("data-annotating", "");
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose the Strong Bible display", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Exit annotation mode", exact: true }).click();
  await expect(verse.locator(".bs-strongref-inline")).toHaveCount(2);
});
