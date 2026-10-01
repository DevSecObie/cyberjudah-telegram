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
    Object.defineProperty(window, "speechSynthesis", { value: { getVoices: () => [{ name: "Test device", lang: "en-GB" }], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() {}, pause() {}, resume() {} } });
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
test("human narrator seeks in one chapter audio element and follows verse timings", async ({ page }) => {
  await setup(page); await openPanel(page);
  const sheet = page.getByRole("dialog", { name: "Voice", exact: true });
  await expect(sheet.getByRole("heading", { name: "Narrators", exact: true })).toBeVisible();
  await sheet.getByRole("radio", { name: /Test human narrator/ }).click();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await expect.poll(async () => (await audios(page)).length).toBe(1);
  await expect(page.getByRole("button", { name: "Pitch 1x" })).toBeDisabled();
  await tick(page, 21);
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
  await page.screenshot({ animations: "disabled", path: "/private/tmp/cj-human-audio/narrator-panel-390x780.png" });
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: "/private/tmp/cj-human-audio/narrator-sheet-390x780.png" });
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
