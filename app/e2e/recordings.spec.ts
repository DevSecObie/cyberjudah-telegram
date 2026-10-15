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

test("an empty narration catalog never claims saved audio or offers an empty download", async ({ page }) => {
  await setup(page, false);
  await page.route("**/api/recordings/catalog", r => r.fulfill({ json: { chapters: [] } }));
  await page.route("**/api/kjv/books.json", r => r.fulfill({ json: [{ book: "Obadiah", slug: "obadiah", chapters: 1, chapterIds: [1], testament: "old" }] }));
  await page.route("**/api/kjv/obadiah/1.json", r => r.fulfill({ json: { book: "Obadiah", chapter: 1, verses: [{ verse: 1, text: "Test verse" }] } }));
  await page.goto("/settings#tgWebAppData=auth_date%3D1&tgWebAppPlatform=ios");
  // A previously fetched, empty chapter catalog caused the false badge. Seed it before
  // saving so the real saved-books refresh reads it, including in ephemeral WebKit contexts.
  await page.evaluate(async () => {
    const cache = await caches.open("cj-offline-v1");
    await cache.put(`${location.origin}/api/recordings/obadiah/1`, new Response(JSON.stringify({ narrators: [] })));
  });
  await page.getByRole("button", { name: "Save a book", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Obadiah/ }).click();
  const row = page.getByRole("button", { name: /Obadiah.*saved on this device/i });
  await expect(row).toContainText("narration not saved");
  await expect(row.locator(".pill--ok")).toHaveText("text");
  await row.click();
  const sheet = page.getByRole("dialog", { name: "Obadiah" });
  await expect(sheet.getByRole("button", { name: /Download narration|Finish downloading narration/ })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Remove text and narration" })).toBeVisible();
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

test("audio settings are reachable from Settings without starting playback", async ({ page }) => {
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

// The credits page names the ambient sounds' sources and licences.
test("credits list the ambient sounds' sources and licences", async ({ page }) => {
  await setup(page);
  await page.goto("/settings/credits");
  for (const id of ["640655", "528944", "578524", "650574"]) {
    await expect(page.locator(`a[href$="/sounds/${id}/"]`)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "CC0 1.0", exact: true })).toHaveCount(8);
});
