import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../../src/index.ts";
import { signInitData } from "../../src/initdata.mjs";
import { CatalogSchema, ManifestSchema, TimelineSchema, parseShard, sha256 } from "../../../shared/resources.ts";
import { readResourceRecord } from "../../src/resources.ts";
import type { Env } from "../../src/env.ts";

/** Conditional writes emulate R2's ETag contract; requests still run the real Worker/auth. */
function bucket() {
  const files = new Map<string, Uint8Array>();
  const obj = async (key: string) => {
    const data = files.get(key); if (!data) return null;
    const etag = await sha256(data);
    return { key, size: data.length, etag, httpEtag: `"${etag}"`, body: new Response(data).body, arrayBuffer: async () => data.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(data)) };
  };
  return { files, get: obj, async put(key: string, input: string | Uint8Array, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    const before = await obj(key), condition = options?.onlyIf;
    if (condition?.etagDoesNotMatch === "*" && before || condition?.etagMatches && before?.etag !== condition.etagMatches) return null;
    files.set(key, typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input)); return obj(key);
  } };
}
const fixture = async (release = "v1", value = "local fixture") => {
  const bytes = new TextEncoder().encode(JSON.stringify({ key: "entry", data: { text: value } }) + "\n");
  const manifest = ManifestSchema.parse({ schemaVersion: 1, id: "test-resource", release, kind: "reference", title: "Local test fixture", language: "en", source: [{ url: "https://example.invalid/local-fixture", revision: "test", sha256: await sha256(bytes) }], license: [{ id: "public-domain", url: "https://example.invalid/local-fixture", attribution: "Synthetic test data only", modifications: "" }], approval: { reference: "https://example.invalid/local-fixture", approvedBy: "Local test only" }, parts: [{ path: "entries.ndjson", sha256: await sha256(bytes), bytes: bytes.length, records: 1 }] });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  return { bytes, manifest, manifestBytes, entry: { id: manifest.id, release, manifestSha256: await sha256(manifestBytes) } };
};
const setup = () => { const store = bucket(); return { store, env: { AUDIO: store, BOT_TOKEN: "phase1-test-token", ADMIN_IDS: "42" } as unknown as Env }; };
async function request(env: Env, path: string, options: RequestInit = {}, user?: number) {
  const headers = new Headers(options.headers);
  if (user) headers.set("authorization", `tma ${await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: user, first_name: "Test" } }, env.BOT_TOKEN)}`);
  return worker.fetch(new Request(`https://worker.invalid/api/resources/${path}`, { ...options, headers }), env);
}
async function seed(store: ReturnType<typeof bucket>, f: Awaited<ReturnType<typeof fixture>>) {
  await store.put(`resources/test-resource/${f.manifest.release}/manifest.json`, f.manifestBytes);
  await store.put(`resources/test-resource/${f.manifest.release}/entries.ndjson`, f.bytes);
}
const publish = (env: Env, revision: number, entries: unknown[], etag = "*", user = 42) => request(env, "catalog", { method: "PUT", headers: { "if-match": etag }, body: JSON.stringify({ schemaVersion: 1, revision, resources: entries }) }, user);

test("public catalog reads; signed reader cannot publish; admin needs no GitHub token", async () => {
  const { env, store } = setup(), f = await fixture(); await seed(store, f);
  assert.equal((await request(env, "catalog")).status, 200);
  assert.equal((await request(env, "catalog", { method: "PUT", body: "{}" })).status, 401);
  assert.equal((await publish(env, 1, [f.entry], "*", 7)).status, 403);
  const response = await publish(env, 1, [f.entry]); assert.equal(response.status, 200);
  assert.equal((await request(env, "catalog", { headers: { "if-none-match": response.headers.get("etag")! } })).status, 304);
  assert.equal((await publish(env, 2, [f.entry])).status, 409);
});
test("a damaged release cannot replace a readable published release", async () => {
  const { env, store } = setup(), f = await fixture(); await seed(store, f);
  const initial = await publish(env, 1, [f.entry]);
  const next = await fixture("v2", "updated fixture"); await seed(store, next);
  store.files.set("resources/test-resource/v2/entries.ndjson", new TextEncoder().encode("broken"));
  assert.equal((await publish(env, 2, [next.entry], initial.headers.get("etag")!)).status, 400);
  assert.deepEqual(await readResourceRecord(env, "test-resource", "entry"), { release: "v1", data: { text: "local fixture" } });
});
test("HTTP downloads and server resource reads share the pinned approved release after updates", async () => {
  const { env, store } = setup(), a = await fixture(); await seed(store, a);
  const first = await publish(env, 1, [a.entry]);
  const b = await fixture("v2", "updated fixture"); await seed(store, b);
  assert.equal((await publish(env, 2, [b.entry], first.headers.get("etag")!)).status, 200);
  const response = await request(env, "test-resource/v1/entries.ndjson"); assert.equal(response.status, 200);
  const row = JSON.parse(await response.text());
  assert.deepEqual((await readResourceRecord(env, "test-resource", "entry", "v1"))?.data, row.data);
  assert.equal((await readResourceRecord(env, "test-resource", "entry"))?.release, "v2");
  assert.equal((await request(env, "test-resource/v3/entries.ndjson")).status, 404);
});
test("contracts reject traversal, duplicate catalog identities, damaged shards and unapproved text versions", async () => {
  const f = await fixture();
  assert.equal(ManifestSchema.safeParse({ ...f.manifest, id: "../audio" }).success, false);
  assert.equal(ManifestSchema.safeParse({ ...f.manifest, kind: "bible", text: "WEB" }).success, false);
  assert.equal(CatalogSchema.safeParse({ schemaVersion: 1, revision: 1, resources: [f.entry, f.entry] }).success, false);
  await assert.rejects(parseShard(new TextEncoder().encode("wrong"), f.manifest.parts[0], f.manifest.kind));
  assert.deepEqual(await parseShard(f.bytes, f.manifest.parts[0], "reference"), [{ key: "entry", data: { text: "local fixture" } }]);
});
test("Between the Testaments source-calendar proposal is preserved without manufactured absolute dates", async () => {
  const sample = JSON.parse(await readFile(new URL("../../../docs/proposals/apocrypha/timeline.json", import.meta.url), "utf8"));
  assert.deepEqual(TimelineSchema.parse(sample), sample);
});
test("existing Timeline sections, period metadata and Final Captivity records retain every field", async () => {
  for (const path of ["app/src/data/timeline.json", "app/src/data/final-captivity.json", "app/scripts/final-captivity/periods.json"]) {
    const original = JSON.parse(await readFile(new URL(`../../../${path}`, import.meta.url), "utf8"));
    assert.deepEqual(TimelineSchema.parse(original), original, path);
  }
});
