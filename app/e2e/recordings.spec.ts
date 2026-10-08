import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const narrator = { id: "test-reader", reader: "Test human narrator", audio: "/api/audio/recordings/test-reader/psalms/23.m4a?v=test", source: "https://librivox.org/", license: "https://librivox.org/pages/public-domain/", verses: Array.from({ length: 6 }, (_, i) => [i + 1, i * 10, i * 10 + 9]) };
async function setup(page: Page, hasRecording = true) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route("**/api/voices", (r) => r.fulfill({ json: { voices: [{ id: "asteria", name: "Asteria", note: "Clear reading" }] } }));
  await page.route("**/api/recordings/**", (r) => r.fulfill({ json: { narrators: hasRecording ? [narrator] : [] } }));
  await page.route("**/api/tts/**", (r) => r.fulfill({ contentType: "audio/mpeg", body: "stub" }));
  await page.addInitScript(() => {
    const list: FakeAudio[] = [];
    class FakeAudio {
      src: string; currentTime = 0; playbackRate = 1; paused = true;
      onended: (() => void) | null = null; ontimeupdate: (() => void) | null = null; onerror: (() => void) | null = null;
      constructor(src = "") { this.src = src; list.push(this); }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
    }
    Object.defineProperty(window, "Audio", { value: FakeAudio });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { constructor(public text: string) {} } });
    Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [{ name: "Test device", lang: "en-GB" }], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(u: SpeechSynthesisUtterance) { u.onstart?.({} as SpeechSynthesisEvent); }, pause() {}, resume() {} } });
    (window as unknown as { __audio: unknown }).__audio = list;
  });
}
const audios = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { src: string; currentTime: number; playbackRate: number; paused: boolean }[] }).__audio.map((a) => ({ src: a.src, currentTime: a.currentTime, playbackRate: a.playbackRate, paused: a.paused })));
const tick = (page: Page, time: number) => page.evaluate((t) => { const a = (window as unknown as { __audio: { currentTime: number; ontimeupdate?: () => void }[] }).__audio.at(-1)!; a.currentTime = t; a.ontimeupdate?.(); }, time);
async function openPanel(page: Page) {
  await page.goto("/read/psalms/23");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
}
test("human narrator seeks in one chapter audio element and follows verse timings", async ({ page }, testInfo) => {
  await setup(page); await openPanel(page);
  const sheet = page.getByRole("dialog", { name: "Voice", exact: true });
  await expect(sheet.getByRole("heading", { name: "Narrators", exact: true })).toBeVisible();
  await sheet.getByRole("radio", { name: /Test human narrator/ }).click();
  await expect(page.getByRole("button", { name: "Stop audio playback", exact: true })).toBeVisible();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await expect(page.getByRole("button", { name: "Pitch 1x" })).toBeDisabled();
  await tick(page, 21);
  await expect(page.locator("#verset-3")).toHaveAttribute("data-reading", "");
  await tick(page, 29.5);
  await expect(page.locator("#verset-3")).toHaveAttribute("data-reading", "");
  await page.getByRole("button", { name: "Next verse", exact: true }).click();
  await expect.poll(async () => (await audios(page))[0].currentTime).toBe(30);
  await page.getByRole("button", { name: "Previous verse", exact: true }).click();
  await expect.poll(async () => (await audios(page))[0].currentTime).toBe(20);
  await page.locator("#verset-2 .bs-num").click();
  await expect.poll(async () => (await audios(page))[0].currentTime).toBe(10);
  await page.getByRole("button", { name: "Speed 1x", exact: true }).click();
  await page.getByRole("dialog", { name: "Speed", exact: true }).getByRole("radio", { name: "1.5x", exact: true }).click();
  await expect.poll(async () => (await audios(page))[0].playbackRate).toBe(1.5);
  expect((await audios(page)).length).toBe(1);
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByRole("button", { name: "Stop audio playback", exact: true }).click();
  expect((await audios(page))[0].paused).toBe(true);
  await expect(page.locator("[data-reading]")).toHaveCount(0);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("narrator-panel-390x780.png") });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("narrator-sheet-390x780.png") });
});

