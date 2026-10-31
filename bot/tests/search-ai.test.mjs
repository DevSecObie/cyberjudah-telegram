import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { financialDb } from "./helpers/financial-db.mjs";

// ai.ts is bundled for Node first (as Workers bundles it).
const out = new URL("./.build/search-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/ai.ts"; export * from "./src/credits.ts"; export { searchAnswers } from "./src/search-answer.ts"; export { reserveFreeBudget } from "./src/free-budget.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { reserveFreeBudget, answerApp, answerAppAgent, appAskModels, answerSearch, withDeadline, DeadlineError, freeSpendToday, searchModel, startMeter, searchAnswers, ownerOfUser, grantPayment, wallet } = await import(out);

/** A D1 close enough for the meter and spend tables, backed by real SQLite. */
const d1 = () => {
  const db = new DatabaseSync(":memory:");
  const execBound = (q, args) => {
    const returning = /RETURNING/i.test(q);
    return {
      first: async () => db.prepare(q).get(...args) ?? null,
      all: async () => ({ results: db.prepare(q).all(...args) }),
      run: async () => {
        const stmt = db.prepare(q);
        if (returning) { const results = stmt.all(...args); return { results, meta: { changes: results.length } }; }
        const r = stmt.run(...args);
        return { results: [], meta: { changes: Number(r.changes ?? 0) } };
      },
    };
  };
  const unbound = (q) => execBound(q, []);
  return {
    prepare: (q) => ({ bind: (...a) => execBound(q, a), first: unbound(q).first, all: unbound(q).all, run: unbound(q).run }),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  };
};
// No AI or Vectorize bindings: retrieval finds nothing, so no model is ever called.
const kv = () => ({ get: async () => null, put: async () => undefined, delete: async () => undefined });
const env = () => ({ DB: d1(), PRIVACY_KEY: "test-key", SUBS: kv() });

test("a too-short question is rejected before anything runs", async () => {
  const r = await answerSearch(env(), "x", 7);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too-short");
});

// One D1 for the reader's answer and the admin's below: the credit tables are created once per
// process, so a second fresh database would have none.
const shared = env();

test("with nothing in the library it says so, on the default free model, and reports its latency", async () => {
  const e = shared;
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  let r;
  try {
    r = await answerSearch(e, "melchizedek", 7);
  } finally {
    console.log = original;
  }
  assert.equal(r.ok, true);
  assert.match(r.answer, /not find enough reliable material/);
  assert.deepEqual(r.sources, []);
  assert.equal(r.model, "@cf/meta/llama-3.1-8b-instruct-fp8");
  // CYB-296: the response reports its own server-side latency in ms.
  assert.equal(typeof r.ms, "number");
  assert.ok(Number.isFinite(r.ms) && r.ms >= 0, `ms should be a finite, non-negative number (got ${r.ms})`);
  // CYB-296: the usage event logged for the search path carries the same latency as elapsedMs,
  // and nothing else beyond numbers (never the question, never a reader id).
  const usage = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o && o.event === "ask_usage");
  assert.ok(usage, "expected an ask_usage event to be logged");
  assert.equal(typeof usage.elapsedMs, "number");
  assert.ok(Number.isFinite(usage.elapsedMs) && usage.elapsedMs >= 0, `elapsedMs should be a finite, non-negative number (got ${usage.elapsedMs})`);
  assert.ok(!("q" in usage) && !("question" in usage) && !("uid" in usage));
  const spent = await freeSpendToday(e);
  assert.ok(spent > 0 && spent < 0.001, `the nominal research cost is metered for the breaker (got $${spent})`);
});

test("withDeadline passes a prompt result through and rejects late work with a DeadlineError", async () => {
  assert.equal(await withDeadline(Promise.resolve(4), 50), 4);
  await assert.rejects(withDeadline(new Promise(() => {}), 20), (e) => e instanceof DeadlineError);
});

