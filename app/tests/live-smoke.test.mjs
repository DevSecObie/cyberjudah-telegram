import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { smokeSummary } from "../scripts/summarize-live-smoke.mjs";

const report = overrides => ({ stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 1 }, suites: [], errors: [], ...overrides });
test("smoke summary fails closed on missing output, runner timeouts and incomplete journeys", () => {
  assert.equal(smokeSummary(report(), "success", "1/4").ok, true);
  assert.match(smokeSummary(undefined, "skipped", "2/4").markdown, /No complete Playwright report/);
  for (const value of [undefined, {}, report({ stats: null }), report({ stats: { expected: 0 } }), report({ errors: [{ message: "private fixture payload" }] }), report({ suites: [{ specs: [{ ok: false, title: "Bounded journey", tests: [{ results: [{ status: "timedOut", error: { message: "private fixture payload" } }] }] }] }] })]) {
    const result = smokeSummary(value, "success", "1/4");
    assert.equal(result.ok, false);
    assert.ok(!result.markdown.includes("private fixture payload"));
  }
  assert.equal(smokeSummary(report(), "cancelled", "1/4").ok, false);
  const flaky = report({ stats: { expected: 0, unexpected: 0, flaky: 1, skipped: 0 }, suites: [{ specs: [{ ok: true, tests: [{ results: [{ status: "timedOut" }, { status: "passed" }] }] }] }] });
  assert.equal(smokeSummary(flaky, "success", "1/4").ok, true, "keep the existing visible-flaky retry policy");
});

test("the always-run summary writes a visible failure even when Playwright never produced JSON", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-smoke-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const summary = path.join(dir, "github.md");
  const result = spawnSync(process.execPath, [new URL("../scripts/summarize-live-smoke.mjs", import.meta.url).pathname, path.join(dir, "absent.json")], { env: { ...process.env, GITHUB_STEP_SUMMARY: summary, SMOKE_OUTCOME: "failure", SMOKE_SHARD: "3/4" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(fs.readFileSync(summary, "utf8"), /No complete Playwright report/);
  assert.match(fs.readFileSync(path.join(dir, "live-smoke-summary.md"), "utf8"), /shard 3\/4/);
});

test("the live workflow serializes shared-account shards and leaves time to report failures", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/live-smoke.yml", import.meta.url), "utf8");
  assert.match(workflow, /max-parallel: 1\n/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  const jobMinutes = Number(/timeout-minutes: (\d+)/.exec(workflow)[1]);
  const journeyMinutes = Number(/id: journeys[\s\S]*?timeout-minutes: (\d+)/.exec(workflow)[1]);
  const runnerMinutes = Number(/--global-timeout=(\d+)/.exec(workflow)[1]) / 60000;
  assert.ok(runnerMinutes < journeyMinutes && journeyMinutes < jobMinutes);
  assert.match(workflow, /Summarize production user journeys\n        if: always\(\)/);
  assert.match(workflow, /Upload Playwright traces\n        if: always\(\)/);
  assert.match(workflow, /name: live-smoke-\$\{\{ github.run_id \}\}-\$\{\{ matrix.shard \}\}/);
});
