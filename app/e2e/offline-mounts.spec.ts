import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

test.use({ serviceWorkers: "allow" });
const dataOrigin = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const app = fileURLToPath(new URL("..", import.meta.url));
let server: http.Server, origin: string;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const output = await mkdtemp(path.join(tmpdir(), "cj-offline-mounts-"));
  // The normal suite builds /. Exercise the actual production /app/ asset URLs too.
  execFileSync(process.execPath, [fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url)), "build", "--base", "/app/", "--outDir", output], { cwd: app, stdio: "pipe" });
  server = http.createServer(async (req, res) => {
    // Like prepare-assets: the same build is reachable at / and /app/.
    const pathname = new URL(req.url!, "http://localhost").pathname.replace(/^\/app\//, "/");
    let file = path.join(output, pathname);
    try { if (!(await stat(file)).isFile()) throw new Error("SPA route"); }
    catch { file = path.join(output, "index.html"); }
    res.setHeader("content-type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html");
    res.end(await readFile(file));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });

for (const mount of ["/app", ""]) test(`production assets relaunch offline from ${mount || "the root alias"}`, async ({ page, context }) => {
  const books = JSON.parse(await readFile(new URL("../../bot/tests/fixtures/bs/api/kjv/books.json", import.meta.url), "utf8"));
  const chapter = JSON.parse(await readFile(new URL("../../bot/tests/fixtures/bs/api/kjv/genesis/1.json", import.meta.url), "utf8"));
  await page.route("https://telegram.org/**", r => r.abort());
  await page.route(/fonts\.g/, r => r.abort());
  await page.route(`${dataOrigin}/**`, r => {
    const p = new URL(r.request().url()).pathname;
    return p === "/api/kjv/books.json" ? r.fulfill({ json: books }) : p === "/api/kjv/genesis/1.json" ? r.fulfill({ json: chapter }) : r.fulfill({ status: 404, body: "" });
  });
  const url = `${origin}${mount}/read/genesis/1`;
  await page.goto(url); await expect(page.locator("#verset-1")).toBeVisible();
  await page.evaluate(async ({ books, chapter, dataOrigin }) => {
    const cache = await caches.open("cj-offline-v1");
    await cache.put(`${dataOrigin}/api/kjv/books.json`, new Response(JSON.stringify(books)));
    await cache.put(`${dataOrigin}/api/kjv/genesis/1.json`, new Response(JSON.stringify(chapter)));
  }, { books, chapter, dataOrigin });
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(`${origin}${mount}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.unrouteAll({ behavior: "wait" });
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.locator("#verset-1")).toContainText(chapter.verses[0].text);
  expect(await reopened.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});
