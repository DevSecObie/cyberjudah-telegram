import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { payloadOf, readPayload, readSupport, validPayment } from "../src/billing.mjs";
import { creditConfig } from "../../shared/credits.mjs";

// billing.ts reaches the balance store and Telegram, which import one another without file
// extensions (as Workers bundles them), so it is bundled for Node first.
const out = new URL("./.build/billing.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/billing.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { checkout, invoiceFor } = await import(out);

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

test("a support payload names its giver and its Stars, nothing else", () => {
  assert.deepEqual(readSupport("support:7:100"), { uid: 7, stars: 100 });
  assert.deepEqual(readSupport("support:7:999"), { uid: 7, stars: 999 });
  assert.equal(readSupport("support:7"), null);
  assert.equal(readSupport("support:7:100:extra"), null);
  assert.equal(readSupport("ask:plan:7:750"), null);
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
  // Giving to support the work is not a purchase of Ask: never paused.
  assert.deepEqual(checkout(env, "support:7:100", "XTR", 100, 7, FRIDAY_NIGHT), { ok: true });
  // Without the payout per Star nothing is sold.
  assert.equal(checkout({}, pay, "XTR", 77, 7, WEDNESDAY).ok, false);
});

test("no invoice is made during the Sabbath: the reader is told when top-ups open again", async () => {
  const r = await invoiceFor({ ...vars, BOT_TOKEN: "1:x" }, 7, "pack:77", "America/New_York", FRIDAY_NIGHT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "pause");
  assert.equal(r.message, "Top-ups pause for the Sabbath — they open again after dark on Saturday");
  const closed = await invoiceFor({ BOT_TOKEN: "1:x" }, 7, "pack:77", "America/New_York", WEDNESDAY);
  assert.equal(closed.reason, "closed");
});
