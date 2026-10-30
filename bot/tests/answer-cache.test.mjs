import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = new URL("./.build/answer-cache.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/answer-cache.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const { cacheKey, cachedAnswer, keepAnswer, linkTrace, dropReported, normalizeQuestion, CACHE_TTL_S } = await import(out);

const kv = () => {
  const m = new Map(), ttl = new Map();
  return { m, ttl, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v, o) => { m.set(k, v); ttl.set(k, o?.expirationTtl); }, delete: async (k) => { m.delete(k); } };
};

test("the same first question, in any case or punctuation, has one key per model, mode and release", async () => {
  assert.equal(normalizeQuestion("  Who is Esau's  father?! "), "who is esaus father");
  const a = await cacheKey("Who is Esau's father?", [], "m1", "app", "v1");
  assert.equal(a, await cacheKey("who is esau's father", [], "m1", "app", "v1"));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m2", "app", "v1"));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "study", "v1"));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "app", "v2"), "a new release never serves an old answer");
  assert.match(a, /^ask_cache:v1:app:m1:[0-9a-f]{64}$/);
});

test("follow-ups and one-word questions are never cached", async () => {
  assert.equal(await cacheKey("Who is Esau's father?", [{ role: "user", content: "x" }], "m", "app", "v"), null);
  assert.equal(await cacheKey("Esau", [], "m", "app", "v"), null);
  const env = { SUBS: kv() };
  await keepAnswer(env, null, { ok: true });
  assert.equal(env.SUBS.m.size, 0);
  assert.equal(await cachedAnswer(env, null), null);
});

test("a kept answer is served for a week, and a report on it removes it", async () => {
  const env = { SUBS: kv() };
  const key = await cacheKey("Who is Esau's father?", [], "m", "app", "v");
  await keepAnswer(env, key, { ok: true, answer: "Isaac", sources: [{ n: 1 }] }, "AAAAAAAA-0000-4000-8000-000000000000");
  assert.equal(env.SUBS.ttl.get(key), CACHE_TTL_S);
  assert.deepEqual(await cachedAnswer(env, key), { ok: true, answer: "Isaac", sources: [{ n: 1 }] });
  const second = "bbbbbbbb-0000-4000-8000-000000000000";
  await linkTrace(env, key, second);
  assert.equal(await dropReported(env, second), true);
  assert.equal(await cachedAnswer(env, key), null);
  assert.equal(await dropReported(env, "cccccccc-0000-4000-8000-000000000000"), false);
});

test("an unreadable or unwritable cache never stops an answer", async () => {
  const broken = { SUBS: { get: async () => { throw new Error("kv"); }, put: async () => { throw new Error("kv"); }, delete: async () => { throw new Error("kv"); } } };
  assert.equal(await cachedAnswer(broken, "ask_cache:x"), null);
  await keepAnswer(broken, "ask_cache:x", { ok: true }, "t");
  assert.equal(await dropReported(broken, "t"), false);
});