test("a stalled model is given up on at the deadline: the answer is unavailable, and logged as a timeout", async () => {
  // Workers AI that never replies: the embedding (and so retrieval) stalls.
  const e = { ...shared, AI: { run: () => new Promise(() => {}) }, VEC: { query: async () => ({ matches: [] }) } };
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  const t0 = Date.now();
  let r;
  try { r = await answerSearch(e, "melchizedek", 8, [], 50); } finally { console.error = original; }
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unavailable");
  assert.ok(Date.now() - t0 < 5_000, "the reader is not kept waiting on the stalled model");
  assert.ok(lines.some((l) => l.includes('"search_answer_timeout"')), lines.join("\n"));
});

test("admin searches share the daily free-tier allowance", async () => {
  const e = { ...shared, ADMIN_IDS: "7" };
  const before = await freeSpendToday(e);
  assert.ok(before > 0, "the reader's answer above was metered");
  const r = await answerSearch(e, "melchizedek", 7);
  assert.equal(r.ok, true);
  assert.ok(await freeSpendToday(e) > before, "admin searches must not bypass the daily allowance");
});

const GOOGLE = "google/gemini-2.5-flash-lite";
function fixture(t, reply = { choices: [{ message: { content: "Melchizedek was king of Salem [1]." } }], usage: { prompt_tokens: 800, completion_tokens: 80 } }) {
  const db = financialDb(t), sent = [];
  Object.assign(db.env, {
    SEARCH_AI_MODEL: GOOGLE, SEARCH_AI_FREE_ONLY: "off", AI_GATEWAY: "default",
    AI: { async run(model, input, options) {
      sent.push({ model, input, options });
      if (model.includes("bge-m3")) return { data: [[1, 2]] };
      if (reply instanceof Error) throw reply;
      return reply;
    } },
    VEC: { async query() { return { matches: [{ score: 0.95, metadata: { kind: "verse", title: "Genesis 14:18", url: "/bible/genesis/14#v18", text: "And Melchizedek king of Salem brought forth bread and wine: and he was the priest of the most high God. This passage identifies Melchizedek." } }] }; } },
  });
  return { ...db, sent };
}

test("external search needs consent before touching storage or retrieval; unknown models fail closed", async () => {
  assert.equal((await answerSearch({ SEARCH_AI_MODEL: GOOGLE, SEARCH_AI_FREE_ONLY: "off" }, "Melchizedek", 7)).reason, "consent");
  for (const id of ["google/not-in-catalog", "anthropic/claude-opus-5"]) {
    assert.equal(searchModel({ SEARCH_AI_MODEL: id }), null);
    assert.equal((await answerSearch({ SEARCH_AI_MODEL: id }, "Melchizedek", 7, ["Google"])).reason, "unavailable");
  }
});

test("free-only search rejects a paid configuration before storage, even with consent", async () => {
  assert.equal((await answerSearch({ SEARCH_AI_MODEL: GOOGLE }, "Melchizedek", 7, ["Google"])).reason, "unavailable");
  assert.equal(searchModel({}).provider, "Cloudflare (Workers AI)");
});

test("an admin cannot bypass an exhausted search allowance", async t => {
  const { env, sent } = fixture(t);
  Object.assign(env, { ADMIN_IDS: "7", ASK_FREE_DAILY_USD_CAP: "0" });
  assert.equal((await answerSearch(env, "Melchizedek", 7, ["Google"])).reason, "free-paused");
  assert.deepEqual(sent, []);
});

