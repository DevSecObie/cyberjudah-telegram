#!/usr/bin/env node
/** Administrator-run only. Default is offline verification; --execute enables remote writes. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { CatalogSchema } from "../shared/resources.ts";
import { verifyArtifact } from "./bundle.mjs";

export function nextCatalog(current, incoming) {
  const entries = new Map(CatalogSchema.parse(current).resources.map((r) => [r.id, r]));
  for (const entry of CatalogSchema.parse(incoming).resources) entries.set(entry.id, entry);
  return CatalogSchema.parse({ schemaVersion: 1, revision: current.revision + 1, resources: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)) });
}
export async function publishArtifact({ output, bucket, api, execute = false, initData, upload, request = fetch }) {
  const inventory = JSON.parse(await readFile(path.join(output, "inventory.json"), "utf8"));
  const incoming = await verifyArtifact(output, inventory);
  if (!execute) return { verified: true, remoteWrites: 0, resources: incoming.resources, objects: inventory.objects.length };
  const origin = new URL(api);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("--api must be an HTTPS origin");
  if (!initData || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("An R2 bucket and RESOURCE_ADMIN_INIT_DATA are required");
  const url = new URL("/api/resources/catalog", origin).href;
  const prior = await request(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!prior.ok) throw new Error(`Catalog read failed (${prior.status})`);
  const current = CatalogSchema.parse(await prior.json()), etag = prior.headers.get("etag") ?? (current.revision === 0 ? "*" : null);
  if (!etag) throw new Error("Current catalog has no ETag");
  // Verified content-derived release paths cannot overwrite different approved bytes.
  for (const object of [...inventory.objects].sort((a, b) => Number(a.key.endsWith("manifest.json")) - Number(b.key.endsWith("manifest.json")))) await upload(bucket, object.key, path.join(output, object.file));
  const result = await request(url, { method: "PUT", headers: { authorization: `tma ${initData}`, "content-type": "application/json", "if-match": etag }, body: JSON.stringify(nextCatalog(current, incoming)) });
  if (!result.ok) throw new Error(`Catalog publication failed (${result.status}); the prior catalog remains authoritative. Reload and retry; do not overwrite the pointer directly.`);
  return { published: CatalogSchema.parse(await result.json()), remoteWrites: inventory.objects.length + 1 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  if (!value("--bundle")) throw new Error("Usage: node resources/publish.mjs --bundle ARTIFACT [--execute --bucket BUCKET --api https://app.example]");
  const result = await publishArtifact({
    output: path.resolve(value("--bundle")), bucket: value("--bucket"), api: value("--api"), execute: args.includes("--execute"), initData: process.env.RESOURCE_ADMIN_INIT_DATA,
    upload: async (bucket, key, file) => { execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", file.endsWith(".json") ? "application/json" : "application/x-ndjson", "--remote"], { stdio: ["ignore", "ignore", "inherit"] }); },
  });
  console.log(JSON.stringify(result, null, 2));
}