test("AI prefetches the next verse and switching voices keeps the current verse", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "narrator:test-reader"));
  const requested: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/tts/")) requested.push(r.url()); });
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await tick(page, 21);
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("radio", { name: /Asteria/ }).click();
  await expect(page.locator("#verset-3")).toHaveAttribute("data-reading", "");
  await expect.poll(() => requested.some((u) => u.includes("/23/4?"))).toBe(true);
  expect(requested.some((u) => u.includes("/23/3?"))).toBe(true);
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("radio", { name: /Test human narrator/ }).click();
  await expect.poll(async () => (await audios(page)).at(-1)?.currentTime).toBe(20);
  await expect(page.getByRole("button", { name: "Stop audio playback", exact: true })).toBeVisible();
});

test("offline text stays saved when the optional narration is declined or fails", async ({ page }) => {
  await setup(page);
  const chapter = { readerId: "test-reader", reader: "Test reader", slug: "obadiah", chapter: 1, audio: "recordings/test-reader/obadiah/1.m4a", bytes: 12_000_000, source: narrator.source, license: narrator.license };
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [chapter] } }));
  await page.route("**/api/kjv/books.json", (r) => r.fulfill({ json: [{ book: "Obadiah", slug: "obadiah", chapters: 1, chapterIds: [1], testament: "old" }] }));
  await page.route("**/api/kjv/obadiah/1.json", (r) => r.fulfill({ json: { book: "Obadiah", chapter: 1, verses: [{ verse: 1, text: "Test verse" }] } }));
  const requests: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/audio/recordings/")) requests.push(r.url()); });
  await page.goto("/settings#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  await page.evaluate(() => { const tg = (window as unknown as { Telegram: { WebApp: { showConfirm: (text: string, cb: (yes: boolean) => void) => void } } }).Telegram.WebApp; tg.showConfirm = (text, cb) => { (window as unknown as { __confirmation: string }).__confirmation = text; cb(false); }; });
  await page.getByRole("button", { name: "Save a book", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Obadiah/ }).click();
  // Text status and narration completeness are two separate pills (CYB-123): declining narration never hides that the text is saved.
  await expect(page.locator(".pill--ok")).toHaveText("text");
  await expect(page.locator(".pill").last()).toHaveText("no narration");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __confirmation: string }).__confirmation)).toContain("12.0 MB");
  expect(requests).toEqual([]);
  // Managing narration and removing the book are separate actions: tapping the saved row no longer deletes anything by itself.
  await page.getByRole("button", { name: /Obadiah.*saved on this device/i }).click();
  const manage = page.getByRole("dialog", { name: "Obadiah" });
  await expect(manage.getByRole("button", { name: "Download narration" })).toBeVisible();
  await manage.getByRole("button", { name: "Remove text and narration" }).click();
  await expect(page.locator(".pill")).toHaveCount(0);
  // Save again, consenting to narration but with its media unavailable: the text still survives a total narration failure.
  await page.evaluate(() => { (window as unknown as { Telegram: { WebApp: { showConfirm: (text: string, cb: (yes: boolean) => void) => void } } }).Telegram.WebApp.showConfirm = (_text, cb) => cb(true); });
  await page.route("**/api/audio/recordings/**", (r) => r.fulfill({ status: 503 }));
  await page.getByRole("button", { name: "Save a book", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Obadiah/ }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator(".pill--ok")).toHaveText("text");
  await expect(page.locator(".pill").last()).toHaveText("no narration");
});

