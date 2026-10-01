import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
async function setup(page: Page, fail = false) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route("**/api/voices", (r) => r.fulfill({ json: { voices: [] } }));
  await page.route("**/api/recordings/**", (r) => r.fulfill({ json: { narrators: [] } }));
  await page.route("**/api/audio/ambient/**", (r) => r.fulfill({ status: fail ? 503 : 200, contentType: "audio/mp4", body: "stub" }));
  await page.addInitScript(() => {
    const state = { starts: 0, stops: 0, resumes: 0, suspends: 0, ramps: [] as [number, number][], loops: [] as boolean[], voices: 0, finish: () => {} };
    class AudioContext {
      currentTime = 0; destination = {};
      async resume() { state.resumes++; }
      async suspend() { state.suspends++; }
      async decodeAudioData() { return {}; }
      createGain() { return { connect() {}, gain: { value: 0, cancelAndHoldAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime(value: number, time: number) { state.ramps.push([value, time]); } } }; }
      createBufferSource() { return { buffer: null, loop: false, connect() {}, disconnect() {}, start() { state.starts++; state.loops.push(this.loop); }, stop() { state.stops++; } }; }
    }
    Object.defineProperty(window, "AudioContext", { value: AudioContext });
    // Use a plain utterance alongside the fake voices; native Web Speech setters
    // reject objects that are not browser-created SpeechSynthesisVoice instances.
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class {
      constructor(public text: string) {}
      onstart?: () => void; onend?: () => void;
    } });
    Object.defineProperty(window, "speechSynthesis", { value: {
      getVoices: () => [{ name: "Test device", lang: "en-GB" }], addEventListener() {}, removeEventListener() {},
      speak(u: SpeechSynthesisUtterance) { state.voices++; u.onstart?.({} as SpeechSynthesisEvent); state.finish = () => u.onend?.({} as SpeechSynthesisEvent); }, cancel() {}, pause() {}, resume() {},
    } });
    (window as unknown as { __music: unknown }).__music = state;
  });
}
const state = (page: Page) => page.evaluate(() => (window as unknown as { __music: { starts: number; stops: number; resumes: number; suspends: number; voices: number; ramps: [number, number][]; loops: boolean[] } }).__music);
async function panel(page: Page) {
  await page.goto("/read/psalms/23");
  await expect(page.locator("#verset-1")).toBeVisible();
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Ambient", exact: true }).click();
  await page.getByRole("tab", { name: "Music", exact: true }).click();
}
test("ambient selection, independent volume and previews persist without autoplay", async ({ page }, testInfo) => {
  await setup(page); await panel(page);
  const sheet = page.getByRole("dialog", { name: "Ambient", exact: true });
  await expect(sheet.getByRole("radio", { name: "Off", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("slider", { name: /Ambient volume/ })).toHaveValue("25");
  await sheet.getByRole("radio", { name: "Warm keys", exact: true }).click();
  await expect.poll(async () => (await state(page)).starts).toBe(1);
  expect((await state(page)).loops).toEqual([true]);
  expect((await state(page)).ramps.some(([gain, seconds]) => gain === .25 && seconds === 1.5)).toBe(true);
  await page.evaluate(() => (window as unknown as { __music: { finish(): void } }).__music.finish());
  await expect.poll(async () => (await state(page)).ramps.some(([gain]) => Math.abs(gain - .18) < .001)).toBe(true);
  await sheet.getByRole("slider", { name: /Ambient volume/ }).fill("40");
  expect(await page.evaluate(() => localStorage.getItem("ambientVolume"))).toBe("0.4");
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("ambient-sheet-390x780.png") });
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("ambient-panel-390x780.png") });
  await page.getByRole("button", { name: "Stop audio playback", exact: true }).click();
  expect((await state(page)).ramps.at(-1)).toEqual([0, 1]);
  await expect.poll(async () => (await state(page)).stops).toBe(1);
  await page.reload(); await expect(page.locator("#verset-1")).toBeVisible();
  expect((await state(page)).starts).toBe(0);
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Ambient", exact: true }).click();
  await expect(sheet.getByRole("radio", { name: "Warm keys", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("slider", { name: /Ambient volume/ })).toHaveValue("40");
  await sheet.getByRole("button", { name: "Preview Soft piano", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Stop preview Soft piano", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ambientTrack"))).toBe("soft-keys");
});
test("failed ambient track leaves the reading running", async ({ page }) => {
  await setup(page, true); await panel(page);
  await page.getByRole("dialog", { name: "Ambient", exact: true }).getByRole("radio", { name: "Soft piano", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ambient sound is unavailable");
  await expect(page.getByRole("button", { name: "Ambient unavailable", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Ambient", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop audio playback", exact: true })).toBeVisible();
  const before = (await state(page)).voices;
  await page.evaluate(() => (window as unknown as { __music: { finish(): void } }).__music.finish());
  await expect.poll(async () => (await state(page)).voices).toBeGreaterThan(before);
});
test("nature sounds preview independently, save the selected element and can be switched off", async ({ page }, testInfo) => {
  await setup(page); await panel(page);
  const sheet = page.getByRole("dialog", { name: "Ambient", exact: true });
  await sheet.getByRole("tab", { name: "Nature", exact: true }).click();
  await sheet.getByRole("button", { name: "Preview Rain", exact: true }).click();
  await expect.poll(async () => (await state(page)).starts).toBe(1);
  await expect(sheet.getByRole("radio", { name: "Off", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => localStorage.getItem("ambientTrack"))).toBeNull();
  for (const [id, name] of [["rain", "Rain"], ["wind", "Wind"], ["ocean", "Ocean waves"], ["fire", "Gentle fire"]]) {
    await sheet.getByRole("radio", { name, exact: true }).click();
    await expect(sheet.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("ambientTrack"))).toBe(id);
  }
  await expect.poll(async () => (await state(page)).starts).toBe(4);
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("ambient-nature-390x780.png") });
  await page.reload(); await expect(page.locator("#verset-1")).toBeVisible();
  expect((await state(page)).starts).toBe(0);
  await page.getByRole("button", { name: "Start audio playback", exact: true }).click();
  await page.getByRole("button", { name: "Ambient", exact: true }).click();
  await expect(sheet.getByRole("tab", { name: "Nature", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("radio", { name: "Gentle fire", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await state(page)).starts).toBe(1);
  await sheet.getByRole("radio", { name: "Off", exact: true }).click();
  await expect.poll(async () => (await state(page)).stops).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("ambientTrack"))).toBe("off");
  await page.goto("/settings/credits");
  for (const id of ["640655", "528944", "578524", "650574"]) {
    await expect(page.locator(`a[href$="/sounds/${id}/"]`)).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "CC0 1.0", exact: true })).toHaveCount(8);
});
test("music carries across chapters and pauses in the background until a tap", async ({ page }) => {
  await setup(page); await page.addInitScript(() => localStorage.setItem("ambientTrack", "soft-keys"));
  await panel(page);
  await page.getByRole("dialog", { name: "Ambient", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(async () => (await state(page)).starts).toBe(1);
  await page.locator(".bs-audio").getByRole("button", { name: "Next chapter", exact: true }).click();
  await expect(page).toHaveURL(/\/psalms\/24/);
  await expect(page.locator("#verset-1")).toContainText("earth");
  await expect(page.getByRole("button", { name: "Stop audio playback", exact: true })).toBeVisible();
  expect((await state(page)).starts).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(async () => (await state(page)).suspends).toBeGreaterThan(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  expect((await state(page)).starts).toBe(1);
  await page.getByRole("button", { name: "Resume audio playback", exact: true }).click();
  await expect.poll(async () => (await state(page)).starts).toBe(2);
  await page.evaluate(() => { history.pushState({}, "", "/settings"); dispatchEvent(new PopStateEvent("popstate")); });
  await expect.poll(async () => (await state(page)).ramps.at(-1)).toEqual([0, 1]);
});

for (const voice of ["ai:asteria", "narrator:test-reader"]) {
  test(`music stays underneath ${voice} while seeking verses`, async ({ page }) => {
    await setup(page);
    await page.route("**/api/recordings/**", (r) => r.fulfill({ json: { narrators: [{
      id: "test-reader", reader: "Test reader", audio: "/api/audio/recordings/test-reader/psalms/23.m4a",
      source: "https://librivox.org/", license: "https://librivox.org/pages/public-domain/",
      verses: Array.from({ length: 6 }, (_, i) => [i + 1, i * 10, i * 10 + 9]),
    }] } }));
    await page.route("**/api/tts/**", (r) => r.fulfill({ body: "stub", contentType: "audio/mpeg" }));
    await page.addInitScript((voice) => {
      localStorage.setItem("ttsVoice", voice); localStorage.setItem("ambientTrack", "soft-keys");
      Object.defineProperty(window, "Audio", { value: class {
        currentTime = 0; playbackRate = 1;
        async play() {} pause() {} removeAttribute() {}
      } });
    }, voice);
    await panel(page);
    await page.getByRole("dialog", { name: "Ambient", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator("#verset-1")).toHaveAttribute("data-reading", "");
    await expect.poll(async () => (await state(page)).starts).toBe(1);
    await expect.poll(async () => (await state(page)).ramps.some(([gain]) => Math.abs(gain - .18) < .001)).toBe(true);
    await page.getByRole("button", { name: "Next verse", exact: true }).click();
    await expect(page.locator("#verset-2")).toHaveAttribute("data-reading", "");
    expect((await state(page)).starts).toBe(1);
  });
}
