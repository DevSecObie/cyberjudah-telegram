import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, callUsd, creditConfig, endOfDay, estimateMc, fmtCredits, LEGACY_UNIT_MC, mcOfUsd, migrationLots, searchUsd, spendOrder, viaUnifiedBilling, walletOf } from "../../shared/credits.mjs";
import { MODELS } from "../../shared/ask-models.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const OPUS = MODELS.find((m) => m.id === "anthropic/claude-opus-5");
const SONNET = MODELS.find((m) => m.id === "anthropic/claude-sonnet-5");
const GLM = MODELS.find((m) => m.id === "@cf/zai-org/glm-5.3-flash");

test("a credit is US$0.001 of cost, kept in millicredits and rounded up, never down", () => {
  assert.equal(mcOfUsd(0.001), 1000);
  assert.equal(mcOfUsd(0.0000004), 1); // a fraction of a millicredit is charged as one
  assert.equal(mcOfUsd(0), 0);
  assert.equal(fmtCredits(12400), "12.4");
  assert.equal(fmtCredits(1950000), "1,950");
  assert.equal(fmtCredits(40), "<0.1");
});

test("the catalog: credits per Star from the payout and the margin; the plan has its bonus; the margin never touches usage", () => {
  const cfg = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1.25", ASK_PLAN_BONUS: "0.2" });
  assert.equal(cfg.creditsPerStar, 10.4);
  assert.deepEqual(cfg.packs.map((p) => [p.stars, p.mc / 1000]), [[150, 1560], [500, 5200], [1500, 15600]]);
  assert.equal(cfg.plan.mc / 1000, 9360); // 750 × 10.4 × 1.2
  // The plan gives more per Star than any top-up.
  const perStar = (x) => x.mc / x.stars;
  for (const p of cfg.packs) assert.ok(perStar(cfg.plan) > perStar(p) * 1.19);
  // What a call costs in credits is the same whatever the margin: the margin is on the Stars side.
  const a = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1" });
  assert.equal(mcOfUsd(callUsd({ input_tokens: 1000, output_tokens: 100 }, OPUS, { fee: a.unifiedFee })), mcOfUsd(callUsd({ input_tokens: 1000, output_tokens: 100 }, OPUS, { fee: cfg.unifiedFee })));
});

test("what is missing before new pricing may go on sale is named exactly", () => {
  const none = creditConfig({});
  assert.ok(none.missing.some((m) => m.startsWith("ASK_USD_PER_STAR")));
  const atCost = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1", ASK_PRICING_CONFIRMED: "yes" });
  assert.equal(atCost.missing.length, 1);
  assert.match(atCost.missing[0], /below cost/);
  assert.deepEqual(creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1.25", ASK_PRICING_CONFIRMED: "yes" }).missing, []);
});

test("a call is charged at its own model's price, with Cloudflare's fee only where Unified Billing pays", () => {
  const u = { input_tokens: 10000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 2000, output_tokens: 1000 };
  const opus = callUsd(u, OPUS); // 10k×5 + 20k×0.5 + 2k×6.25 + 1k×25, per million
  assert.ok(Math.abs(opus - (50000 + 10000 + 12500 + 25000) / 1e6) < 1e-12);
  assert.ok(Math.abs(callUsd(u, OPUS, { fee: 0.05 }) - opus * 1.05) < 1e-12);
  assert.ok(callUsd(u, SONNET) < opus);
  assert.equal(viaUnifiedBilling(OPUS, true), true);
  assert.equal(viaUnifiedBilling(OPUS, false), false); // Claude on Anthropic's own key
  assert.equal(viaUnifiedBilling(GLM, true), false); // Workers AI
  // Chat-completions usage: cached tokens are inside prompt_tokens.
  assert.ok(Math.abs(callUsd({ prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 400 }, completion_tokens: 100 }, GLM) - (600 * 0.15 + 400 * 0.03 + 100 * 0.5) / 1e6) < 1e-15);
});