test("search routes one bounded call through the gateway, cites the library and never charges the reader", async t => {
  const { env, sql, sent } = fixture(t);
  const owner = await ownerOfUser(env, 7);
  await grantPayment(env, owner, { charge: "search-credit", kind: "pack", stars: 10, mc: 130_000 });
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  let r;
  try { r = await answerSearch(env, "Melchizedek", 7, ["Google"]); } finally { console.log = original; }
  assert.equal(r.ok, true);
  // Where the time went, in numbers only: no question, no reader.
  const timing = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.event === "search_answer_timing");
  assert.ok(timing, "expected a search_answer_timing event");
  for (const k of ["retrieveMs", "modelMs", "totalMs"]) assert.ok(Number.isFinite(timing[k]) && timing[k] >= 0, k);
  assert.deepEqual(Object.keys(timing).sort(), ["event", "modelMs", "retrieveMs", "totalMs"]);
  assert.equal(r.model, GOOGLE);
  assert.equal(r.provider, "Google");
  assert.equal(r.sources[0].title, "Genesis 14:18");
  assert.match(r.answer, /\[1\]/);
  const calls = sent.filter(s => s.model === GOOGLE);
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].input.messages), /Passages from the library/);
  assert.match(JSON.stringify(calls[0].input.messages), /\[1\] Genesis 14:18/);
  assert.equal(calls[0].input.tools, undefined);
  assert.ok(calls[0].input.max_tokens >= 64 && calls[0].input.max_tokens <= 4096);
  assert.deepEqual(calls[0].options, { gateway: { id: "default", collectLog: false } });
  assert.equal((await wallet(env, owner)).total_mc, 130_000);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM credit_usage").get().n, 0);
  const spend = await freeSpendToday(env);
  assert.ok(spend > (800 * 0.1 + 80 * 0.4) / 1e6, "shared spend includes model, gateway fee and retrieval");
  // Sponsoring Search must not make the same external model free in Ask.
  assert.equal((await startMeter(env, 8, searchModel(env))).status, 402);
});

test("a reader with no balance can get an external search answer", async t => {
  const { env } = fixture(t);
  assert.equal((await answerSearch(env, "Melchizedek", 7, ["Google"])).ok, true);
  assert.equal((await wallet(env, await ownerOfUser(env, 7))).total_mc, 0);
});

test("the daily breaker blocks external calls before retrieval", async t => {
  const { env, sent } = fixture(t);
  env.ASK_FREE_DAILY_USD_CAP = "0";
  assert.equal((await answerSearch(env, "Melchizedek", 7, ["Google"])).reason, "free-paused");
  assert.deepEqual(sent, []);
});

test("the per-answer budget bounds input plus output before starting an external call", async t => {
  const { env, sent } = fixture(t);
  env.ASK_FREE_MAX_USD = "0.001";
  await answerSearch(env, "Melchizedek", 7, ["Google"]);
  const call = sent.find(s => s.model === GOOGLE);
  assert.ok(call, "the small fixture still leaves enough room to answer");
  const { max_tokens, ...input } = call.input;
  const inputTokens = new TextEncoder().encode(JSON.stringify(input)).length + 1024;
  assert.ok(max_tokens < 4096, "a small budget must reduce the output limit");
  assert.ok((inputTokens * 0.1 + max_tokens * 0.4) / 1e6 * 1.05 < 0.001,
    "input and output, including the gateway fee, must fit the reserved budget");
});

test("unavailable reservation storage blocks external calls", async t => {
  const { env, fail, sent } = fixture(t);
  fail(/INSERT OR IGNORE INTO free_spend_holds/);
  assert.equal((await answerSearch(env, "Melchizedek", 7, ["Google"])).reason, "unavailable");
  assert.deepEqual(sent, []);
});

for (const [label, reply] of [["provider failure", new Error("Gateway unavailable")], ["missing usage", { choices: [{ message: { content: "An answer [1]." } }] }]]) {
  test(`${label} keeps the reservation accounted for and starts no unbudgeted fallback`, async t => {
    const { env, sql, sent } = fixture(t, reply);
    const r = await answerSearch(env, "Melchizedek", 7, ["Google"]);
    assert.equal(r.ok, label === "missing usage");
    assert.equal(sent.filter(s => !s.model.includes("bge-m3")).length, 1);
    assert.equal(Math.round(await freeSpendToday(env) * 1e6), sql.prepare("SELECT reserved_micro FROM free_spend_holds").get().reserved_micro);
  });
}

