import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

const out = new URL("./.build/reader.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/reader.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { publicReader } = await import(out);

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE search_docs USING fts5(kind UNINDEXED,title,url UNINDEXED,sub UNINDEXED,text,book UNINDEXED,chapter UNINDEXED)");
  db.prepare("INSERT INTO search_docs(kind,title,url,sub,text) VALUES(?,?,?,?,?)").run("verse", "John 3:16", "/bible/john/3#v16", "KJV", "For God so loved the world");
  let reads = 0;
  const prepare = (sql, values = []) => ({ bind: (...args) => prepare(sql, args), all: async () => { reads++; return { results: db.prepare(sql).all(...values) }; } });
  const keys = [], pending = [], saved = new Map();
  globalThis.caches = { default: { match: async key => saved.get(key)?.clone(), put: async (key, value) => { saved.set(key, value.clone()); } } };
  const env = { BOT_TOKEN: '100:local-test', DB: { prepare, batch: statements => Promise.all(statements.map(s => s.all())) }, READER_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: true }; } } };
  const ctx = { waitUntil: promise => pending.push(promise), passThroughOnException() {} };
  const get = (path, options) => publicReader.request(`https://reader.test${path}`, options, env, ctx);
  return { env, keys, get, pending, reads: () => reads };
}

test("anonymous library search uses real FTS, caches only public results, and limits cache hits too", async () => {
  const f = fixture(), url = '/search?q=%22God%20so%20loved%22&only=verse';
  const first = await f.get(url, { headers: { "cf-connecting-ip": "192.0.2.4" } });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).hits[0].title, "John 3:16");
  assert.equal(first.headers.get("cache-control"), "public, max-age=120");
  assert.equal(first.headers.get("set-cookie"), null);
  await Promise.all(f.pending);
  const reads = f.reads();
  const second = await f.get(url, { headers: { cookie: "untrusted=anything", "cf-connecting-ip": "192.0.2.4" } });
  assert.equal(second.status, 200);
  assert.equal(f.reads(), reads);
  assert.equal(f.keys.length, 2);
  assert.equal(f.keys[0], f.keys[1]);
  assert.match(f.keys[0], /^[a-f0-9]{64}$/);
  assert.ok(!f.keys[0].includes("192.0.2.4"));
  f.env.READER_LIMIT.limit = async () => ({ success: false });
  const denied = await f.get(url);
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "60");
  assert.equal(denied.headers.get("cache-control"), "no-store");
});

test("the reader limit keys each signed Mini App reader on its own, under a keyed hash", async () => {
  const { createHmac } = await import("node:crypto");
  const f = fixture();
  f.env.MINIAPP_CLIENT_IP_KEY = "relay-key";
  const signed = (ip) => { const ts = Math.floor(Date.now() / 1000); return { "cf-connecting-ip": "203.0.113.9", "x-cj-client-ip": ip, "x-cj-client-ts": String(ts), "x-cj-client-sig": createHmac("sha256", "relay-key").update(`${ip}|${ts}|GET|/books`).digest("hex") }; };
  for (const headers of [signed("198.51.100.1"), signed("198.51.100.2"), { "cf-connecting-ip": "203.0.113.9" }, { "cf-connecting-ip": "203.0.113.9", "x-cj-client-ip": "198.51.100.3" }]) await f.get("/books", { headers });
  assert.equal(f.keys.length, 4);
  assert.equal(new Set(f.keys).size, 3, "two signed readers apart; an unsigned claim counts the relay");
  assert.equal(f.keys[2], f.keys[3]);
  assert.ok(f.keys.every((k) => /^[a-f0-9]{64}$/.test(k)));
  const plain = (await import("node:crypto")).createHash("sha256").update("reader:203.0.113.9").digest("hex");
  assert.notEqual(f.keys[2], plain, "not a digest anyone could rebuild by hashing every address");
});

test("missing or failed anonymous limiter fails closed without a database read", async () => {
  for (const limiter of [undefined, { limit: async () => { throw new Error("unavailable"); } }]) {
    const f = fixture(); f.env.READER_LIMIT = limiter;
    const response = await f.get("/search?q=God");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(f.reads(), 0);
  }
});

test("public aliases cannot expose account, AI, billing or write routes", async () => {
  const f = fixture();
  for (const path of ["/ask", "/ask/account", "/auth/status", "/invoice", "/study-backup", "/search/answer", "/privacy/export"]) {
    assert.equal((await f.get(path)).status, 404, path);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const response = await f.get("/search?q=God", { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET");
  }
  assert.equal(f.reads(), 0);
});

test("public input sizes and content identifiers stay bounded", async () => {
  const f = fixture();
  assert.equal((await f.get(`/search?q=${"a".repeat(2048)}`)).status, 414);
  assert.equal((await f.get("/taught/john/201")).status, 400);
  assert.equal((await f.get("/transcript/invalid!")).status, 400);
  assert.equal((await f.get("/visuals/invalid!")).status, 400);
  const result = await (await f.get(`/search?q=${"God ".repeat(60)}&limit=999999`)).json();
  assert.equal(result.ok, true);
  assert.equal(result.q.length, 200);
  assert.ok(result.hits.length <= 100);
});

test("anonymous PDF links stay inside the public-domain catalog and cannot send to chat", async () => {
  const f = fixture(), original = globalThis.fetch, fetched = [];
  f.env.BOT_TOKEN = "100:local-test";
  f.env.DATA_ORIGIN = "https://data.reader.test";
  globalThis.fetch = async input => {
    const url = String(input); fetched.push(url);
    if (url.endsWith("/api/library/index.json")) return Response.json([{ slug: "josephus" }]);
    if (url.endsWith("/api/library/josephus/book.json")) return Response.json({ title: "Josephus", license: "Public domain.", items: [{ id: "josephus-fixture" }] });
    if (url === "https://archive.org/metadata/josephus-fixture") return Response.json({ files: [{ name: "josephus.pdf", format: "Text PDF", size: "100" }] });
    throw new Error(`Unexpected external request: ${url}`);
  };
  try {
    const response = await f.get("/library/pdf?slug=josephus&item=josephus-fixture");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match((await response.json()).url, /^https:\/\/reader\.test\/api\/library\/pdf\/josephus\/josephus-fixture\?exp=\d+&sig=[a-f0-9]+$/);
    const count = fetched.length;
    assert.equal((await f.get("/library/pdf?slug=josephus&item=josephus-fixture&send=true")).status, 400);
    assert.equal(fetched.length, count);
    assert.equal((await f.get("/library/pdf?slug=private&item=private")).status, 404);
    assert.ok(fetched.every(url => url.startsWith(f.env.DATA_ORIGIN) || url.startsWith("https://archive.org/metadata/")));
  } finally { globalThis.fetch = original; }
});