test("a book with no licensed narration at all never offers a download that fetches nothing (CYB-123 release review)", async ({ page }) => {
  await setup(page);
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [] } }));
  await page.route("**/api/kjv/books.json", (r) => r.fulfill({ json: [{ book: "Obadiah", slug: "obadiah", chapters: 1, chapterIds: [1], testament: "old" }] }));
  await page.route("**/api/kjv/obadiah/1.json", (r) => r.fulfill({ json: { book: "Obadiah", chapter: 1, verses: [{ verse: 1, text: "Test verse" }] } }));
  await page.goto("/settings#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  await page.getByRole("button", { name: "Save a book", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Obadiah/ }).click();
  // No confirmation dialog for narration appears: the catalog already says there is nothing to fetch.
  // The saved-book label never claims narration is saved for a book that has none (CYB-123 release review).
  await expect(page.locator(".pill--ok")).toHaveText("text");
  await expect(page.locator(".pill").last()).toHaveText("no narration");
  await expect(page.getByRole("button", { name: /Obadiah.*narration not saved.*tap to manage/i })).toBeVisible();
  // Managing the book offers no "Download narration" action to tap, since nothing would be fetched.
  await page.getByRole("button", { name: /Obadiah.*saved on this device/i }).click();
  const manage = page.getByRole("dialog", { name: "Obadiah" });
  await expect(manage.getByRole("button", { name: "Download narration" })).toHaveCount(0);
  await expect(manage.getByRole("button", { name: "Remove narration only" })).toHaveCount(0);
  await expect(manage.getByRole("button", { name: "Remove text and narration" })).toBeVisible();
});

test("a narration retry downloads only what's missing, keeps the saved text, and reaches complete", async ({ page }) => {
  await setup(page);
  const chapters = [
    { readerId: "test-reader", reader: "Test reader", slug: "obadiah", chapter: 1, audio: "recordings/test-reader/obadiah/1.m4a", bytes: 5_000_000, source: narrator.source, license: narrator.license },
    { readerId: "test-reader", reader: "Test reader", slug: "obadiah", chapter: 2, audio: "recordings/test-reader/obadiah/2.m4a", bytes: 7_000_000, source: narrator.source, license: narrator.license },
  ];
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters } }));
  await page.route("**/api/kjv/books.json", (r) => r.fulfill({ json: [{ book: "Obadiah", slug: "obadiah", chapters: 2, chapterIds: [1, 2], testament: "old" }] }));
  await page.route(/\/api\/kjv\/obadiah\/\d\.json/, (r) => { const n = Number(new URL(r.request().url()).pathname.match(/obadiah\/(\d)\.json/)![1]); return r.fulfill({ json: { book: "Obadiah", chapter: n, verses: [{ verse: 1, text: `Test verse ${n}` }] } }); });
  await page.route("**/api/recordings/obadiah/1", (r) => r.fulfill({ json: { narrators: [{ ...narrator, audio: "/api/audio/recordings/obadiah-1.m4a" }] } }));
  await page.route("**/api/recordings/obadiah/2", (r) => r.fulfill({ json: { narrators: [{ ...narrator, audio: "/api/audio/recordings/obadiah-2.m4a" }] } }));
  let chapter1Requests = 0, chapter2Fails = true;
  await page.route("**/api/audio/recordings/obadiah-1.m4a", (r) => { chapter1Requests++; return r.fulfill({ contentType: "audio/mp4", body: "chapter-1" }); });
  await page.route("**/api/audio/recordings/obadiah-2.m4a", (r) => chapter2Fails ? r.fulfill({ status: 503 }) : r.fulfill({ contentType: "audio/mp4", body: "chapter-2" }));
  const textRequests: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/kjv/obadiah/")) textRequests.push(r.url()); });
  await page.goto("/settings#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  await page.evaluate(() => { (window as unknown as { Telegram: { WebApp: { showConfirm: (t: string, cb: (yes: boolean) => void) => void } } }).Telegram.WebApp.showConfirm = (_t, cb) => cb(false); });
  await page.getByRole("button", { name: "Save a book", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Obadiah/ }).click();
  await expect(page.locator(".pill").last()).toHaveText("no narration");
  const savedTextRequests = textRequests.length;
  // Download narration directly from the saved row, without removing or re-fetching the text.
  await page.getByRole("button", { name: /Obadiah.*saved on this device/i }).click();
  await page.getByRole("dialog", { name: "Obadiah" }).getByRole("button", { name: "Download narration" }).click();
  await expect(page.locator(".pill").last()).toHaveText("partial");
  expect(textRequests.length).toBe(savedTextRequests);
  expect(chapter1Requests).toBe(1);
  // Fix the missing chapter and retry: the action now reads "Finish downloading", and the already-saved chapter is not re-fetched.
  chapter2Fails = false;
  await page.getByRole("button", { name: /Obadiah.*saved on this device/i }).click();
  await page.getByRole("dialog", { name: "Obadiah" }).getByRole("button", { name: "Finish downloading narration" }).click();
  await expect(page.locator(".pill--ok").last()).toHaveText("narration");
  expect(textRequests.length).toBe(savedTextRequests);
  expect(chapter1Requests).toBe(1);
});

