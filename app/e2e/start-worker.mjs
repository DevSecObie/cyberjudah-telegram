import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Only Playwright's local webServer invokes this. Keep all fixture overrides in ignored
// files: the deployed Wrangler configuration must continue to fail closed.
if (process.env.PLAYWRIGHT_BASE_URL) throw new Error("Cannot start local fixtures for a live suite");
const bot = fileURLToPath(new URL("../../bot/", import.meta.url));
const state = `${bot}.wrangler/e2e`;
const configs = `${bot}.wrangler/e2e-config`;
const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync(`${bot}wrangler.jsonc`, "utf8"));
if (parsed.error) throw new Error("Cannot parse the Worker's Wrangler configuration");
const source = parsed.config;
const vars = Object.fromEntries(JSON.parse(process.env.E2E_WORKER_VARS).map(value => {
  const colon = value.indexOf(":");
  if (colon < 1) throw new Error("Invalid local Worker variable");
  return [value.slice(0, colon), value.slice(colon + 1)];
}));
rmSync(state, { recursive: true, force: true });
mkdirSync(configs, { recursive: true });
const primary = {
  ...source,
  main: `${bot}src/worker.ts`,
  assets: { ...source.assets, directory: fileURLToPath(new URL("../../.deploy/", import.meta.url)) },
  env: undefined,
  routes: [],
  vars: { ...source.vars, ...vars, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8089",
    TELEGRAM_ACCOUNT_DELETION_READY: "true", PUBLICATION_STORE_ID: "production" },
  services: [{ binding: "PUBLICATION_ERASURE_PEER", service: "e2e-publication-peer", entrypoint: "PublicationErasure" }],
};
// Use the actual RPC entrypoint against an independent database and privacy key, not a
// stub that returns successful receipts. No public test-only HTTP deletion route exists.
const peer = {
  name: "e2e-publication-peer",
  main: `${bot}src/publication-erasure-rpc.ts`,
  compatibility_date: source.compatibility_date,
  compatibility_flags: source.compatibility_flags,
  d1_databases: [{ binding: "DB", database_name: "e2e-publication-peer", database_id: "22222222-2222-2222-2222-222222222222" }],
  vars: { PUBLICATION_STORE_ID: "staging", PRIVACY_KEY: "e2e-peer-privacy-key-not-secret" },
};
for (const [name, config] of Object.entries({ primary, peer })) {
  writeFileSync(`${configs}/${name}.json`, JSON.stringify(config), { mode: 0o600 });
}
const worker = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
  "dev", "--config", `${configs}/primary.json`, "--config", `${configs}/peer.json`,
  "--local", "--ip", "127.0.0.1", "--port", "8787", "--persist-to", state, "--test-scheduled"],
{ cwd: bot, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => worker.kill(signal));
worker.on("error", error => { console.error(error); process.exitCode = 1; });
worker.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
