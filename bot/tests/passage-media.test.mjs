import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, SLUGS } from "../src/passage-media.mjs";

const m = (verses, video, t, teacher, date, label = "A class") => ({ verses, video, t, ts: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`, teacher, date, label });

test("book numbers follow the feed: 66 books, then the Apocrypha in 1611 order", () => {
  assert.equal(SLUGS.length, 81);
  assert.equal(SLUGS[0], "genesis");
  assert.equal(SLUGS[65], "revelation");
  assert.equal(SLUGS[66], "1-esdras");
  assert.equal(SLUGS[70], "esther-greek");
  assert.equal(SLUGS[74], "epistle-of-jeremiah");
  assert.equal(SLUGS[80], "2-maccabees");
});

test("each moment sits after the last verse it taught and opens at its second", () => {
  const cat = buildCatalog(1, 1, [m("26-28", "wTuOGE-zMSs", 738, "Bishop Kani", "2026-07-25", "Listen, Learn & Live")]);
  assert.equal(cat.works.length, 1);
  const [w] = cat.works;
  const after = w.anchors.find((a) => a.placement === "after-range");
  assert.deepEqual([after.verseStart, after.verseEnd, after.chapterEnd], [26, 28, 1]);
  assert.equal(w.editions.en.startSeconds, 738);
  assert.equal(w.editions.en.sourceUrl, "https://www.youtube.com/watch?v=wTuOGE-zMSs&t=738s");
  assert.equal(w.editions.en.badge, "12:18");
  assert.equal(w.editions.en.subtitle, "Bishop Kani · 25 Jul 2026");
  assert.deepEqual(cat.indexes.chapters["1:1"], [w.id]);
});

test("Bishops, then Deacons, then others; newest first within each", () => {
  const cat = buildCatalog(1, 1, [
    m("1", "aaaaaaaaaaa", 1, "Captain Gideon", "2026-09-01"),
    m("1", "bbbbbbbbbbb", 2, "Deacon Malachi", "2025-01-01"),
    m("1", "ccccccccccc", 3, "Bishop Nathanyel", "2024-01-01"),
    m("1", "ddddddddddd", 4, "Deacon Malachi", "2026-01-01"),
  ]);
  assert.deepEqual(cat.works.map((w) => w.editions.en.providerId), ["ccccccccccc", "ddddddddddd", "bbbbbbbbbbb", "aaaaaaaaaaa"]);
});

test("at most six after one verse, but every recording still lists once for the chapter", () => {
  const list = Array.from({ length: 9 }, (_, i) => m("5", `vid${String(i).padStart(8, "0")}`, i, "Captain X", `2026-01-0${i + 1}`));
  const cat = buildCatalog(1, 1, list);
  const after = cat.works.filter((w) => w.anchors.some((a) => a.placement === "after-range"));
  const chapter = cat.works.filter((w) => w.anchors.some((a) => a.placement === "chapter-resources"));
  assert.equal(after.length, 6);
  assert.equal(chapter.length, 9);
});

test("bad video ids, missing times and verseless moments are dropped", () => {
  const cat = buildCatalog(1, 1, [
    m("1", "bad id!", 5, "Bishop A", "2026-01-01"),
    { verses: "1", video: "aaaaaaaaaaa", label: "x" },
    m("", "bbbbbbbbbbb", 5, "Bishop A", "2026-01-01"),
    m("3,5-7", "ccccccccccc", 9, "Bishop A", "2026-01-01"),
  ]);
  assert.equal(cat.works.length, 1);
  const after = cat.works[0].anchors.find((a) => a.placement === "after-range");
  assert.deepEqual([after.verseStart, after.verseEnd], [3, 7]);
});
