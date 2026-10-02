import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateLabel, dateMarks, flatten, geometry, hasDetails, linkedEvents, rowToPx, searchEvents } from "../../shared/timeline.mjs";

const DATA = JSON.parse(fs.readFileSync(new URL("../src/data/timeline.json", import.meta.url), "utf8"));
const first = DATA.sections[0];

test("dates read as Bible Strong writes them", () => {
  assert.equal(calculateLabel(-3954, -3024), "3954-3024 BC (930)");
  assert.equal(calculateLabel(-853, -853), "853 BC");
  assert.equal(calculateLabel(-4, 30), "4 BC to 30");
  assert.equal(calculateLabel(-814, -798), "814-798 BC");
  assert.equal(calculateLabel(70, 70), "70");
});

test("the canvas is laid out with their constants: 100/interval px a year, 24 rows, 200px minimum", () => {
  const g = geometry({ startYear: -4100, endYear: -2900, interval: 100 }, 390);
  assert.equal(g.scrollViewWidth, 1200);
  assert.equal(g.width, 1200 + 390);
  assert.equal(g.offset, 156);
  assert.equal(g.yearsToPx(-4100), 0);
  assert.equal(g.yearsToPx(-2900), 1200);
  assert.equal(g.eventWidth(-3954, -3024), 930);
  assert.equal(g.eventWidth(-3000, -2990), 200, "short events are 200px");
  assert.equal(rowToPx(11), 50 + 11 * 40);
  // The year under the line: at rest the line stands at 40% of the screen.
  assert.equal(g.yearAt(0), "3944 BC");
  assert.equal(g.yearAt(1200), "2900 BC", "clamped at the end of the period");
  assert.equal(g.progress(0), 0);
  assert.equal(g.progress(1200), 100);
  assert.deepEqual(dateMarks({ startYear: -4100, endYear: -3800, interval: 100 }), [-4100, -4000, -3900]);
  assert.equal(geometry({ startYear: 1840, endYear: 3100, interval: 25 }, 390, 2026).yearAt(2000), "Future");
});

test("the data keeps their history and leaves out their prophetic teaching", () => {
  assert.equal(DATA.sections.length, 12);
  assert.ok(!DATA.sections.some((s) => s.title === "Revelation Prophecies"));
  const titles = DATA.sections.flatMap((s) => s.events.map((e) => e.title));
  for (const t of ["2300 Day Prophecy", "1260 Day Prophecy", "The Two Beasts of Revelation 13", "Church of Laodicea, Age of Judgment"]) assert.ok(!titles.includes(t), t);
  assert.ok(titles.includes("Isaiah Prophecy Concerning Cyrus II"), "a prophecy that is an event in the text stays");
  // No pictures or links from their servers: the only link is the Who's Who citation.
  const hosts = [...JSON.stringify(DATA).matchAll(/https?:\/\/[^"\s]+/g)].map((m) => new URL(m[0]).hostname);
  assert.deepEqual(hosts, ["archive.org"]);
  assert.ok(!JSON.stringify(first).includes("description"), "no descriptions");
  assert.equal(first.title, "First Generation");
});

test("our case studies are attached only by exact name, and the kings by their reign", () => {
  const all = flatten(DATA.sections);
  const cain = all.find((e) => e.slug === "cain");
  assert.deepEqual(cain.cases.map((c) => c.slug), ["cain"]);
  const isr = all.find((e) => e.slug === "ahaziah-9th-king"), jud = all.find((e) => e.slug === "ahaziah-6th-king");
  assert.deepEqual([isr.reign.kingdom, isr.reign.from, isr.reign.to], ["Israel", 853, 852]);
  assert.deepEqual([jud.reign.kingdom, jud.reign.from], ["Judah", 841]);
  assert.ok(isr.cases.some((c) => c.name === "Ahaziah of Israel") && !jud.cases?.some((c) => c.name === "Ahaziah of Israel"));
  // Another man named Ahab (the son of Kolaiah) is not King Ahab.
  assert.ok(!all.find((e) => e.slug === "ahab").cases.some((c) => c.slug === "ahab-and-zedekiah-in-babylon"));
  assert.equal(hasDetails(cain), true);
  assert.equal(hasDetails({ slug: "x" }), false);
});

test("search and linked events come from the data", () => {
  const found = searchEvents(DATA.sections, "cain");
  assert.ok(found.some((e) => e.slug === "cain"));
  assert.ok(found.every(hasDetails));
  // Rebekah's case study (with Abraham's servant) is on both events: they are linked.
  assert.ok(linkedEvents(DATA.sections, "abraham").some((e) => e.slug === "rebekah"));
  assert.ok(!linkedEvents(DATA.sections, "abraham").some((e) => e.slug === "abraham"));
  assert.deepEqual(linkedEvents(DATA.sections, "cain"), [], "no shared case study, no link");
});
