import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { financialDb } from "./helpers/financial-db.mjs";

// ai.ts is bundled for Node first (as Workers bundles it).
const out = new URL("./.build/search-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/ai.ts"; export * from "./src/credits.ts"; export { searchAnswers } from "./src/search-answer.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { answerSearch, freeSpendToday, searchModel, startMeter, searchAnswers, ownerOfUser, grantPayment, wallet } = await import(out);

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

// An admin's answers are not metered, as in Ask: their testing must not trip the owner's breaker.
test("an admin's answer adds nothing to the day's free-tier spend", async () => {
  const e = { ...shared, ADMIN_IDS: "7" };
  const before = await freeSpendToday(e);
  assert.ok(before > 0, "the reader's answer above was metered");
  const r = await answerSearch(e, "melchizedek", 7);
  assert.equal(r.ok, true);
  assert.equal(await freeSpendToday(e), before, "an admin's answer is not metered against the breaker");
});

const GOOGLE = "google/gemini-2.5-flash-lite";
function fixture(t, reply = { choices: [{ message: { content: "Melchizedek was king of Salem [1]." } }], usage: { prompt_tokens: 800, completion_tokens: 80 } }) {
  const db = financialDb(t), sent = [];
  Object.assign(db.env, {
    SEARCH_AI_MODEL: GOOGLE, AI_GATEWAY: "default",
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
  assert.equal((await answerSearch({ SEARCH_AI_MODEL: GOOGLE }, "Melchizedek", 7)).reason, "consent");
  for (const id of ["google/not-in-catalog", "anthropic/claude-opus-5"]) {
    assert.equal(searchModel({ SEARCH_AI_MODEL: id }), null);
    assert.equal((await answerSearch({ SEARCH_AI_MODEL: id }, "Melchizedek", 7, ["Google"])).reason, "unavailable");
  }
});

test("search routes one bounded call through the gateway, cites the library and never charges the reader", async t => {
  const { env, sql, sent } = fixture(t);
  const owner = await ownerOfUser(env, 7);
  await grantPayment(env, owner, { charge: "search-credit", kind: "pack", stars: 10, mc: 130_000 });
  const r = await answerSearch(env, "Melchizedek", 7, ["Google"]);
  assert.equal(r.ok, true);
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
