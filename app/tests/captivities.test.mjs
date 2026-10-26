import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { byCaptivity, CAPTIVITIES } from "../../shared/captivities.mjs";
import { geometry } from "../../shared/timeline.mjs";

const DATA = JSON.parse(fs.readFileSync(new URL("../src/data/timeline.json", import.meta.url), "utf8"));
const OUT = byCaptivity(DATA.sections);

/** Bars on a row that run into the next one on it, at a 390px phone. */
const overlaps = (s) => {
  const g = geometry(s, 390), rows = new Map();
  for (const e of s.events) rows.set(e.row, [...(rows.get(e.row) ?? []), e]);
  let n = 0;
  for (const list of rows.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) if (g.yearsToPx(list[i - 1].start) + g.eventWidth(list[i - 1].start, list[i - 1].end, list[i - 1].isFixed) > g.yearsToPx(list[i].start)) n++;
  }
  return n;
};

test("every event is still on the timeline, ordered by the captivities", () => {
  const before = new Set(DATA.sections.flatMap((s) => s.events.map((e) => e.slug)));
  const after = new Set(OUT.flatMap((s) => s.events.map((e) => e.slug)));
  assert.deepEqual([...before].filter((slug) => !after.has(slug)), []);
  assert.equal(new Set(OUT.map((s) => s.id)).size, OUT.length);
});

test("the captivities come in order, each with its periods, after the periods before them", () => {
  const ages = OUT.filter((s) => s.captivity).map((s) => s.captivity);
  assert.deepEqual([...new Set(ages)], CAPTIVITIES.map((c) => c.id));
  for (let i = 1; i < ages.length; i++) assert.ok(CAPTIVITIES.findIndex((c) => c.id === ages[i]) >= CAPTIVITIES.findIndex((c) => c.id === ages[i - 1]));
  const firstCaptive = OUT.findIndex((s) => s.captivity);
  assert.deepEqual(OUT.slice(0, firstCaptive).map((s) => s.id), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.ok(OUT.slice(firstCaptive).every((s) => s.captivity), "nothing after the captivities begin is outside one");
  for (const s of OUT.filter((x) => x.captivity)) assert.equal(s.sectionTitle, CAPTIVITIES.find((c) => c.id === s.captivity).age);
  for (const s of OUT.filter((x) => x.id.startsWith("fc-"))) assert.equal(s.captivity, "american");
});

test("the Exile is cut at the captivities' years, and a cut adds no bar running into another", () => {
  const exile = OUT.filter((s) => s.picture === "8");
  assert.deepEqual(exile.map((s) => s.captivity), ["assyrian", "babylonian", "persian", "greek"]);
  for (const s of exile) for (const e of s.events) assert.ok(e.start <= s.endYear && e.end >= s.startYear, `${e.title} touches ${s.title}`);
  for (const s of OUT.filter((x) => x.picture)) {
    const from = DATA.sections.find((x) => x.id === s.picture);
    assert.ok(overlaps(s) <= overlaps(from), `${s.id}: ${overlaps(s)} overlaps, ${from.id} had ${overlaps(from)}`);
  }
});

test("each captivity names its years and, where the booklet gives them, its prophets and people", () => {
  for (const c of CAPTIVITIES) {
    assert.match(c.years, /\d/);
    assert.ok(c.from < c.to);
  }
  const babylon = CAPTIVITIES.find((c) => c.id === "babylonian");
  assert.deepEqual(babylon.prophets, ["Daniel", "Jeremiah", "Ezekiel", "Habakkuk"]);
  assert.equal(CAPTIVITIES.find((c) => c.id === "american").from, 1492);
});
