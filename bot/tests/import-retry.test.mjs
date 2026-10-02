import test from "node:test";
import assert from "node:assert/strict";
import { BUSY_WAITS, importRetryDelay } from "../scripts/import-retry.mjs";

// Regression (deploy run 36915871818, 2026-10-01): the first import dropped ("Not currently
// import at bookmark …"), the one retry 15 s later was refused ("Currently processing a
// long-running import") and the deploy failed with the Worker already live.
test("a busy database is waited out with growing pauses, not one 15 s retry", () => {
  const dropped = "✘ [ERROR] Not currently import at bookmark 00000102-00000000-000050f7-aae6.";
  const busy = "✘ [ERROR] Currently processing a long-running import. Cannot start another import until that completes or times out.";
  assert.equal(importRetryDelay(dropped, 1), 30);
  assert.equal(importRetryDelay(busy, 2), 60);
  const total = BUSY_WAITS.reduce((a, b) => a + b, 0);
  assert.ok(total >= 300, "waits at least five minutes for a running import");
  assert.equal(importRetryDelay(busy, BUSY_WAITS.length), BUSY_WAITS.at(-1));
  assert.equal(importRetryDelay(busy, BUSY_WAITS.length + 1), null, "then gives up, so a stuck import still fails the deploy");
});

test("any other failure is retried once, then fails the deploy", () => {
  assert.equal(importRetryDelay("Authentication error [code: 10000]", 1), 15);
  assert.equal(importRetryDelay("Authentication error [code: 10000]", 2), null);
});
