import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

// ai.ts reaches the credit store and the agent, which import one another without file
// extensions (as Workers bundles them), so it is bundled for Node first.
const out = new URL("./.build/scale.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/ai.ts"; export { ensureCreditTables } from "./src/credits.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { takeQuota, takeQuotaKey, sweepRateCounts, freeSpendToday, freePaused, freeModels, freeModel } = await import(out);

/** A D1 close enough for quota and spend tables, backed by real SQLite. */
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
const env = () => ({ DB: d1(), PRIVACY_KEY: "test-key", ASK_FREE_DAILY_USD_CAP: "100" });

test("the per-person quota counts atomically and caps at the limit", async () => {
  const e = env();
  for (let i = 0; i < 3; i++) assert.equal(await takeQuota(e, "ask", 77, 3), true);
  assert.equal(await takeQuota(e, "ask", 77, 3), false, "the fourth is over the cap");
  assert.equal(await takeQuota(e, "ask", 78, 3), true, "another person has their own count");
});

test("the request path no longer sweeps: old rows wait for the hourly job", async () => {
  const e = env();
  const old = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  await takeQuotaKey(e, `ask:stale:${old}`, 100);
  await takeQuota(e, "ask", 77, 100);
  const before = await e.DB.prepare("SELECT count(*) AS n FROM rate_counts").first();
  assert.equal(before.n, 2, "the old row survives the request path");
  const swept = await sweepRateCounts(e);
  assert.equal(swept, 1, "the hourly sweep removes exactly the old row");
  const after = await e.DB.prepare("SELECT key FROM rate_counts").all();
  assert.ok(after.results.every((r) => !r.key.includes(old)), "only fresh rows remain");
});

test("the sweep keeps two days so a UTC-midnight boundary never drops a live counter", async () => {
  const e = env();
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await takeQuotaKey(e, `ask:a:${day(1)}`, 100);
  await takeQuotaKey(e, `ask:b:${day(2)}`, 100);
  await sweepRateCounts(e);
  const left = (await e.DB.prepare("SELECT key FROM rate_counts").all()).results.map((r) => r.key);
  assert.ok(left.some((k) => k.includes(day(1))), "yesterday is kept");
  assert.ok(!left.some((k) => k.includes(day(2))), "two days ago goes");
});

test("the free-tier circuit breaker trips at the owner's daily cap", async () => {
  const e = env();
  assert.equal(await freeSpendToday(e), 0);
  assert.equal(await freePaused(e), false);
  // $100 of free answers recorded through the day…
  await e.DB.batch([
    e.DB.prepare("CREATE TABLE IF NOT EXISTS free_spend_daily (day TEXT PRIMARY KEY, usd_micro INTEGER NOT NULL DEFAULT 0)"),
    e.DB.prepare("INSERT INTO free_spend_daily (day, usd_micro) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET usd_micro = usd_micro + ?")
      .bind(new Date().toISOString().slice(0, 10), 100_000_000, 100_000_000),
  ]);
  assert.equal(await freeSpendToday(e), 100);
  assert.equal(await freePaused(e), true, "at the cap the free model pauses");
});

test("the IP backstop counts per address per day under its own limit", async () => {
  const e = env();
  const key = (ip) => `ask_ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
  for (let i = 0; i < 5; i++) assert.equal(await takeQuotaKey(e, key("9.9.9.9"), 5), true);
  assert.equal(await takeQuotaKey(e, key("9.9.9.9"), 5), false);
  assert.equal(await takeQuotaKey(e, key("8.8.8.8"), 5), true, "another address is unaffected");
});

test("the free tier offers every Workers AI text model, with Llama 3.1 8B the default", async () => {
  const e = env();
  const set = freeModels(e);
  assert.ok(set.size > 1, "more than the one default model");
  assert.ok(set.has("@cf/meta/llama-3.1-8b-instruct-fp8"), "the default is in the set");
  assert.ok(set.has("@cf/zai-org/glm-5.3-flash"), "Flash is offered too: it draws from the same free neurons");
  assert.ok(set.has("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"));
  assert.ok(!set.has("anthropic/claude-sonnet-5"), "Claude is never free");
  assert.ok(![...set].some((id) => id.startsWith("@cf/baai/")), "embeddings are not Ask models");
  assert.equal(freeModel(e).id, "@cf/meta/llama-3.1-8b-instruct-fp8");
  const narrowed = freeModels({ ...e, ASK_FREE_MODELS: "@cf/meta/llama-3.1-8b-instruct-fp8" });
  assert.deepEqual([...narrowed], ["@cf/meta/llama-3.1-8b-instruct-fp8"], "ASK_FREE_MODELS can narrow the menu");
});