function routeFixture(t, env, uid = 7) {
  const cache = new Map(), pending = [], matched = [];
  const prior = globalThis.caches;
  globalThis.caches = { default: {
    async match(key) { matched.push(key); return cache.get(key)?.clone(); },
    async put(key, value) { cache.set(key, value); },
  } };
  t.after(() => { globalThis.caches = prior; });
  const app = new Hono();
  app.use("*", async (c, next) => { if (uid) c.set("tma", { user: { id: uid } }); await next(); });
  app.route("/api/search/answer", searchAnswers);
  const request = async (q, consent = "") => {
    const r = await app.request(`https://app.example/api/search/answer?q=${encodeURIComponent(q)}`, { headers: { "x-ai-consent": consent } }, env, { waitUntil(p) { pending.push(p); } });
    await Promise.all(pending);
    return r;
  };
  return { request, cache, matched };
}

test("route checks consent even on a cached answer and separates models in the edge cache", async t => {
  const { env, sent, sql } = fixture(t);
  const { request, cache, matched } = routeFixture(t, env);
  assert.equal((await request("Melchizedek")).status, 428);
  assert.equal(matched.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get().n, 0);
  const first = await request("Melchizedek", "Google");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(cache.size, 1);
  const count = sent.length;
  const again = await request("Melchizedek", "Google");
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("cache-control"), "private, no-store");
  assert.equal(sent.length, count);
  const lookups = matched.length;
  assert.equal((await request("Melchizedek")).status, 428, "withdrawal is checked before cache");
  assert.equal(matched.length, lookups);
  delete env.SEARCH_AI_MODEL;
  assert.equal((await request("Melchizedek")).status, 200);
  assert.equal(cache.size, 2);
  assert.ok(sent.some(s => s.model.startsWith("@cf/meta/")));
});

test("route refuses unauthenticated readers", async t => {
  const { env, sent } = fixture(t);
  const { request } = routeFixture(t, env, null);
  assert.equal((await request("Melchizedek", "Google")).status, 401);
  assert.equal(sent.length, 0);
});

test("route applies the per-reader quota before any new provider call", async t => {
  const { env, sent } = fixture(t);
  env.SEARCH_AI_DAILY_LIMIT = "1";
  const { request } = routeFixture(t, env);
  assert.equal((await request("Melchizedek", "Google")).status, 200);
  const count = sent.length;
  const denied = await request("king of Salem", "Google");
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).error, "limit");
  assert.equal(sent.length, count);
});

test("a reader listed in SEARCH_AI_QUOTA_EXEMPT skips the per-reader count; others still hit it", async t => {
  const { env } = fixture(t);
  env.SEARCH_AI_DAILY_LIMIT = "1";
  env.SEARCH_AI_QUOTA_EXEMPT = "1";
  const exempt = routeFixture(t, env, 1);
  assert.equal((await exempt.request("Melchizedek", "Google")).status, 200);
  assert.equal((await exempt.request("king of Salem", "Google")).status, 200);
  const other = routeFixture(t, env, 7);
  assert.equal((await other.request("priest of the most high", "Google")).status, 200);
  assert.equal((await other.request("bread and wine", "Google")).status, 429);
});

// The app's Ask (answerApp): any app sign-in, the free model only, no balance.
const AGREED = ["Cloudflare (Workers AI)"];
// The app offers only its approved free models (app-study-release.ts), so these run on the default one.
const appEnv = () => ({ ...env(), ASK_FREE_MODEL: "@cf/google/gemma-4-26b-a4b-it", ASK_FREE_MODELS: "@cf/google/gemma-4-26b-a4b-it" });
test("app Ask needs the reader's agreement to the free model's provider before anything runs", async () => {
  const e = appEnv();
  assert.deepEqual(await answerApp(e, "who is judah", "acct-a", [], []), { ok: false, reason: "consent" });
  assert.equal(await freeSpendToday(e), 0);
});