test("recording credits open with Telegram's link handler", async ({ page }) => {
  await setup(page);
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [{ readerId: "test", reader: "Test reader", source: narrator.source, license: narrator.license }] } }));
  await page.goto("/settings/credits#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  await page.locator('a[href="https://librivox.org/"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log.some((r) => r[0] === "openLink" && r[1] === "https://librivox.org/"))).toBe(true);
});

test("Stop releases the prefetched AI verse without starting it", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem("ttsVoice", "ai:asteria");
    const urls = { created: [] as string[], revoked: [] as string[] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { const url = create(blob); urls.created.push(url); return url; };
    URL.revokeObjectURL = (url) => { urls.revoked.push(url); revoke(url); };
    (window as unknown as { __urls: unknown }).__urls = urls;
  });
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __urls: { created: string[] } }).__urls.created.length)).toBe(2);
  await page.getByRole("button", { name: "Stop audio playback", exact: true }).click();
  await expect.poll(() => page.evaluate(() => { const u = (window as unknown as { __urls: { created: string[]; revoked: string[] } }).__urls; return u.revoked.includes(u.created[1]); })).toBe(true);
  expect((await audios(page)).length).toBe(1);
});
test("missing chapter narration falls back to the saved AI voice", async ({ page }) => {
  await setup(page, false);
  await page.addInitScript(() => { localStorage.setItem("ttsVoice", "narrator:test-reader"); localStorage.setItem("ttsAiVoice", "ai:asteria"); });
  const requested: string[] = []; page.on("request", (r) => { if (r.url().includes("/api/tts/")) requested.push(r.url()); });
  await openPanel(page);
  await expect(page.getByRole("dialog", { name: "Voice", exact: true })).toContainText("No recording for this chapter");
  await expect(page.getByRole("radio", { name: /Test human narrator/ })).toHaveCount(0);
  await expect.poll(() => requested.some((u) => u.includes("voice=asteria"))).toBe(true);
  await expect.poll(async () => (await audios(page)).length).toBe(1);
});
test("a failed narrator switches to the saved AI voice without changing the preference", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "narrator:test-reader"));
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await page.evaluate(() => (window as unknown as { __audio: { onerror?: () => void }[] }).__audio[0].onerror?.());
  await expect(page.getByRole("status")).toContainText("Recording unavailable");
  await expect.poll(async () => (await audios(page)).length).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("ttsVoice"))).toBe("narrator:test-reader");
});

test("pause and resume preserve recording position from both audio controls", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "narrator:test-reader"));
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await tick(page, 21);
  await page.getByRole("button", { name: "Pause audio playback", exact: true }).click();
  expect((await audios(page))[0].paused).toBe(true);
  expect((await audios(page))[0].currentTime).toBe(21);
  await expect(page.locator("#verset-3")).toHaveAttribute("data-reading", "");
  await page.getByRole("button", { name: "Resume audio playback", exact: true }).click();
  expect((await audios(page))[0].paused).toBe(false);
  expect((await audios(page))[0].currentTime).toBe(21);
  await page.getByRole("button", { name: "Collapse", exact: true }).click();
  await page.getByRole("button", { name: "Pause audio playback", exact: true }).click();
  expect((await audios(page))[0].paused).toBe(true);
  await expect(page.getByRole("button", { name: "Resume audio playback", exact: true })).toBeVisible();
});

