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
    // The Bible (Bible Strong's reader, at /app/strong) is the Worker's, not this build's.
    if (pathname.startsWith("/strong")) { res.statusCode = 404; return res.end(); }
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

// The app's shell relaunches offline. (The Bible itself is Bible Strong's reader, which the
// service worker leaves to the network: /app/strong is outside the offline shell.)
for (const mount of ["/app", ""]) test(`production assets relaunch offline from ${mount || "the root alias"}`, async ({ page, context }) => {
  await page.route("https://telegram.org/**", r => r.abort());
  await page.route(/fonts\.g/, r => r.abort());
  await page.route(`${dataOrigin}/**`, r => r.fulfill({ status: 404, body: "" }));
  const url = `${origin}${mount}/settings`;
  await page.goto(url); await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(`${origin}${mount}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.unrouteAll({ behavior: "wait" });
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  expect(await reopened.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});
