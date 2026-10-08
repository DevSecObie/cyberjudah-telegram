import { test } from "node:test";
import assert from "node:assert/strict";
import { providerFailures } from "../scripts/diagnose-staging.mjs";
test("staging diagnostics discard credentials and unrelated readers' logs", () => {
  const event = { event: { request: { headers: { authorization: "PRIVATE-LAUNCH-DATA", "x-release-check": "this-check" } } }, logs: [
    { message: [JSON.stringify({ event: "search_answer_failed", message: "Provider unavailable" })] },
    { message: [JSON.stringify({ event: "other", message: "PRIVATE-READER-TEXT" })] },
  ] };
  assert.deepEqual(providerFailures(event, "another-check"), []);
  assert.deepEqual(providerFailures(event, "this-check"), ["Provider unavailable"]);
  assert.deepEqual(providerFailures({}, "this-check"), []);
});