test("pause wins over a pending recording lookup", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "narrator:test-reader"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/recordings/psalms/23", async (route) => { await gate; await route.fulfill({ json: { narrators: [narrator] } }); });
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Pause audio playback", exact: true }).click();
  release();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  expect((await audios(page))[0].paused).toBe(true);
  await page.getByRole("button", { name: "Resume audio playback", exact: true }).click();
  expect((await audios(page))[0].paused).toBe(false);
});

test("paused voice and speed changes keep the verse and persist without autoplay", async ({ page }) => {
  await setup(page);
  await page.goto("/read/psalms/23");
  await page.evaluate(() => localStorage.setItem("ttsVoice", "narrator:test-reader"));
  await page.reload();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await tick(page, 21);
  await page.getByRole("button", { name: "Pause audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByRole("radio", { name: /Asteria/ }).click();
  await expect(page.getByRole("button", { name: "Resume audio playback", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Speed 1x", exact: true }).click();
  await page.getByRole("dialog", { name: "Speed", exact: true }).getByRole("radio", { name: "1.5x", exact: true }).click();
  expect((await audios(page)).every((a) => a.paused)).toBe(true);
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/tts/")) requests.push(r.url()); });
  await page.getByRole("button", { name: "Resume audio playback", exact: true }).click();
  await expect.poll(() => requests.some((u) => u.includes("/23/3?"))).toBe(true);
  await expect.poll(async () => (await audios(page)).at(-1)?.playbackRate).toBe(1.5);
  await page.reload();
  await expect(page.getByRole("button", { name: "Start audio playback", exact: true })).toBeVisible();
  expect((await audios(page)).length).toBe(0);
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect(page.getByRole("button", { name: "Speed 1.5x", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Asteria/ })).toHaveAttribute("aria-checked", "true");
});

async function continuitySetup(page: Page) {
  await setup(page);
  await page.addInitScript(() => {
    localStorage.setItem("ttsVoice", "narrator:test-reader");
    const session = { playbackState: "none", metadata: null, handlers: {} as Record<string, (() => void) | null>,
      setActionHandler(action: string, handler: (() => void) | null) { this.handlers[action] = handler; } };
    Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true });
    (window as unknown as { __session: unknown }).__session = session;
  });
  // A deliberately small catalog fixture proves order, cross-book transitions, and the end boundary.
  await page.route("**/api/kjv/books.json", (r) => r.fulfill({ json: [
    { book: "Psalms", slug: "psalms", chapterIds: [23, 24], chapters: 150, testament: "Old Testament" },
    { book: "John", slug: "john", chapterIds: [3], chapters: 21, testament: "New Testament" },
  ] }));
  await page.route(/\/api\/kjv\/(psalms|john)\/\d+\.json/, (r) => {
    const path = new URL(r.request().url()).pathname.split("/");
    return r.fulfill({ json: { book: path[3] === "john" ? "John" : "Psalms", chapter: Number(path[4].split(".")[0]), verses: Array.from({ length: 6 }, (_, i) => ({ verse: i + 1, text: `Audio fixture line ${i + 1}` })) } });
  });
  await page.route(/\/api\/recordings\/(psalms|john)\/\d+$/, (r) => r.fulfill({ json: { narrators: [{ ...narrator, audio: `/api/audio/recordings/test-reader/${new URL(r.request().url()).pathname.split("/").slice(-2).join("/")}.m4a` }] } }));
}
const routeTo = (page: Page, path: string) => page.evaluate((path) => { history.pushState({}, "", path); dispatchEvent(new PopStateEvent("popstate")); }, path);
const finish = (page: Page) => page.evaluate(() => { const a = (window as unknown as { __audio: { paused: boolean; onended?: () => void }[] }).__audio.at(-1)!; a.paused = true; a.onended?.(); });
const mediaAction = (page: Page, action: string) => page.evaluate((action) => (window as unknown as { __session: { handlers: Record<string, () => void> } }).__session.handlers[action](), action);

test("one narrator survives navigation and returns to its passage without restarting", async ({ page }, testInfo) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1); await tick(page, 21);
  await routeTo(page, "/settings");
  const bar = page.getByRole("region", { name: "Bible audio player" });
  await expect(bar).toBeVisible(); expect((await audios(page))[0].paused).toBe(false);
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("audio-player-settings.png"), animations: "disabled" });
  const box = await bar.boundingBox(); const dock = await page.locator(".tabs").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(dock!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bar.getByRole("button", { name: "Pause audio playback" }).click();
  expect((await audios(page))[0].paused).toBe(true);
  await bar.getByRole("button", { name: "Resume audio playback" }).click();
  await bar.getByRole("button", { name: "Return to current passage" }).click();
  await expect(page).toHaveURL(/\/read\/psalms\/23/);
  await expect(page.locator("#verset-3")).toHaveAttribute("data-reading", "");
  expect((await audios(page)).length).toBe(1); expect((await audios(page))[0].currentTime).toBe(21);
});