test("app Ask answers on the free model, funded by the free allowance, with no wallet created", async () => {
  const e = appEnv();
  const r = await answerApp(e, "melchizedek", "acct-a", [{ role: "user", content: "who was the priest of salem" }], AGREED);
  assert.equal(r.ok, true);
  assert.equal(r.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.deepEqual(r.sources, []);
  assert.ok((await freeSpendToday(e)) > 0);
  const wallets = await e.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'credit%'").all();
  assert.deepEqual(wallets.results, [], "no credit tables or wallet for an app reader");
});

test("app Ask keeps each account to the daily cap, apart from other accounts", async () => {
  const e = appEnv();
  for (let i = 0; i < 100; i++) assert.equal((await answerApp(e, "judah", "acct-b", [], AGREED)).ok, true);
  assert.deepEqual(await answerApp(e, "judah", "acct-b", [], AGREED), { ok: false, reason: "limit" });
  assert.equal((await answerApp(e, "judah", "acct-c", [], AGREED)).ok, true);
});

test("a too-short app question is refused before the cap is counted", async () => {
  assert.deepEqual(await answerApp(appEnv(), " x ", "acct-d", [], AGREED), { ok: false, reason: "too-short" });
});

test("app Ask names the verse a question asks about in exact King James text, and returns follow-ups", async (t) => {
  const sent = [];
  const e = {
    ...appEnv(), AI_GATEWAY: "default",
    AI: { run: async (model, input) => {
      if (model.includes("bge-m3")) return { data: [[0.1, 0.2]] };
      sent.push(input);
      return { response: "The Lord would bring them into Egypt again with ships [1].\n\nFollow-ups: Which ships? | When did it happen? | Who were the enemies?", usage: { prompt_tokens: 900, completion_tokens: 60 } };
    } },
    VEC: { query: async () => ({ matches: [] }) },
    DATA_ORIGIN: "https://data.test",
  };
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path === "/api/kjv/books.json") return Response.json([{ book: "Deuteronomy", slug: "deuteronomy", chapters: 34 }]);
    if (path === "/api/kjv/deuteronomy/28.json") return Response.json({ book: "Deuteronomy", chapter: 28, verses: [{ verse: 68, text: "And the LORD shall bring thee into Egypt again with ships…" }] });
    return new Response("", { status: 404 });
  };
  t.after(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });
  const r = await answerApp(e, "What does Deuteronomy 28:68 mean?", "acct-v", [], AGREED);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.sources[0].kind, "verse");
  assert.equal(r.sources[0].title, "Deuteronomy 28:68 (KJV)");
  assert.deepEqual(r.followups, ["Which ships?", "When did it happen?", "Who were the enemies?"]);
  assert.match(JSON.stringify(sent[0].messages), /bring thee into Egypt again with ships/);
});

test('native Ask rejects paid model selection before touching provider, quota or wallet', async () => {
  assert.deepEqual(await answerApp(env(), 'Who is Judah?', 'app-owner', [], AGREED, 55000, { model: 'anthropic/claude-opus-5' }), { ok: false, reason: 'model-unavailable' });
});
test('native Ask refuses oversized questions rather than silently cutting them', async () => {
  assert.deepEqual(await answerApp(env(), 'x'.repeat(4001), 'app-owner', [], AGREED), { ok: false, reason: 'too-long' });
});

