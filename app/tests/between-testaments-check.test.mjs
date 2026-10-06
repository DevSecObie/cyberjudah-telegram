import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * check.mjs reads periods.json, events.json and drafts.json from its own directory, so its
 * refusal to publish under a period with no boundary years is exercised by running a copy of it
 * beside a synthetic data set, two directories below app/ so its relative imports still resolve.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../scripts/between-testaments");
const SCRIPTS = path.resolve(HERE, "../scripts");

const pending = JSON.parse(fs.readFileSync(path.join(SRC, "periods.json"), "utf8"));
const cited = { ...pending, periods: [{ ...pending.periods[0], startYear: -200, endYear: -4, interval: 10 }] };

/** A synthetic published event in the real TimelineShape; the text is a test fixture, not a source. */
const published = () => ({
  slug: "test-published-event", title: "A synthetic test event",
  start: -165, end: -164, date: { text: "test fixture date", precision: "year" },
  period: pending.periods[0].id, group: "Maccabean revolt", summary: "Test fixture summary.",
  account: ["Test fixture account."], sources: [{ title: "Test fixture source", url: "https://example.com/test-fixture" }],
  scriptures: [{ ref: "1 Maccabees 1:54" }], status: "published",
});

function runCheck({ periods, events, drafts = [] }) {
  const dir = fs.mkdtempSync(path.join(SCRIPTS, "btt-check-test-"));
  try {
    fs.copyFileSync(path.join(SRC, "check.mjs"), path.join(dir, "check.mjs"));
    fs.writeFileSync(path.join(dir, "periods.json"), JSON.stringify(periods));
    fs.writeFileSync(path.join(dir, "events.json"), JSON.stringify(events));
    fs.writeFileSync(path.join(dir, "drafts.json"), JSON.stringify(drafts));
    const r = spawnSync(process.execPath, [path.join(dir, "check.mjs")], { encoding: "utf8", env: { ...process.env, CJ_ROOT: "" } });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("check.mjs refuses a published event under a period whose boundary years are still null", () => {
  const { status, out } = runCheck({ periods: pending, events: [published()] });
  assert.equal(status, 1, out);
  assert.match(out, /between-the-testaments: has a published event but no boundary years yet/);
  assert.match(out, /1 event\(s\), 0 draft\(s\), [1-9]\d* problem\(s\)/);
});

test("the same published event passes once the period's boundary years are cited", () => {
  const { status, out } = runCheck({ periods: cited, events: [published()] });
  assert.equal(status, 0, out);
  assert.match(out, /1 event\(s\), 0 draft\(s\), 0 problem\(s\)/);
});