test("a library search is charged from Cloudflare's embedding, vector and reranking rates", () => {
  const usd = searchUsd({ embedTokens: 40, vectorQueries: 1, rerankTokens: 12000 });
  assert.ok(Math.abs(usd - (40 * 0.0118 + 12000 * 0.00311 + 1024 * 0.01) / 1e6) < 1e-15);
  assert.equal(mcOfUsd(usd), 49); // 48.032 millicredits, rounded up
});

test("the most a request may cost: dearer models more, never above the per-request cap", () => {
  const cfg = creditConfig({ ASK_USD_PER_STAR: "0.013" });
  const o = estimateMc(OPUS, cfg), g = estimateMc(GLM, cfg);
  assert.ok(o.maxMc > o.typicalMc && g.maxMc < o.maxMc && g.typicalMc < o.typicalMc);
  assert.ok(o.maxMc <= cfg.maxRequestMc);
  assert.ok(o.maxMc > cfg.confirmAboveMc, "Opus asks before it researches");
  assert.ok(g.maxMc < cfg.confirmAboveMc, "the free model does not");
  assert.equal(estimateMc(OPUS, { ...cfg, maxRequestMc: 100000 }).maxMc, 100000);
});

const lots = [
  { id: 1, kind: "topup", remaining_mc: 5000, expires_at: null, created_at: 1 },
  { id: 2, kind: "plan", remaining_mc: 3000, expires_at: NOW + 20 * 86400000, created_at: 2 },
  { id: 3, kind: "daily", remaining_mc: 1000, expires_at: endOfDay(NOW), created_at: 3 },
  { id: 4, kind: "daily", remaining_mc: 900, expires_at: NOW - 1, created_at: 0 }, // yesterday's: expired
  { id: 5, kind: "topup", remaining_mc: 0, expires_at: null, created_at: 0 },
];

test("the credits that expire soonest are spent first: today's free, then the plan, then top-ups", () => {
  assert.deepEqual(spendOrder(lots, NOW).map((l) => l.id), [3, 2, 1]);
  assert.deepEqual(allocate(lots, 3500, NOW), { take: [{ lot: 3, mc: 1000 }, { lot: 2, mc: 2500 }], short: 0 });
  assert.deepEqual(allocate(lots, 10000, NOW), { take: [{ lot: 3, mc: 1000 }, { lot: 2, mc: 3000 }, { lot: 1, mc: 5000 }], short: 1000 });
  const w = walletOf(lots, NOW);
  assert.deepEqual([w.total_mc, w.free_mc, w.plan_mc, w.topup_mc], [9000, 1000, 3000, 5000]);
  assert.deepEqual(w.lots.map((l) => l.kind), ["daily", "plan", "topup"]);
});

test("migration keeps every unit's worth: top-up credit never expires, the plan's remainder keeps its end date", () => {
  const until = NOW + 10 * 86400000;
  const m = migrationLots({ credits: 390000, plan_until: until, plan_allowance: 1950000, plan_used: 450000, free_used: 80000 }, NOW);
  assert.deepEqual(m, [
    { kind: "topup", mc: 390000 * LEGACY_UNIT_MC, expires_at: null, source: "migrate:v1:topup", units: 390000 },
    { kind: "plan", mc: 1500000 * LEGACY_UNIT_MC, expires_at: until, source: "migrate:v1:plan", units: 1500000 },
  ]);
  // 150 Stars bought 390,000 units at the old rate; they are 1,950 credits, what 150 Stars buy now at cost.
  assert.equal(m[0].mc / 1000, 1950);
  // An ended plan and an empty account carry nothing over.
  assert.deepEqual(migrationLots({ credits: 0, plan_until: NOW - 1, plan_allowance: 100, plan_used: 0 }, NOW), []);
  assert.deepEqual(migrationLots(null, NOW), []);
});
