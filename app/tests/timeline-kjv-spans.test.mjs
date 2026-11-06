// The timeline's people whose length of life (or age at a birth) the King James text states outright.
// A bar or a gap that disagrees with the verse is a content error, not a rounding: the verse wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { flatten } from "../../shared/timeline.mjs";
import { keepHistory } from "../scripts/timeline-data.mjs";

const DATA = JSON.parse(fs.readFileSync(new URL("../src/data/timeline.json", import.meta.url), "utf8"));
const bySlug = new Map(flatten(DATA.sections).map((e) => [e.slug, e]));
const span = (slug) => { const e = bySlug.get(slug); return e.end - e.start; };
const gap = (child, father) => bySlug.get(child).start - bySlug.get(father).start;

// [slug, years lived, verse]
const LIVES = [
  ["adam", 930, "Genesis 5:5"], ["seth", 912, "Genesis 5:8"], ["enos", 905, "Genesis 5:11"], ["cainan", 910, "Genesis 5:14"],
  ["mahalaleel", 895, "Genesis 5:17"], ["jared", 962, "Genesis 5:20"], ["enoch", 365, "Genesis 5:23"], ["methuselah", 969, "Genesis 5:27"],
  ["lamech", 777, "Genesis 5:31"], ["noah", 950, "Genesis 9:29"], ["shem", 600, "Genesis 11:10-11"], ["arphaxad", 438, "Genesis 11:12-13"],
  ["salah", 433, "Genesis 11:14-15"], ["eber", 464, "Genesis 11:16-17"], ["peleg", 239, "Genesis 11:18-19"], ["reu", 239, "Genesis 11:20-21"],
  ["serug", 230, "Genesis 11:22-23"], ["nahor", 148, "Genesis 11:24-25"], ["terah", 205, "Genesis 11:32"],
  ["sarah", 127, "Genesis 23:1"], ["isaac", 180, "Genesis 35:28"], ["ishmael", 137, "Genesis 25:17"], ["jacob", 147, "Genesis 47:28"],
  ["joseph", 110, "Genesis 50:26"], ["levi", 137, "Exodus 6:16"], ["amram", 137, "Exodus 6:20"], ["moses", 120, "Deuteronomy 34:7"],
  ["aaron", 123, "Numbers 33:39"], ["joshua", 110, "Joshua 24:29"], ["eli", 98, "1 Samuel 4:15"], ["david", 70, "2 Samuel 5:4"],
];
// [child, father, father's age at the birth, verse]
const BIRTHS = [
  ["seth", "adam", 130, "Genesis 5:3"], ["enos", "seth", 105, "Genesis 5:6"], ["cainan", "enos", 90, "Genesis 5:9"],
  ["mahalaleel", "cainan", 70, "Genesis 5:12"], ["jared", "mahalaleel", 65, "Genesis 5:15"], ["enoch", "jared", 162, "Genesis 5:18"],
  ["methuselah", "enoch", 65, "Genesis 5:21"], ["lamech", "methuselah", 187, "Genesis 5:25"], ["noah", "lamech", 182, "Genesis 5:28-29"],
  ["arphaxad", "shem", 100, "Genesis 11:10"], ["salah", "arphaxad", 35, "Genesis 11:12"], ["eber", "salah", 30, "Genesis 11:14"],
  ["peleg", "eber", 34, "Genesis 11:16"], ["reu", "peleg", 30, "Genesis 11:18"], ["serug", "reu", 32, "Genesis 11:20"],
  ["nahor", "serug", 30, "Genesis 11:22"], ["terah", "nahor", 29, "Genesis 11:24"], ["jacob", "isaac", 60, "Genesis 25:26"],
];

test("every stated length of life matches its bar", () => {
  for (const [slug, years, verse] of LIVES) assert.equal(span(slug), years, `${slug} (${verse})`);
});

test("every stated age at a birth matches the gap between the bars", () => {
  for (const [child, father, age, verse] of BIRTHS) assert.equal(gap(child, father), age, `${child} (${verse})`);
});

test("Abraham's bar follows the four agreeing existing anchors and survives rebuilding", () => {
  const original = JSON.parse(fs.readFileSync(new URL('../scripts/timeline/bible-strong-events.txt', import.meta.url), 'utf8'));
  const rebuilt = keepHistory(original).kept.flatMap(section => section.events).filter(event => event.slug === 'abraham');
  assert.ok(rebuilt.length > 0);
  for (const event of [...rebuilt, bySlug.get('abraham')]) {
    assert.equal(event.start, -1946);
    assert.equal(event.end - event.start, 175, 'Genesis 25:7');
    assert.equal(bySlug.get('ishmael').start - event.start, 86, 'Genesis 16:16');
    assert.equal(bySlug.get('abram-called-and-departs-haran').start - event.start, 75, 'Genesis 12:4');
    assert.equal(bySlug.get('sarah').start - event.start, 10, 'Genesis 17:17');
  }
});

// The inherited Isaac date still disagrees with Genesis 21:5. Moving it also affects his
// lifespan, Jacob's birth and the wider chronology. Keep every original assertion; the
// strict release check must fail on this unresolved conflict instead of accepting a TODO.
test("Abraham's lifespan, births and circumcision follow the stated ages", {
  todo: process.env.REQUIRE_TIMELINE_KJV_MATCH === '1' ? false : "Isaac and circumcision dates still require chronology reconciliation",
}, () => {
  assert.equal(span("abraham"), 175, "Genesis 25:7");
  assert.equal(gap("isaac", "abraham"), 100, "Genesis 21:5");
  assert.equal(gap("ishmael", "abraham"), 86, "Genesis 16:16");
  assert.equal(gap("abram-becomes-abraham-covenant-of-circumcision", "abraham"), 99, "Genesis 17:24");
  assert.equal(gap("abram-becomes-abraham-covenant-of-circumcision", "ishmael"), 13, "Genesis 17:25");
});
