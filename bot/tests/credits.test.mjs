import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, callUsd, creditConfig, estimateMc, fmtUsd, LEGACY_UNIT_MC, mcOfStars, mcOfUsd, migrationLots, searchUsd, spendOrder, starsFor, viaUnifiedBilling, walletOf } from "../../shared/credits.mjs";
import { MODELS } from "../../shared/ask-models.mjs";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const OPUS = MODELS.find((m) => m.id === "anthropic/claude-opus-5");
const GLM = MODELS.find((m) => m.id === "@cf/zai-org/glm-5.3-flash");

test("the balance is kept in millionths of a dollar, rounded up when charged, and shown in dollars", () => {
  assert.equal(mcOfUsd(0.05), 50000);
  assert.equal(mcOfUsd(0.0000004), 1); // a fraction of a unit is charged as one
  assert.equal(mcOfUsd(0), 0);
  assert.equal(fmtUsd(4_820_000), "$4.82");
  assert.equal(fmtUsd(4_829_999, { floor: true }), "$4.82", "a balance never shows more than is there");
  assert.equal(fmtUsd(46_000), "$0.05", "a cost rounds to the nearest cent");
  assert.equal(fmtUsd(3_000), "<$0.01");
  assert.equal(fmtUsd(9_999, { floor: true }), "<$0.01");
  assert.equal(fmtUsd(0), "$0.00");
  assert.equal(fmtUsd(1_234_560_000), "$1,234.56");
});

test("Stars and dollars: a top-up costs enough Stars to cover it, and adds exactly what those Stars pay out", () => {
  assert.equal(starsFor(1, 0.013), 77);
  assert.equal(starsFor(5, 0.013), 385);
  assert.equal(starsFor(20, 0.013), 1539);
  assert.equal(starsFor(0.013 * 100, 0.013), 100, "an exact amount needs no extra Star");
  assert.equal(mcOfStars(77, 0.013), 1_001_000);
  assert.equal(mcOfStars(1, 0.013), 13_000);
  const cfg = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1", ASK_TOPUPS_USD: "1,5,20" });
  assert.deepEqual(cfg.topups, [{ usd: 1, stars: 77, mc: 1_001_000 }, { usd: 5, stars: 385, mc: 5_005_000 }, { usd: 20, stars: 1539, mc: 20_007_000 }]);
  for (const t of cfg.topups) assert.ok(t.mc >= t.usd * 1e6, "a top-up is never worth less than its dollars");
  assert.deepEqual(cfg.missing, []);
});

test("no profit: there is no margin to set above cost, and nothing is missing at cost", () => {
  const atCost = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1" });
  assert.equal(atCost.margin, 1);
  assert.deepEqual(atCost.missing, []);
  // A margin below 1 is taken as 1: a reader is never given less than what the Stars paid out.
  assert.equal(creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "0.5" }).margin, 1);
  // Without the payout per Star nothing can be sold.
  assert.ok(creditConfig({}).missing.some((m) => m.startsWith("ASK_USD_PER_STAR")));
});

test("each call is priced at its model's own rate, with the Unified Billing fee only where it applies", () => {
  const u = { input_tokens: 10000, output_tokens: 1000 };
  const base = (10000 * OPUS.input + 1000 * OPUS.output) / 1e6;
  assert.ok(Math.abs(callUsd(u, OPUS) - base) < 1e-12);
  assert.ok(Math.abs(callUsd(u, OPUS, { fee: 0.05 }) - base * 1.05) < 1e-12);
  assert.equal(viaUnifiedBilling(GLM), false, "Workers AI carries no fee");
  assert.equal(viaUnifiedBilling(OPUS, true), true);
  assert.equal(viaUnifiedBilling(OPUS, false), false, "Claude on Anthropic's own key carries no fee");
  // Chat-completions usage counts cached prompt tokens at the cached rate.
  assert.ok(callUsd({ prompt_tokens: 1000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1000 } }, GLM) <= callUsd({ prompt_tokens: 1000, completion_tokens: 0 }, GLM));
  assert.ok(searchUsd({ embedTokens: 40, vectorQueries: 1, rerankTokens: 12000 }) > 0);
});

test("estimates: the dearest model asks first, the free model never needs to, and no request may cost more than the cap", () => {
  const cfg = creditConfig({ ASK_USD_PER_STAR: "0.013" });
  const opus = estimateMc(OPUS, cfg);
  assert.ok(opus.maxMc > cfg.confirmAboveMc && opus.maxMc <= cfg.maxRequestMc);
  assert.ok(opus.typicalMc < opus.maxMc);
  assert.ok(estimateMc(GLM, cfg).maxMc < cfg.confirmAboveMc);
});

test("the balance is spent oldest first, and an allocation never takes more than is there", () => {
  const lots = [
    { id: 2, kind: "topup", remaining_mc: 500, expires_at: null, created_at: NOW - 1000 },
    { id: 1, kind: "carried", remaining_mc: 300, expires_at: null, created_at: NOW - 5000 },
    { id: 3, kind: "topup", remaining_mc: 0, expires_at: null, created_at: NOW },
  ];
  assert.deepEqual(spendOrder(lots, NOW).map((l) => l.id), [1, 2]);
  assert.deepEqual(allocate(lots, 600, NOW), { take: [{ lot: 1, mc: 300 }, { lot: 2, mc: 300 }], short: 0 });
  assert.deepEqual(allocate(lots, 1000, NOW).short, 200);
  assert.equal(walletOf(lots, NOW).total_mc, 800);
});

test("the old allowance carries over at its exact worth and no longer expires", () => {
  assert.equal(LEGACY_UNIT_MC, 5);
  const lots = migrationLots({ credits: 100000, plan_until: NOW + 86400000, plan_allowance: 50000, plan_used: 10000 }, NOW);
  assert.deepEqual(lots.map((l) => [l.mc, l.expires_at]), [[500000, null], [200000, null]]);
  // An ended plan carries nothing.
  assert.equal(migrationLots({ credits: 0, plan_until: NOW - 1, plan_allowance: 50000, plan_used: 0 }, NOW).length, 0);
});
