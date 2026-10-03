import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadOf, readPayload, readSupport, validPayment } from "../src/billing.mjs";
import { creditConfig } from "../../shared/credits.mjs";

const p = creditConfig({ ASK_USD_PER_STAR: "0.013", ASK_MARGIN: "1.25", ASK_PLAN_STARS: "750", ASK_PACKS: "150,500,1500" });

test("only Stars, at a price on sale, for a real item, count as payment", () => {
  assert.deepEqual(validPayment(payloadOf("plan", 7, 750), "XTR", 750, p), { kind: "plan", uid: 7, stars: 750 });
  assert.deepEqual(validPayment(payloadOf("pack", 7, 1500), "XTR", 1500, p), { kind: "pack", uid: 7, stars: 1500 });
  assert.equal(validPayment(payloadOf("plan", 7, 750), "USD", 750, p), null);
  assert.equal(validPayment(payloadOf("plan", 7, 1), "XTR", 1, p), null);
  assert.equal(validPayment(payloadOf("pack", 7, 999), "XTR", 999, p), null);
  assert.equal(validPayment(payloadOf("pack", 7, 150), "XTR", 100, p), null);
  assert.equal(validPayment("support:7:100", "XTR", 100, p), null);
  assert.equal(readPayload("ask:plan:7:750:extra"), null);
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
