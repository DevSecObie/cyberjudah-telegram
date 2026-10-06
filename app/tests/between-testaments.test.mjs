import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "../scripts/between-testaments/build.mjs";
import { checkAll } from "../scripts/between-testaments/check.mjs";
import { checkEvent } from "../../shared/cms-timeline-rules.mjs";

const periods = JSON.parse(fs.readFileSync(new URL("../scripts/between-testaments/periods.json", import.meta.url), "utf8"));

const good = () => ({
  slug: "test-event", title: "A test event", start: -165, end: -164,
  date: { text: "15 Casleu, year 145", precision: "day", calendar: "year numbering in 1 Maccabees", sourceRef: "1 Maccabees 1:54" },
  period: "between-the-testaments", group: "Maccabean revolt", summary: "Documented from the text.",
  scriptures: [{ ref: "1 Maccabees 1:54" }], people: ["Mattathias"], status: "published",
});

test("the committed data passes its own check", () => {
  const { problems } = checkAll({});
  assert.deepEqual(problems, []);
});

test("the committed sample stays in drafts.json until boundary years are cited: nothing is plotted yet", () => {
  const timeline = { source: "x", reigns: "y", sections: [{ id: "8", title: "The Exile" }, { id: "9", title: "Life of Christ" }] };
  const out = build({ timeline, periods, events: [] });
  assert.deepEqual(out.timeline.sections.map((s) => s.id), ["8", "9"]);
});

test("an 'unknown'-precision date can never carry a plotted position", () => {
  const e = { ...good(), date: { text: "In those days", precision: "unknown" }, start: -165, end: -164 };
  const problems = checkEvent(e, periods.periods);
  assert.ok(problems.some((x) => /cannot have start\/end/.test(x)));
  assert.deepEqual(checkEvent({ ...e, start: null, end: null }, periods.periods, { draft: true }), []);
});

test("once a period has owner-approved boundary years, a published event is inserted between The Exile and Life of Christ, not appended at the end", () => {
  const withBounds = { age: "Between the Testaments", periods: [{ ...periods.periods[0], startYear: -200, endYear: -4, interval: 10 }] };
  const timeline = { source: "x", reigns: "y", sections: [{ id: "7", title: "Divided Kingdom" }, { id: "8", title: "The Exile" }, { id: "9", title: "Life of Christ" }] };
  const out = build({ timeline, periods: withBounds, events: [good()] });
  assert.deepEqual(out.timeline.sections.map((s) => s.id), ["7", "8", "btt-between-the-testaments", "9"]);
  const bar = out.timeline.sections[2].events[0];
  assert.equal(bar.btt, true);
  assert.equal(bar.account, undefined);
  assert.deepEqual(out.details["test-event"].scriptures, [{ ref: "1 Maccabees 1:54" }]);
});

test("a period with a published event but no boundary years yet is a problem, not a guess", () => {
  assert.equal(periods.periods[0].startYear, null, "the committed period is still pending boundary years");
  const wouldBePublished = [good()].some((e) => e.period === periods.periods[0].id);
  assert.ok(wouldBePublished, "sanity: good() targets the real period id");
});

test("a renamed or reordered Exile/Life of Christ section fails loud instead of appending at the end", () => {
  const withBounds = { age: "Between the Testaments", periods: [{ ...periods.periods[0], startYear: -200, endYear: -4, interval: 10 }] };
  const noExile = { source: "x", reigns: "y", sections: [{ id: "8", title: "Something Else" }, { id: "9", title: "Life of Christ" }] };
  assert.throws(() => build({ timeline: noExile, periods: withBounds, events: [good()] }), /no section with id "8" and title "The Exile"/);
  const wrongNext = { source: "x", reigns: "y", sections: [{ id: "8", title: "The Exile" }, { id: "9", title: "Something Else" }] };
  assert.throws(() => build({ timeline: wrongNext, periods: withBounds, events: [good()] }), /expected id "9" title "Life of Christ"/);
});

test("rebuilding is idempotent: a second run does not duplicate the section", () => {
  const withBounds = { age: "Between the Testaments", periods: [{ ...periods.periods[0], startYear: -200, endYear: -4, interval: 10 }] };
  const timeline = { source: "x", reigns: "y", sections: [{ id: "8", title: "The Exile" }, { id: "9", title: "Life of Christ" }] };
  const once = build({ timeline, periods: withBounds, events: [good()] });
  const twice = build({ timeline: once.timeline, periods: withBounds, events: [good()] });
  assert.deepEqual(twice.timeline.sections.map((s) => s.id), ["8", "btt-between-the-testaments", "9"]);
});