test("completion advances chapters and books on another screen, then stops at the catalog end", async ({ page }) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await routeTo(page, "/settings"); await finish(page);
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("psalms/24");
  await expect(page).toHaveURL(/\/settings/); await finish(page);
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("john/3");
  await finish(page); await expect(page.getByRole("status")).toHaveText("End of the Bible.");
  expect((await audios(page)).every((a) => a.paused)).toBe(true);
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
});

test("repeat works with its panel collapsed and Stop prevents any later completion", async ({ page }) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByRole("button", { name: "Collapse", exact: true }).click(); await tick(page, 51); await finish(page);
  await expect.poll(async () => (await audios(page)).at(-1)?.currentTime).toBe(0);
  await expect.poll(async () => (await audios(page)).at(-1)?.paused).toBe(false);
  await page.getByRole("button", { name: "Stop audio playback" }).click(); await finish(page);
  expect((await audios(page)).every((a) => a.paused)).toBe(true); await expect(page).toHaveURL(/\/psalms\/23/);
});

test("stop during next chapter loading cancels the deferred start", async ({ page }) => {
  await continuitySetup(page);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/kjv/psalms/24.json", async (r) => { await gate; await r.fulfill({ json: { book: "Psalms", chapter: 24, verses: [{ verse: 1, text: "Deferred audio fixture" }] } }); });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1); await finish(page);
  await expect(page.getByText("Loading audio…", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop audio playback", exact: true }).click(); release();
  await expect(page.getByRole("button", { name: "Start audio playback", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
  expect((await audios(page)).length).toBe(1); expect((await audios(page))[0].paused).toBe(true);
});

test("Media Session callbacks use the current chapter and explicit pause survives navigation", async ({ page }) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  await mediaAction(page, "pause"); await routeTo(page, "/settings");
  expect((await audios(page))[0].paused).toBe(true);
  await mediaAction(page, "play"); await mediaAction(page, "nexttrack");
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("psalms/24");
  await mediaAction(page, "previoustrack");
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("psalms/23");
  await mediaAction(page, "stop");
  expect((await audios(page)).every((a) => a.paused)).toBe(true);
});

test("rapid chapter changes discard out-of-order loads without duplicate narrators", async ({ page }) => {
  await continuitySetup(page);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/kjv/psalms/24.json", async (r) => { await gate; await r.fulfill({ json: { book: "Psalms", chapter: 24, verses: [{ verse: 1, text: "Late fixture" }] } }); });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await mediaAction(page, "nexttrack"); await mediaAction(page, "nexttrack");
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("john/3"); release();
  expect((await audios(page)).filter((a) => !a.paused)).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Return to current passage" })).toContainText("John 3");
});

test("rejected and externally paused media never report playing or restart on route changes", async ({ page }) => {
  await continuitySetup(page);
  await page.addInitScript(() => { const Audio = window.Audio; Audio.prototype.play = async () => { throw new Error("Suspended"); }; });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Tap Play");
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
  await routeTo(page, "/settings"); expect((await audios(page)).every((a) => a.paused)).toBe(true);
});

test("a rejected media start does not keep targeting the failed chapter after navigating to another one", async ({ page }) => {
  await continuitySetup(page);
  await page.addInitScript(() => {
    let calls = 0;
    window.Audio.prototype.play = function () {
      if (++calls === 1) return Promise.reject(new Error("NotAllowedError"));
      Object.defineProperty(this, "paused", { configurable: true, writable: true, value: false });
      return Promise.resolve();
    };
  });
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Tap Play to resume audio.");
  await routeTo(page, "/read/psalms/24");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect(page.getByRole("button", { name: "Return to current passage" })).toContainText("Psalms 24");
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("psalms/24");
  await expect.poll(async () => (await audios(page)).at(-1)?.paused).toBe(false);
  expect((await audios(page))[0].paused).toBe(true);
});

test("a rejected media start does not keep targeting the failed chapter when the rejection lands after navigating away", async ({ page }) => {
  await continuitySetup(page);
  await page.addInitScript(() => {
    let calls = 0;
    window.Audio.prototype.play = function () {
      if (++calls === 1) return new Promise<void>((_, reject) => { (window as unknown as { __rejectPlay: () => void }).__rejectPlay = () => reject(new Error("NotAllowedError")); });
      Object.defineProperty(this, "paused", { configurable: true, writable: true, value: false });
      return Promise.resolve();
    };
  });
  await page.goto("/read/psalms/23");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.waitForFunction(() => !!(window as unknown as { __rejectPlay?: () => void }).__rejectPlay);
  await routeTo(page, "/read/psalms/24");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.evaluate(() => (window as unknown as { __rejectPlay: () => void }).__rejectPlay());
  await expect(page.getByRole("status")).toContainText("Tap Play to resume audio.");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).at(-1)?.paused).toBe(false);
  expect((await audios(page)).at(-1)?.src).toContain("psalms/24");
});

test("Stop wins even when a pending media play promise resolves afterward", async ({ page }) => {
  await continuitySetup(page);
  await page.addInitScript(() => {
    window.Audio.prototype.play = function () {
      const audio = this;
      return new Promise<void>((resolve) => {
        (window as unknown as { __resolvePlay: () => void }).__resolvePlay = () => { Object.defineProperty(audio, "paused", { configurable: true, writable: true, value: false }); resolve(); };
      });
    };
  });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await page.getByRole("button", { name: "Stop audio playback", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __resolvePlay: () => void }).__resolvePlay());
  await expect.poll(async () => (await audios(page))[0].paused).toBe(true);
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("none");
});

test("an external media pause updates controls and never auto-resumes on return", async ({ page }) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  await page.evaluate(() => { const a = (window as unknown as { __audio: { paused: boolean; onpause(): void }[] }).__audio[0]; a.paused = true; a.onpause(); });
  await expect(page.getByRole("button", { name: "Resume audio playback" })).toBeVisible();
  await routeTo(page, "/settings");
  expect(await page.evaluate(() => navigator.mediaSession.playbackState)).toBe("paused");
  expect((await audios(page))[0].paused).toBe(true);
});

