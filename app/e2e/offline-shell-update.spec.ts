import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import http from "node:http";

test.use({ serviceWorkers: "allow" });

test("an activated shell update deletes old shells and preserves saved books", async ({ page }) => {
  const template = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const oldRevision = "a".repeat(64), newRevision = "b".repeat(64);
  let revision = oldRevision;
  // Serve the real worker twice with different build revisions. No skipWaiting:
  // the old shell must survive until its reader leaves the worker's scope.
  const server = http.createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    if (req.url === "/app/sw.js") {
      res.setHeader("content-type", "application/javascript");
      return res.end(template.replace("__CJ_SHELL_REVISION__", revision).replace("__CJ_ASSET_BASE__", "/app/"));
    }
    if (req.url === "/app/offline-shell.json") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ revision, base: "/app/", paths: ["index.html"] }));
    }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Shell ${revision}</title>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await page.goto(`${origin}/app/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toEqual([`cj-shell-${oldRevision}`]);
    await page.evaluate(async () => {
      await (await caches.open("cj-offline-v1")).put("/saved-chapter", new Response("saved chapter"));
      await caches.open("unrelated-cache");
      await caches.open("cj-shell-abandoned-install");
    });

    revision = newRevision;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe("installed");
    const waitingCaches = await page.evaluate(() => caches.keys());
    expect(waitingCaches).toContain(`cj-shell-${oldRevision}`);
    expect(waitingCaches).toContain(`cj-shell-${newRevision}`);

    // Leaving the scope releases the last old client and lets the new worker activate.
    await page.goto(`${origin}/inspect`);
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/app/");
      return registration?.active?.state === "activated" && !registration.waiting;
    })).toBe(true);
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual([
      "cj-offline-v1", `cj-shell-${newRevision}`, "unrelated-cache",
    ].sort());
    expect(await page.evaluate(async (name) => (await (await caches.open(name)).match("/app/index.html"))?.text(), `cj-shell-${newRevision}`)).toContain(newRevision);
    expect(await page.evaluate(async () => (await (await caches.open("cj-offline-v1")).match("/saved-chapter"))?.text())).toBe("saved chapter");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
