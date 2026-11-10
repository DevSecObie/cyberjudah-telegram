import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { markCoverageGap } from "../src/grounding.mjs";

const out = new URL("./.build/answer-cache.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/answer-cache.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { cacheKey, cachedAnswer, keepAnswer, linkTrace, dropReported, normalizeQuestion, CACHE_TTL_S } = await import(out);
const versionsOut = new URL("./.build/answer-cache-versions.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/ask-versions.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: versionsOut, logLevel: "error" });
const { PROMPT_VERSION } = await import(versionsOut);

const kv = () => {
  const m = new Map(), ttl = new Map();
  return { m, ttl, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v, o) => { m.set(k, v); ttl.set(k, o?.expirationTtl); }, delete: async (k) => { m.delete(k); } };
};

test("the same first question, in any case or punctuation, has one key per prompt version, corpus, model, mode and release", async () => {
  assert.equal(normalizeQuestion("  Who is Esau's  father?! "), "who is esaus father");
  const c = "lib-aaaaaaaaaaaa/idx-20261110T0412Z";
  const a = await cacheKey("Who is Esau's father?", [], "m1", "app", "v1", c);
  assert.equal(a, await cacheKey("who is esau's father", [], "m1", "app", "v1", c));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m2", "app", "v1", c));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "study", "v1", c));
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "app", "v2", c), "a new release never serves an old answer");
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "app", "v1", "lib-bbbbbbbbbbbb/idx-20261110T0412Z"), "a new library never serves an old answer");
  assert.notEqual(a, await cacheKey("Who is Esau's father?", [], "m1", "app", "v1", "lib-aaaaaaaaaaaa/idx-20261111T0412Z"), "a new index build never serves an old answer");
  assert.equal(a.split(":")[1], PROMPT_VERSION, "a new prompt version never serves an old answer");
  assert.match(a, /^ask_cache:system-v\d+\.research-v\d+\.app-v\d+\.data-policy-v\d+:lib-aaaaaaaaaaaa\/idx-20261110T0412Z:v1:app:m1:[0-9a-f]{64}$/);
});

test("follow-ups and one-word questions are never cached", async () => {
  assert.equal(await cacheKey("Who is Esau's father?", [{ role: "user", content: "x" }], "m", "app", "v", "lib-unknown/idx-unknown"), null);
  assert.equal(await cacheKey("Esau", [], "m", "app", "v", "lib-unknown/idx-unknown"), null);
  const env = { SUBS: kv() };
  await keepAnswer(env, null, { ok: true });
  assert.equal(env.SUBS.m.size, 0);
  assert.equal(await cachedAnswer(env, null), null);
});

test('a coverage gap with a related cited source is never cached', async () => {
  const env = { SUBS: kv() };
  const answer = markCoverageGap({ ok: true, answer: 'Existing honest gap [1].', sources: [{ n: 1 }] });
  await keepAnswer(env, 'ask_cache:gap', { ...answer });
  assert.equal(env.SUBS.m.size, 0);
});

test("a kept answer is served for a week, and a report on it removes it", async () => {
  const env = { SUBS: kv() };
  const key = await cacheKey("Who is Esau's father?", [], "m", "app", "v", "lib-unknown/idx-unknown");
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

test("an answer holding tool-call markup is never kept, and one kept before the fix is dropped, not served", async () => {
  const B = "｜";
  const markup = { ok: true, answer: `<${B}DSML${B}tool_calls> <${B}DSML${B}invoke name="search_library"></${B}DSML${B}invoke> </${B}DSML${B}tool_calls>` };
  const env = { SUBS: kv() };
  const key = await cacheKey("Who are the twelve tribes today?", [], "m", "app", "v", "lib-unknown/idx-unknown");
  await keepAnswer(env, key, markup);
  assert.equal(env.SUBS.m.size, 0, "not kept");
  env.SUBS.m.set(key, JSON.stringify(markup));
  assert.equal(await cachedAnswer(env, key), null, "not served");
  assert.equal(env.SUBS.m.has(key), false, "and removed");
  await keepAnswer(env, key, { ok: true, answer: "Plain [1]." });
  assert.deepEqual(await cachedAnswer(env, key), { ok: true, answer: "Plain [1]." });
});
