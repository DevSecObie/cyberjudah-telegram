import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const safe = value => String(value ?? "unknown").replace(/[&<>|\r\n]/g, " ").slice(0, 180);
/** Counts and test names only: never include error payloads, launch proofs or answer text. */
export function smokeSummary(report, outcome, shard) {
  const lines = [`## Live smoke shard ${safe(shard)}`, "", `Journey step: **${safe(outcome || "not run")}**.`, ""];
  if (!report || !report.stats || typeof report.stats !== "object" || !Array.isArray(report.suites)) {
    lines.push("**No complete Playwright report was produced.** Check setup, cancellation and the journey-step logs; this is not a passing smoke check.");
    return { ok: false, markdown: lines.join("\n") + "\n" };
  }
  const stats = report.stats;
  const count = key => Number.isSafeInteger(stats[key]) && stats[key] >= 0 ? stats[key] : 0;
  lines.push(`Passed: ${count("expected")}; failed: ${count("unexpected")}; flaky: ${count("flaky")}; skipped: ${count("skipped")}.`, "");
  let interrupted = false;
  const failed = [];
  const walk = suites => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        const results = (spec.tests ?? []).map(test => test.results?.at(-1)).filter(Boolean);
        if (results.some(result => ["timedOut", "interrupted"].includes(result.status))) interrupted = true;
        if (spec.ok === false && failed.length < 10) failed.push(`${safe(spec.file ?? suite.file)}: ${safe(spec.title)}`);
      }
      walk(suite.suites ?? []);
    }
  };
  walk(report.suites);
  const globalErrors = Array.isArray(report.errors) && report.errors.length > 0;
  if (globalErrors || interrupted) lines.push("**A runner error, timeout or interruption occurred.** The 28-minute Playwright limit is below the 30-minute step and 35-minute job limits so reporting can finish.", "");
  if (failed.length) lines.push("Failed journeys:", "", ...failed.map(name => `- ${name}`), "");
  lines.push("Traces, screenshots and the JSON report are in this shard's artifact. Shards are serialized to protect the shared synthetic account.");
  const ok = outcome === "success" && count("unexpected") === 0 && !globalErrors && !interrupted && (count("expected") + count("flaky")) > 0;
  return { ok, markdown: lines.join("\n") + "\n" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let report;
  try { report = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { /* Always report missing or invalid output. */ }
  const result = smokeSummary(report, process.env.SMOKE_OUTCOME, process.env.SMOKE_SHARD);
  const destination = path.join(path.dirname(process.argv[2]), "live-smoke-summary.md");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, result.markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown);
  console.log(result.markdown);
  if (!result.ok) process.exitCode = 1;
}
