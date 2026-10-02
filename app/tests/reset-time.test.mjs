import { test } from "node:test";
import assert from "node:assert/strict";
import { resetTime } from "../src/lib/reset-time.ts";

test("the free allowance comes back at the next UTC midnight, said in the reader's own time", () => {
  const now = new Date("2026-10-02T21:30:00Z");
  assert.equal(resetTime(now, "en-US", "UTC"), "12:00 AM");
  assert.equal(resetTime(now, "en-US", "America/Los_Angeles"), "5:00 PM");
  assert.equal(resetTime(now, "en-GB", "Europe/London"), "1:00");
  // Just before midnight UTC it is still the coming midnight, not the one after.
  assert.equal(resetTime(new Date("2026-10-02T23:59:00Z"), "en-US", "UTC"), "12:00 AM");
});
