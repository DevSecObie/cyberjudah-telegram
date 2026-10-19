import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// health.ts imports "./telegram-api" without an extension, as the Worker build allows; Node needs it.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (e) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
const { selfCheck } = await import("../src/health.ts");

// A D1 stand-in: each query runs the next scripted outcome for its table, then the last one again.
function d1(script) {
  const calls = {};
  return {
    calls,
    prepare(sql) {
      const table = /FROM (\w+)/.exec(sql)?.[1] ?? "none";
      const run = async () => {
        const n = calls[table] = (calls[table] ?? 0) + 1;
        const steps = script[table] ?? ["row"];
        const step = steps[Math.min(n, steps.length) - 1];
        if (step === "busy") throw new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.");
        return step === "empty" ? null : { n: 1, meta: { size_after: 1024 } };
      };
      const stmt = { bind: () => stmt, first: run, run: async () => ({ meta: { size_after: 1024 } }) };
      return stmt;
    },
  };
}
const env = (DB, TEACH) => ({ DB, TEACH, VEC: { describe: async () => ({ vectorCount: 5 }) }, SUBS: { get: async () => null } });
const check = (r, name) => r.checks.find((c) => c.name === name);

test("a D1 hiccup that clears on the retry does not fail the check", async () => {
  const teach = d1({ teaching_passages: ["busy", "row"] });
  const r = await selfCheck(env(d1({}), teach), Date.now(), 1);
  assert.equal(check(r, "d1-teachings").ok, true);
  assert.equal(teach.calls.teaching_passages, 2);
  assert.equal(r.ok, true);
});

test("a D1 error that persists through the retry fails the check with the error", async () => {
  const r = await selfCheck(env(d1({}), d1({ teaching_passages: ["busy", "busy"] })), Date.now(), 1);
  assert.equal(check(r, "d1-teachings").ok, false);
  assert.match(check(r, "d1-teachings").detail, /overloaded/);
  assert.equal(r.ok, false);
});

test("an empty index fails without a retry", async () => {
  const db = d1({ search_docs: ["empty"] });
  const r = await selfCheck(env(db, d1({})), Date.now(), 1);
  assert.deepEqual(check(r, "d1-search"), { name: "d1-search", ok: false, detail: "empty" });
  assert.equal(db.calls.search_docs, 1);
});