test('native model promotion requires the versioned serving registry, not only an environment variable', async () => {
  const result = await answerApp({ ASK_FREE_MODELS: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' }, 'Who was Abraham?', 'account', [], ['Cloudflare (Workers AI)'], 5000, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', study: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'model-unavailable');
});

test('the stronger free model is admitted to native Ask when configured', async () => {
  const e = { ...env(), ASK_FREE_MODEL: '@cf/google/gemma-4-26b-a4b-it', ASK_FREE_MODELS: '@cf/google/gemma-4-26b-a4b-it,@cf/meta/llama-3.1-8b-instruct-fp8' };
  const r = await answerApp(e, 'melchizedek', 'acct-g', [], AGREED);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.model, '@cf/google/gemma-4-26b-a4b-it');
});

test("passages are tagged with the teacher the published class notes name, and only those", async (t) => {
  const { withTeachers } = await import(out);
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
  globalThis.fetch = async (url) => new URL(url).pathname === "/api/notes/index.json"
    ? Response.json([{ url: "/classes/2026/passover", videoId: "abc123def45", teacher: "Deacon Isaac" }, { url: "/classes/x", videoId: "zzz", teacher: "" }])
    : new Response("", { status: 404 });
  t.after(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; });
  const tagged = await withTeachers({ DATA_ORIGIN: "https://data.test" }, [
    { kind: "spoken", title: "A", url: "", video: "abc123def45", text: "x" },
    { kind: "class", title: "B", url: "/classes/2026/passover?t=30", text: "y" },
    { kind: "class", title: "C", url: "/classes/x", video: "zzz", text: "z" },
  ]);
  assert.deepEqual(tagged.map((p) => p.teacher), ["Deacon Isaac", "Deacon Isaac", undefined]);
});

