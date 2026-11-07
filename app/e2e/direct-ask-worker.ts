import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { unstable_DevEnv, unstable_getMiniflareWorkerOptions } from "wrangler";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { STAND_IN } from "./stand-ins";
import { loopbackRequestOptions } from "./direct-relay.mjs";

/**
 * Wrangler 4.156's dev ProxyWorker uses compatibility date 2023-12-18 without
 * enable_request_signal and detaches its upstream fetch. It hides a browser disconnect from
 * the real Worker. Test this path on workerd's direct socket, with the real bundle and config.
 * All storage is isolated and ephemeral; inference is the existing local Claude stand-in.
 */
export async function directAskWorker() {
  const config = fileURLToPath(new URL("../../bot/wrangler.jsonc", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "cj-ask-disconnect-"));
  const dev = new unstable_DevEnv();
  const built = new Promise<{ path: string; modules: unknown[] }>(resolve => {
    dev.once("reloadComplete", event => resolve(event.bundle));
  });
  let runtime: Miniflare | undefined;
  let relay: Server | undefined;
  try {
    // Use Wrangler's own bundler and Node compatibility shims, not a replacement Worker.
    const worker = await dev.startWorker({ config, dev: { remote: false, persist: false, server: { port: 0 } } });
    await worker.ready;
    const bundle = await built;
    if (bundle.modules.length) throw new Error("Direct Ask fixture must copy additional Worker modules");
    const scriptPath = join(dir, "worker.mjs");
    copyFileSync(bundle.path, scriptPath);
    await worker.dispose();
    const { workerOptions, externalWorkers } = unstable_getMiniflareWorkerOptions(config);
    const flags = Array.isArray(workerOptions.compatibilityFlags) ? workerOptions.compatibilityFlags as string[] : [];
    const options = {
      ...workerOptions, name: "ask-disconnect", modules: true, modulesRoot: dir, modulesRules: undefined, scriptPath,
      // Explicit test-only mutation, used to prove the browser assertion fails without the flag.
      compatibilityFlags: process.env.E2E_DISABLE_REQUEST_SIGNAL === "1"
        ? flags.filter(flag => flag !== "enable_request_signal") : flags,
      unsafeDirectSockets: [{ host: "127.0.0.1", port: 0 }],
      // No remote inference/index access in this fixture.
      ai: undefined, vectorize: undefined,
      bindings: { ...workerOptions.bindings as Record<string, unknown>, BOT_TOKEN: process.env.BOT_TOKEN!, ADMIN_IDS: "100000002",
        ANTHROPIC_API_KEY: "e2e-not-a-real-key", ANTHROPIC_BASE_URL: `${STAND_IN}/anthropic`,
        ASK_BILLING: "on", E2E_CLOCK: "on", PRIVACY_KEY: "e2e-privacy-key-not-secret" },
    };
    runtime = new Miniflare(convertV4MiniflareOptions({ workers: [options, ...externalWorkers], port: 0 }));
    const target = (await runtime.unsafeGetDirectURL("ask-disconnect"))!;
    // workerd may not notice a gentle HTTP close before response headers exist. Relay the
    // browser's actual disconnect as a TCP reset, including the JSON path with no response yet.
    // See https://github.com/cloudflare/workerd/issues/6832 (client teardown notes).
    relay = createServer((req, res) => {
      const upstream = httpRequest(loopbackRequestOptions(target, req), reply => {
        res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
      });
      upstream.on("error", () => res.destroy());
      res.on("close", () => { if (!res.writableEnded) upstream.socket?.resetAndDestroy(); });
      req.pipe(upstream);
    });
    await new Promise<void>(resolve => relay!.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
    const closeRelay = async () => {
      relay!.closeAllConnections();
      await new Promise<void>((resolve, reject) => relay!.close(error => error ? reject(error) : resolve()));
    };
    return { url, async dispose() { await closeRelay(); await runtime!.dispose(); rmSync(dir, { recursive: true, force: true }); } };
  } catch (error) {
    relay?.closeAllConnections(); relay?.close();
    await runtime?.dispose(); await dev.teardown(); rmSync(dir, { recursive: true, force: true }); throw error;
  }
}
