import { test } from "node:test";
import assert from "node:assert/strict";
import { balance, grantPack, grantPlan, payloadOf, pricing, reserve, RESERVE_UNITS, spend, unitsOf, validPayment } from "../src/billing.mjs";

const p = pricing({ ASK_USD_PER_MTOK: "5", ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1.3", ASK_FREE_DAILY: "100000", ASK_PLAN_STARS: "750", ASK_PACKS: "150,500" });
const NOW = Date.parse("2026-09-28T12:00:00Z");

test("an answer's units weigh output five times input, and cache reads a tenth", () => {
  assert.equal(unitsOf({ input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 400 }), 1000 + 500 + 100 + 500);
  assert.equal(unitsOf(null), 0);
});

test("a Star buys what it costs, with the margin: plans and packs pay for themselves", () => {
  assert.equal(Math.round(p.unitsPerStar), 2000);
  assert.equal(p.plan.units, 1500000);
  assert.deepEqual(p.packs, [{ stars: 150, units: 300000 }, { stars: 500, units: 1000000 }]);
  const cost = (units) => (units / 1e6) * 5;
  assert.ok(750 * 0.013 >= cost(p.plan.units) * 1.29);
});

test("spending takes today's free allowance first, then the plan, then the credit", () => {
  let a = grantPack(grantPlan(null, p, NOW + 30 * 86400000, NOW), 150, p);
  a = spend(a, 60000, p, NOW);
  assert.deepEqual([a.freeUsed, a.plan.used, a.credits], [60000, 0, 300000]);
  a = spend(a, 80000, p, NOW);
  assert.deepEqual([a.freeUsed, a.plan.used, a.credits], [100000, 40000, 300000]);
  a = spend(a, 1500000, p, NOW);
  assert.deepEqual([a.plan.used, a.credits], [1500000, 260000]);
  assert.equal(balance(a, p, NOW).total, 260000);
});

test("the free allowance comes back each day; an expired plan gives nothing", () => {
  let a = spend(null, 100000, p, NOW);
  assert.equal(balance(a, p, NOW).total, 0);
  assert.equal(balance(a, p, NOW + 86400000).free, 100000);
  a = grantPlan(a, p, NOW + 1000, NOW);
  assert.equal(balance(a, p, NOW + 2000).plan, 0);
  assert.equal(balance(a, p, NOW + 2000).planOn, false);
});

test("a renewal starts the month's allowance afresh", () => {
  let a = grantPlan(null, p, NOW + 30 * 86400000, NOW);
  a = spend(a, 100000 + 700000, p, NOW);
  assert.equal(a.plan.used, 700000);
  a = grantPlan(a, p, NOW + 60 * 86400000, NOW + 30 * 86400000);
  assert.equal(a.plan.used, 0);
});

test("only Stars, at the catalog price, for a real item, count as payment", () => {
  assert.deepEqual(validPayment(payloadOf("plan", 7, 750), "XTR", 750, p), { kind: "plan", uid: 7, stars: 750 });
  assert.equal(validPayment(payloadOf("plan", 7, 750), "USD", 750, p), null);
  assert.equal(validPayment(payloadOf("plan", 7, 1), "XTR", 1, p), null);
  assert.equal(validPayment(payloadOf("pack", 7, 999), "XTR", 999, p), null);
  assert.equal(validPayment(payloadOf("pack", 7, 150), "XTR", 100, p), null);
  assert.equal(validPayment("support:7:100", "XTR", 100, p), null);
});

test("reserve-then-settle meters exactly: the minimum up front, the actual at the end", () => {
  assert.equal(RESERVE_UNITS, 20000);
  const before = grantPack(null, 150, p); // 100000 free a day, 300000 credit
  const r = reserve(before, p, NOW);
  // The reservation takes the minimum from the free allowance first, like any spend.
  assert.equal(balance(r.reserved, p, NOW).total, 400000 - RESERVE_UNITS);
  assert.equal(r.reserved.freeUsed, RESERVE_UNITS);
  // Settling charges the actual units against the snapshot: exact metering, no refund math.
  const settled = spend(r.before, 60000, p, NOW);
  assert.deepEqual([settled.freeUsed, settled.credits], [60000, 300000]);
  // A failed request keeps the reservation: the model was still paid for.
  const failed = spend(r.before, RESERVE_UNITS, p, NOW);
  assert.equal(failed.freeUsed, RESERVE_UNITS);
  assert.deepEqual(failed, r.reserved);
});

test("a reservation never takes more than the balance holds", () => {
  const poor = spend(null, 95000, p, NOW); // 5000 of the free allowance left
  const r = reserve(poor, p, NOW);
  assert.equal(balance(r.reserved, p, NOW).total, 0);
  assert.equal(r.reserved.freeUsed, 100000);
  const empty = reserve(spend(null, 100000, p, NOW), p, NOW);
  assert.equal(balance(empty.reserved, p, NOW).total, 0);
});