test("late rejection from an earlier play attempt cannot stop a newer resume", async ({ page }) => {
  await continuitySetup(page);
  await page.addInitScript(() => {
    let calls = 0;
    window.Audio.prototype.play = function () {
      if (++calls === 1) return new Promise<void>((_resolve, reject) => { (window as unknown as { __rejectPlay: () => void }).__rejectPlay = () => reject(new Error("Old attempt")); });
      Object.defineProperty(this, "paused", { configurable: true, writable: true, value: false });
      return Promise.resolve();
    };
  });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await page.getByRole("button", { name: "Pause audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Resume audio playback", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __rejectPlay: () => void }).__rejectPlay());
  await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe("playing");
  expect((await audios(page))[0].paused).toBe(false);
});

test("Pause during chapter loading retains the target without autoplay until Resume", async ({ page }) => {
  await continuitySetup(page);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/kjv/psalms/24.json", async (r) => { await gate; await r.fulfill({ json: { book: "Psalms", chapter: 24, verses: [{ verse: 1, text: "Paused chapter fixture" }] } }); });
  await page.goto("/read/psalms/23"); await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await mediaAction(page, "nexttrack"); await mediaAction(page, "pause"); release();
  await expect(page.getByRole("button", { name: "Return to current passage" })).toContainText("Psalms 24");
  await expect(page.getByRole("button", { name: "Resume audio playback", exact: true })).toBeVisible();
  expect((await audios(page)).every((a) => a.paused)).toBe(true);
  await mediaAction(page, "play");
  await expect.poll(async () => (await audios(page)).at(-1)?.src).toContain("psalms/24");
  await expect.poll(async () => (await audios(page)).at(-1)?.paused).toBe(false);
});

