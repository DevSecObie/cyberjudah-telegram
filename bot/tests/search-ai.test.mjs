import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

// ai.ts is bundled for Node first (as Workers bundles it).
const out = new URL("./.build/search-ai.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/ai.ts"; export { ensureCreditTables } from "./src/credits.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { answerSearch, freeSpendToday } = await import(out);

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