test("a deep app question goes to the stronger free model when one is configured; a light one stays on the fast default", async () => {
  const e = { ...env(), ASK_FREE_MODEL: '@cf/google/gemma-4-26b-a4b-it', ASK_FREE_DEEP_MODEL: '@cf/deepseek-ai/deepseek-v4-flash-0731', ASK_FREE_MODELS: '@cf/google/gemma-4-26b-a4b-it,@cf/deepseek-ai/deepseek-v4-flash-0731' };
  assert.equal((await answerApp(e, 'Why do we keep the Passover?', 'acct-r', [], AGREED)).model, '@cf/deepseek-ai/deepseek-v4-flash-0731');
  assert.equal((await answerApp(e, 'Who was Naamah?', 'acct-r', [], AGREED)).model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal((await answerApp(e, 'Why do we keep the Passover?', 'acct-r', [], AGREED, 55000, { model: '@cf/google/gemma-4-26b-a4b-it' })).model, '@cf/google/gemma-4-26b-a4b-it', 'a chosen model is kept');
});

// The app's Ask on cyberjudah.io/app's engine (answerAppAgent).
test("the app offers Claude only to an admin's linked account, every day", () => {
  const e = { ...appEnv(), ADMIN_IDS: "42", ANTHROPIC_API_KEY: "k", CLAUDE_BILLING: "anthropic", CLAUDE_MODEL: "claude-sonnet-5" };
  const thursday = Date.parse("2026-10-29T18:00:00Z"), saturday = Date.parse("2026-10-31T18:00:00Z");
  assert.ok(appAskModels(e, 42, thursday).some((m) => m.format === "anthropic"));
  assert.ok(appAskModels(e, 42, saturday).some((m) => m.format === "anthropic"), "the owner chose no holy-day pause");
  assert.ok(!appAskModels(e, 7, thursday).some((m) => m.format === "anthropic"), "a reader gets the free models");
  assert.ok(!appAskModels(e, undefined, thursday).some((m) => m.format === "anthropic"));
  assert.ok(!appAskModels(appEnv()).some((m) => m.id.includes("llama-3.1-8b")), "llama-8b is no longer offered");
});

test("app Ask researches and answers like cyberjudah.io/app, on the free allowance", async () => {
  const sent = [];
  const e = {
    ...appEnv(), AI_GATEWAY: "default",
    AI: { run: async (model, input) => {
      if (model.includes("bge-m3")) return { data: [[0.1, 0.2]] };
      sent.push({ model, input });
      return { choices: [{ message: { role: "assistant", content: "Keep it for ever, as the classes teach.\n\nFollow-ups: Why for ever? | When is it kept?" }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 60 } };
    } },
    VEC: { query: async () => ({ matches: [] }) },
  };
  assert.deepEqual(await answerAppAgent(e, "Why do we keep the Passover?", "acct-p", [], []), { ok: false, reason: "consent" });
  const events = [];
  const r = await answerAppAgent(e, "Why do we keep the Passover?", "acct-p", [], AGREED, { emit: (x) => events.push(x) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.match(r.answer, /Keep it for ever/);
  assert.deepEqual(r.followups, ["Why for ever?", "When is it kept?"]);
  assert.ok(sent.some((s) => s.model === "@cf/google/gemma-4-26b-a4b-it"));
  assert.ok((await freeSpendToday(e)) > 0, "the free allowance pays for it");
});

// Claude for every signed-in reader (owner's choice 2026-10-31), off until switched on.
const claudeEnv = (extra = {}) => ({ ...appEnv(), ANTHROPIC_API_KEY: "k", CLAUDE_BILLING: "anthropic", CLAUDE_MODEL: "claude-sonnet-5", CLAUDE_MODEL_LIGHT: "claude-haiku-4-5", ...extra });
test("Claude for readers is off unless switched on with a daily cap above zero", () => {
  assert.ok(!appAskModels(claudeEnv(), undefined, true).some((m) => m.format === "anthropic"), "off by default");
  assert.ok(!appAskModels(claudeEnv({ ASK_CLAUDE_FOR_READERS: "on" }), undefined, true).some((m) => m.format === "anthropic"), "no cap, no Claude");
  assert.ok(!appAskModels(claudeEnv({ ASK_CLAUDE_FOR_READERS: "on", ASK_CLAUDE_DAILY_USD_CAP: "5", ANTHROPIC_API_KEY: "", CLAUDE_BILLING: "anthropic" }), undefined, true).some((m) => m.format === "anthropic"), "no key, no Claude");
  const on = claudeEnv({ ASK_CLAUDE_FOR_READERS: "on", ASK_CLAUDE_DAILY_USD_CAP: "5" });
  assert.deepEqual(appAskModels(on, undefined, true).filter((m) => m.format === "anthropic").map((m) => m.native), ["claude-haiku-4-5", "claude-sonnet-5"], "Haiku first (the default), then Sonnet");
  assert.ok(!appAskModels(on).some((m) => m.format === "anthropic"), "only the app's Ask asks for the readers' list");
});

test("past Claude's own daily cap a reader is answered by the free model, on the free allowance", async () => {
  const e = { ...claudeEnv({ ASK_CLAUDE_FOR_READERS: "on", ASK_CLAUDE_DAILY_USD_CAP: "1" }), AI_GATEWAY: "default",
    AI: { run: async (model) => model.includes("bge-m3") ? { data: [[0.1, 0.2]] } : { choices: [{ message: { role: "assistant", content: "Keep it for ever." }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 60 } } },
    VEC: { query: async () => ({ matches: [] }) } };
  assert.ok(await reserveFreeBudget(e, "spent-it", 1, Date.now(), { prefix: "claude:", capUsd: 1 }), "the whole Claude allowance is held");
  assert.equal(await freeSpendToday(e), 0, "Claude's allowance is kept apart from the free one");
  assert.deepEqual(await answerAppAgent(e, "Why do we keep the Passover?", "acct-c", [], ["Anthropic"]), { ok: false, reason: "consent" }, "no agreement to the free provider is assumed");
  const r = await answerAppAgent(e, "Why do we keep the Passover?", "acct-c", [], [...AGREED, "Anthropic"]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.model, "@cf/google/gemma-4-26b-a4b-it");
  assert.ok((await freeSpendToday(e)) > 0);
});
