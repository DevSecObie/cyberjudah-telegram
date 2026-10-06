import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";
import { donationAmountValid, donationsConfig, payloadOf, readPayload, readSupport, supportPayloadOf, validPayment } from "../src/billing.mjs";
import { creditConfig } from "../../shared/credits.mjs";

// billing.ts reaches the balance store and Telegram, which import one another without file
// extensions (as Workers bundles them), so it is bundled for Node first.
const out = new URL("./.build/billing.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/billing.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { applyDonation, checkout, invoiceFor, invoiceForDonation } = await import(out);

/** A D1 close enough for the donations ledger, backed by real SQLite (so INSERT OR IGNORE's primary-key idempotency is real, not simulated). */
const d1 = () => {
  const db = new DatabaseSync(":memory:");
  const bound = (q, args) => ({
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { changes: Number(r.changes ?? 0) } }; },
    first: async () => db.prepare(q).get(...args) ?? null,
  });
  return {
    prepare: (q) => ({ bind: (...a) => bound(q, a), run: bound(q, []).run, first: bound(q, []).first }),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  };
};

const vars = { ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1", ASK_TOPUPS_USD: "1,5,20" };
const cfg = creditConfig(vars);

test("only Stars, for a top-up on sale, for this person, count as payment; no plan is sold", () => {
  assert.deepEqual(cfg.topups.map((t) => t.stars), [77, 385, 1539]);
  assert.deepEqual(validPayment(payloadOf("pack", 7, 77), "XTR", 77, cfg), { kind: "pack", uid: 7, stars: 77 });
  assert.deepEqual(validPayment(payloadOf("pack", 7, 385, "Europe/London"), "XTR", 385, cfg), { kind: "pack", uid: 7, stars: 385, tz: "Europe/London" });
  assert.equal(validPayment(payloadOf("pack", 7, 77), "USD", 77, cfg), null);
  assert.equal(validPayment(payloadOf("pack", 7, 999), "XTR", 999, cfg), null);
  assert.equal(validPayment(payloadOf("pack", 7, 77), "XTR", 70, cfg), null);
  assert.equal(validPayment(payloadOf("plan", 7, 750), "XTR", 750, cfg), null, "the monthly plan is gone");
  assert.equal(validPayment("support:7:100", "XTR", 100, cfg), null);
  assert.equal(readPayload("ask:pack:7:77:Bad Zone"), null);
  // A renewal of an old plan still reads, so its Stars can be added to the balance.
  assert.deepEqual(readPayload("ask:plan:7:750"), { kind: "plan", uid: 7, stars: 750 });
});

test("a support payload names its giver, its Stars, and — from the Mini App — the giver's zone", () => {
  assert.deepEqual(readSupport("support:7:100"), { uid: 7, stars: 100 });
  assert.deepEqual(readSupport("support:7:999"), { uid: 7, stars: 999 });
  assert.deepEqual(readSupport(supportPayloadOf(7, 100, "Europe/London")), { uid: 7, stars: 100, tz: "Europe/London" });
  assert.deepEqual(readSupport("support:7:100"), { uid: 7, stars: 100 }, "no tz: the /support bot command, which does not know one");
  assert.equal(readSupport("support:7"), null);
  assert.equal(readSupport("support:7:100:9bad"), null, "a zone must start with a letter");
  assert.equal(readSupport("ask:plan:7:750"), null);
});

test("donationsConfig: on by default, a dollar-free giver's amount within its bounds", () => {
  const on = donationsConfig({});
  assert.equal(on.on, true);
  assert.equal(on.min, 1);
  assert.equal(on.max, null);
  assert.deepEqual(on.presets, [50, 100, 500]);
  assert.equal(on.url, null);
  const off = donationsConfig({ DONATIONS_ON: "off" });
  assert.equal(off.on, false);
  const bounded = donationsConfig({ DONATE_MIN_STARS: "10", DONATE_MAX_STARS: "1000", DONATION_URL: "https://give.example/cyberjudah" });
  assert.equal(bounded.min, 10);
  assert.equal(bounded.max, 1000);
  assert.equal(bounded.url, "https://give.example/cyberjudah");
  assert.equal(donationAmountValid(9, bounded), false);
  assert.equal(donationAmountValid(10, bounded), true);
  assert.equal(donationAmountValid(1000, bounded), true);
  assert.equal(donationAmountValid(1001, bounded), false);
  assert.equal(donationAmountValid(1.5, bounded), false, "a whole number of Stars only");
});

// Friday 30 October 2026, 9:30 pm in New York (after full dark), and the Wednesday before at noon.
const FRIDAY_NIGHT = Date.parse("2026-10-31T01:30:00Z");
const WEDNESDAY = Date.parse("2026-10-28T16:00:00Z");

test("the check before Telegram takes the Stars refuses a top-up during the Sabbath where the reader is, kindly", () => {
  const env = { ...vars };
  const pay = payloadOf("pack", 7, 77, "America/New_York");
  assert.deepEqual(checkout(env, pay, "XTR", 77, 7, WEDNESDAY), { ok: true });
  const r = checkout(env, pay, "XTR", 77, 7, FRIDAY_NIGHT);
  assert.equal(r.ok, false);
  assert.equal(r.message, "Top-ups pause for the Sabbath — they open again after dark on Saturday. Your balance can still be used meanwhile.");
  // Someone else's invoice, or a changed price, is refused as before.
  assert.equal(checkout(env, pay, "XTR", 77, 8, WEDNESDAY).ok, false);
  assert.equal(checkout(env, pay, "XTR", 70, 7, WEDNESDAY).ok, false);
  // Without the payout per Star nothing is sold.
  assert.equal(checkout({}, pay, "XTR", 77, 7, WEDNESDAY).ok, false);
});

test("a donation pauses the same way a top-up does, in the giver's own zone", () => {
  const env = {};
  // No zone in the payload (the /support bot command): falls back to DEFAULT_ZONE (America/New_York), paused at FRIDAY_NIGHT there.
  assert.deepEqual(checkout(env, "support:7:100", "XTR", 100, 7, WEDNESDAY), { ok: true });
  const r = checkout(env, "support:7:100", "XTR", 100, 7, FRIDAY_NIGHT);
  assert.equal(r.ok, false);
  assert.equal(r.message, "Giving pauses for the Sabbath — it opens again after dark on Saturday");
  // A zone far enough west that it is not yet the Sabbath there: not paused at the same instant.
  const pacific = supportPayloadOf(7, 100, "Pacific/Honolulu");
  assert.deepEqual(checkout(env, pacific, "XTR", 100, 7, FRIDAY_NIGHT), { ok: true });
  // Someone else's invoice, a changed price, or an amount outside the configured bounds is refused.
  assert.equal(checkout(env, "support:7:100", "XTR", 100, 8, WEDNESDAY).ok, false);
  assert.equal(checkout(env, "support:7:100", "XTR", 90, 7, WEDNESDAY).ok, false);
  assert.equal(checkout({ DONATE_MAX_STARS: "50" }, "support:7:100", "XTR", 100, 7, WEDNESDAY).ok, false);
  assert.equal(checkout({ DONATIONS_ON: "off" }, "support:7:100", "XTR", 100, 7, WEDNESDAY).ok, false);
});

test("no invoice is made during the Sabbath: the reader is told when top-ups open again", async () => {
  const r = await invoiceFor({ ...vars, BOT_TOKEN: "1:x" }, 7, "pack:77", "America/New_York", FRIDAY_NIGHT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pause");
  assert.equal(r.message, "Top-ups pause for the Sabbath — they open again after dark on Saturday");
  const closed = await invoiceFor({ BOT_TOKEN: "1:x" }, 7, "pack:77", "America/New_York", WEDNESDAY);
  assert.equal(closed.reason, "closed");
});

test("no donation invoice is made during the Sabbath, when donations are off, or for an out-of-bounds amount", async () => {
  const env = { BOT_TOKEN: "1:x" };
  const r = await invoiceForDonation(env, 7, 100, "America/New_York", FRIDAY_NIGHT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pause");
  assert.equal(r.message, "Giving pauses for the Sabbath — it opens again after dark on Saturday");
  const off = await invoiceForDonation({ ...env, DONATIONS_ON: "off" }, 7, 100, "America/New_York", WEDNESDAY);
  assert.deepEqual(off, { ok: false, reason: "closed" });
  const bad = await invoiceForDonation(env, 7, 0, "America/New_York", WEDNESDAY);
  assert.deepEqual(bad, { ok: false, reason: "bad-amount" });
  // The link itself (a real Telegram call) is exercised by the end-to-end suite's loopback stand-in.
});

test("a gift is recorded once per Telegram charge, under the giver's pseudonymous id, never added to the Ask balance, and ignores a payload that is not a donation", async () => {
  const env = { DB: d1(), PRIVACY_KEY: "test-key" };
  const pay = (charge) => ({ invoice_payload: "support:7:100", currency: "XTR", total_amount: 100, telegram_payment_charge_id: charge });
  assert.deepEqual(await applyDonation(env, 7, pay("ch_1")), { stars: 100 });
  // The same Telegram charge delivered twice (a retried webhook) is recorded once.
  assert.deepEqual(await applyDonation(env, 7, pay("ch_1")), { stars: 100 });
  const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM donations WHERE charge_id = ?").bind("ch_1").first();
  assert.equal(rows.n, 1);
  // Never the raw Telegram id (privacy.mjs pid, the same convention as payments and credit_ledger).
  const row = await env.DB.prepare("SELECT user_id FROM donations WHERE charge_id = ?").bind("ch_1").first();
  assert.notEqual(row.user_id, "7");
  assert.equal(row.user_id.length, 22);
  // A different giver, a different charge, or a price mismatch is kept apart.
  assert.deepEqual(await applyDonation(env, 7, pay("ch_2")), { stars: 100 });
  assert.equal(await applyDonation(env, 8, pay("ch_3")), null, "the charge's payload names a different giver");
  assert.equal(await applyDonation(env, 7, { ...pay("ch_4"), total_amount: 90 }), null, "the amount paid must match the payload");
  // Not a donation at all (a top-up pack): applyDonation leaves it alone.
  assert.equal(await applyDonation(env, 7, { invoice_payload: "ask:pack:7:77", currency: "XTR", total_amount: 77, telegram_payment_charge_id: "ch_5" }), null);
});
