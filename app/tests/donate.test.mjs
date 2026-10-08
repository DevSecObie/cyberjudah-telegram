import assert from "node:assert/strict";
import test from "node:test";
import { parseDonationAmount } from "../src/lib/donate.ts";

test("a custom amount names Stars only when it is a whole number within the server's own bounds", () => {
  const bounds = { minStars: 1, maxStars: null };
  assert.equal(parseDonationAmount("250", bounds), 250);
  assert.equal(parseDonationAmount("", bounds), null);
  assert.equal(parseDonationAmount("  ", bounds), null);
  assert.equal(parseDonationAmount("0", bounds), null);
  assert.equal(parseDonationAmount("-5", bounds), null);
  assert.equal(parseDonationAmount("1.5", bounds), null);
  assert.equal(parseDonationAmount("abc", bounds), null);
  assert.equal(parseDonationAmount("1", bounds), 1);
});

test("a maximum, when the owner sets one, refuses an amount above it but not the amount itself", () => {
  const bounds = { minStars: 1, maxStars: 1000 };
  assert.equal(parseDonationAmount("1000", bounds), 1000);
  assert.equal(parseDonationAmount("1001", bounds), null);
  assert.equal(parseDonationAmount("999999", { minStars: 1, maxStars: null }), 999999);
});
