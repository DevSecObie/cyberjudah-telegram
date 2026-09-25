import { test } from "node:test";
import assert from "node:assert/strict";
import { verseOfDay, VERSES, bookLabel } from "../src/verse-of-day.mjs";

test("the same date gives the same verse, any time of day", () => {
  const a = verseOfDay(new Date("2026-09-25T00:00:01Z"));
  const b = verseOfDay(new Date("2026-09-25T23:59:59Z"));
  const c = verseOfDay("2026-09-25");
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.match(a.ref, /^[A-Z][A-Za-z ]+ \d+:\d+$/);
});

test("consecutive days walk the list and wrap", () => {
  const day = 86400000;
  const t = Date.UTC(2026, 0, 1);
  const seen = new Set();
  for (let i = 0; i < VERSES.length; i++) seen.add(verseOfDay(new Date(t + i * day)).ref);
  assert.equal(seen.size, VERSES.length);
  assert.deepEqual(verseOfDay(new Date(t)), verseOfDay(new Date(t + VERSES.length * day)));
});

test("the curated references are present", () => {
  const refs = new Set(VERSES.map(([s, c, v]) => `${s} ${c}:${v}`));
  for (const r of ["psalms 119:105", "proverbs 4:7", "isaiah 28:10", "2-timothy 2:15", "revelation 14:12", "hebrews 4:12"]) assert.ok(refs.has(r), r);
  assert.equal(bookLabel("2-timothy"), "2 Timothy");
  assert.equal(bookLabel("song-of-solomon"), "Song of Solomon");
});
