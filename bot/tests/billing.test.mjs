import { test } from "node:test";
import assert from "node:assert/strict";
import { balance, grantPack, grantPlan, payloadOf, pricing, readSupport, reserve, RESERVE_UNITS, spend, unitsOf, validPayment } from "../src/billing.mjs";

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

test("a support payload names its giver and its Stars, nothing else", () => {
  assert.deepEqual(readSupport("support:7:100"), { uid: 7, stars: 100 });
  // The shape is valid for any amount; the tier itself is checkout's job.
  assert.deepEqual(readSupport("support:7:999"), { uid: 7, stars: 999 });
  assert.equal(readSupport("support:7"), null);
  assert.equal(readSupport("support:7:100:extra"), null);
  assert.equal(readSupport("ask:plan:7:750"), null);
  assert.equal(readSupport(""), null);
});

test("takeOf names what a reservation took from each pot", async () => {
  const { takeOf } = await import("../src/billing.mjs");
  let a = grantPack(grantPlan(null, p, NOW + 30 * 86400000, NOW), 150, p);
  a = spend(a, 90000, p, NOW); // 90k of the 100k free used
  const { before, reserved } = reserve(a, p, NOW);
  const take = takeOf(before, reserved);
  // 10k left free, so the 20k reservation takes 10k free + 10k plan.
  assert.deepEqual(take, { free: 10000, plan: 10000, credits: 0 });
  assert.equal(take.free + take.plan + take.credits, RESERVE_UNITS);
});

test("settleTake matches settling against the snapshot, for cheap and costly answers", async () => {
  const { settleTake, takeOf } = await import("../src/billing.mjs");
  const accounts = [
    null, // brand-new
    spend(null, 90000, p, NOW), // almost all free used
    spend(null, 100000, p, NOW), // free exhausted
    grantPack(spend(null, 100000, p, NOW), 150, p), // free exhausted, credit only
    grantPack(grantPlan(spend(null, 100000, p, NOW), p, NOW + 30 * 86400000, NOW), 150, p), // plan + credit
  ];
  for (const before of accounts) {
    const { reserved } = reserve(before, p, NOW);
    const take = takeOf(before, reserved);
    for (const actual of [0, 5000, RESERVE_UNITS, 60000, 200000]) {
      const viaTake = settleTake(reserved, take, actual, p, NOW);
      const viaSnapshot = spend(before, actual, p, NOW);
      assert.deepEqual(viaTake, viaSnapshot, `actual=${actual} take=${JSON.stringify(take)}`);
    }
  }
});

test("settleTake never creates money or negative pots under concurrent spending", async () => {
  const { settleTake, takeOf } = await import("../src/billing.mjs");
  // Two concurrent reservations from one account; the second settles after the first spent more.
  const before = grantPack(grantPlan(null, p, NOW + 30 * 86400000, NOW), 150, p);
  const r1 = reserve(before, p, NOW), r2 = reserve(r1.reserved, p, NOW);
  const take2 = takeOf(r1.reserved, r2.reserved);
  const concurrent = spend(r2.reserved, 50000, p, NOW); // first request settled meanwhile
  const settled = settleTake(concurrent, take2, 5000, p, NOW);
  assert.ok(settled.freeUsed >= 0 && (settled.plan?.used ?? 0) >= 0 && settled.credits >= 0);
  const total = (a) => (a.day === new Date(NOW).toISOString().slice(0, 10) ? p.freeDaily - a.freeUsed : p.freeDaily)
    + (a.plan && a.plan.until > NOW ? a.plan.allowance - a.plan.used : 0) + a.credits;
  // Charged: 20k (r1) + 50k (first settle) + 5k (second settle) = 75k of the starting total.
  assert.equal(total(before) - total(settled), 75000);
});