test("shared controls clear search and Ask composers without adding a glass layer", async ({ page }) => {
  await continuitySetup(page); await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  for (const [path, selector] of [["/search", ".srch__bar--dock"], ["/ask", ".composer2"]]) {
    await routeTo(page, path);
    const bar = page.getByRole("region", { name: "Bible audio player" }), composer = page.locator(selector);
    await expect(bar).toBeVisible(); await expect(composer).toBeVisible();
    await expect.poll(async () => { const a = await bar.boundingBox(), b = await composer.boundingBox(); return b!.y + b!.height <= a!.y; }).toBe(true);
    expect(await bar.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("audio settings are reachable from Settings without starting playback, and a choice there reaches the Bible reader", async ({ page }) => {
  await setup(page);
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [] } }));
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Audio settings" })).toBeVisible();
  expect((await audios(page)).length).toBe(0);
  await page.getByRole("button", { name: "Audio settings" }).click();
  await expect(page).toHaveURL(/\/settings\/audio/);
  expect((await audios(page)).length).toBe(0);
  // Choosing a voice and a speed here, while nothing is playing, must never start playback.
  await page.getByRole("button", { name: "Voice" }).click();
  await page.getByRole("dialog", { name: "Voice", exact: true }).getByRole("radio", { name: /Asteria/ }).click();
  await page.getByRole("button", { name: "Speed" }).click();
  await page.getByRole("dialog", { name: "Speed", exact: true }).getByRole("radio", { name: "1.5x", exact: true }).click();
  expect((await audios(page)).length).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("ttsVoice"))).toBe("ai:asteria");
  expect(await page.evaluate(() => localStorage.getItem("ttsRate"))).toBe("1.5");
  // The reader reads the very same shared preferences: no separate choice is needed there (CYB-123).
  await page.goto("/read/psalms/23");
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await expect.poll(async () => (await audios(page))[0].playbackRate).toBe(1.5);
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByRole("radio", { name: /Asteria/ })).toHaveAttribute("aria-checked", "true");
});

test("an unavailable saved voice shows an explicit fallback instead of silently switching, and keeps the preference until it's changed", async ({ page }) => {
  await setup(page);
  await page.route("**/api/recordings/catalog", (r) => r.fulfill({ json: { chapters: [] } }));
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "Ghost Voice"));
  await page.goto("/settings/audio");
  await expect(page.getByRole("status")).toContainText("no longer on this device");
  expect(await page.evaluate(() => localStorage.getItem("ttsVoice"))).toBe("Ghost Voice");
  expect((await audios(page)).length).toBe(0);
  await page.getByRole("button", { name: "Use the free generated voice", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("ttsVoice"))).toBe("ai:asteria");
  expect((await audios(page)).length).toBe(0);
});
