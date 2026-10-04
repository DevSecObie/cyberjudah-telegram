import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const book = { book: "Obadiah", slug: "obadiah", chapters: 1, verses: 1, testament: "Old Testament", url: "/bible/obadiah", chapterIds: [1] };
// Exact KJV verse text, also used to assert that legacy bytes survive shell installation.
const chapter = { book: "Obadiah", chapter: 1, translation: "KJV", url: "/bible/obadiah/1", verses: [{ verse: 1, text: "The vision of Obadiah. Thus saith the Lord GOD concerning Edom; We have heard a rumour from the LORD, and an ambassador is sent among the heathen, Arise ye, and let us rise up against her in battle." }] };
type Harness = typeof import("../src/resources/storage");
declare global { interface Window { __resources: Harness } }
async function setup(page: Page) {
  const mock = await readFile(new URL("./telegram-mock.js", import.meta.url), "utf8");
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: mock }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  await page.route(`${DATA_ORIGIN}/**`, (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({ json: path === "/api/kjv/books.json" ? [book] : path === "/api/kjv/obadiah/1.json" ? chapter : {} });
  });
  await page.goto("/read/obadiah/1");
  await expect(page.locator("#verset-1")).toContainText("The vision of Obadiah");
}
async function harness(page: Page) {
  const output = await build({ stdin: { contents: `import * as api from ${JSON.stringify(fileURLToPath(new URL("../src/resources/storage.ts", import.meta.url)))}; window.__resources=api;`, resolveDir: fileURLToPath(new URL("..", import.meta.url)) }, bundle: true, write: false, format: "iife", platform: "browser", tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
  await page.addScriptTag({ content: output.outputFiles[0].text });
}
function fixture(release: string, value: string) {
  const part = JSON.stringify({ key: "entry", data: { text: value } }) + "\n";
  const manifest = JSON.stringify({ schemaVersion: 1, id: "test-resource", release, kind: "reference", title: "Local test fixture", language: "en", source: [{ url: "https://example.invalid/local-fixture", revision: "test", sha256: hash(part) }], license: [{ id: "public-domain", url: "https://example.invalid/local-fixture", attribution: "Synthetic test data only", modifications: "" }], approval: { reference: "https://example.invalid/local-fixture", approvedBy: "Local test only" }, parts: [{ path: "entries.ndjson", sha256: hash(part), bytes: Buffer.byteLength(part), records: 1 }] });
  return { part, manifest, catalog: { schemaVersion: 1 as const, revision: release === "v1" ? 1 : 2, resources: [{ id: "test-resource", release, manifestSha256: hash(manifest) }] } };
}
test("resource activation survives reload, failed updates, rollback and independent deactivation", async ({ page }) => {
  await setup(page); await harness(page);
  const a = fixture("v1", "original fixture"), b = fixture("v2", "updated fixture");
  let corrupt = false;
  await page.route("**/api/resources/test-resource/**", (r) => {
    const f = r.request().url().includes("/v1/") ? a : b;
    return r.fulfill({ body: r.request().url().endsWith("manifest.json") ? f.manifest : corrupt ? "damaged" : f.part, contentType: "application/json" });
  });
  await page.evaluate((c) => window.__resources.installResource(c, "test-resource"), a.catalog);
  expect(await page.evaluate(() => window.__resources.readResource("test-resource", "entry"))).toEqual({ release: "v1", data: { text: "original fixture" } });
  corrupt = true;
  expect(await page.evaluate(async (c) => { try { await window.__resources.installResource(c, "test-resource"); return false; } catch { return true; } }, b.catalog)).toBe(true);
  expect((await page.evaluate(() => window.__resources.readResource("test-resource", "entry")))?.release).toBe("v1");
  corrupt = false;
  await page.evaluate((c) => window.__resources.installResource(c, "test-resource"), b.catalog);
  await page.reload(); await harness(page);
  expect((await page.evaluate(() => window.__resources.readResource("test-resource", "entry")))?.release).toBe("v2");
  await page.evaluate(() => window.__resources.rollbackResource("test-resource"));
  expect((await page.evaluate(() => window.__resources.readResource("test-resource", "entry")))?.release).toBe("v1");
  await page.evaluate(() => window.__resources.deactivateResource("test-resource"));
  expect(await page.evaluate(() => window.__resources.readResource("test-resource", "entry"))).toBe(null);
  await expect(page.locator("#verset-1")).toContainText("The vision of Obadiah");
});

test("an in-flight installation cannot resurrect a resource after deactivation", async ({ page }) => {
  await setup(page); await harness(page);
  const a = fixture("v1", "original fixture"), b = fixture("v2", "updated fixture");
  let releaseDownload: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { releaseDownload = resolve; });
  await page.route("**/api/resources/test-resource/**", async (r) => {
    const url = r.request().url(), f = url.includes("/v1/") ? a : b;
    if (url.endsWith("/v2/entries.ndjson")) await blocked;
    await r.fulfill({ body: url.endsWith("manifest.json") ? f.manifest : f.part });
  });
  await page.evaluate((c) => window.__resources.installResource(c, "test-resource"), a.catalog);
  const waiting = page.waitForRequest("**/v2/entries.ndjson");
  const install = page.evaluate(async (c) => { try { await window.__resources.installResource(c, "test-resource"); return "activated"; } catch (e) { return String(e); } }, b.catalog);
  await waiting;
  await page.evaluate(() => window.__resources.deactivateResource("test-resource"));
  releaseDownload!();
  expect(await install).toContain("superseded");
  expect(await page.evaluate(() => window.__resources.readResource("test-resource", "entry"))).toBe(null);
});

test("production shell relaunches offline and preserves a legacy downloaded chapter", async ({ page, context }) => {
  // Seed the actual old cache layout before application startup to exercise migration.
  await setup(page);
  await page.evaluate(async ({ origin, chapter, book }) => {
    const c = await caches.open("cj-offline-v1");
    await c.put(`${location.origin}/__offline/books`, new Response(JSON.stringify([book.slug])));
    await c.put(`${origin}/api/kjv/obadiah/1.json`, new Response(JSON.stringify(chapter)));
  }, { origin: DATA_ORIGIN, chapter, book });
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async (origin) => !!await (await caches.open("cj-offline-v1")).match(`${origin}/api/kjv/books.json`), DATA_ORIGIN)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(async () => (await caches.keys()).some((k) => k.startsWith("cj-shell-")))).toBe(true);
  // Route fulfillment can succeed even with context.setOffline: remove stand-ins
  // so the relaunch proves that saved bytes, without Telegram's SDK, are sufficient.
  await page.unrouteAll({ behavior: "wait" });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#verset-1")).toContainText("The vision of Obadiah");
  expect(await page.evaluate(async (origin) => (await (await (await caches.open("cj-offline-v1")).match(`${origin}/api/kjv/obadiah/1.json`))!.json()).verses[0].text, DATA_ORIGIN)).toBe(chapter.verses[0].text);
  expect(await page.evaluate(async () => (await caches.open("cj-offline-v1")).match(`${location.origin}/api/me`).then(Boolean))).toBe(false);
});
