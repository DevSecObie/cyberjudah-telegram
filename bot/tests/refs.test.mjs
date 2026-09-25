import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseReference, findBook } from "../src/refs.mjs";

const books = JSON.parse(readFileSync(new URL("./fixtures/books.json", import.meta.url), "utf8"));
const ref = (q) => parseReference(q, books);

test("a verse", () => {
  assert.deepEqual(ref("john 3:16"), { book: "John", slug: "john", chapter: 3, verse: 16, label: "John 3:16" });
  assert.equal(ref("John 3.16")?.verse, 16);
});

test("a numbered book with a range", () => {
  assert.deepEqual(ref("1 kings 8:22-27"), { book: "1 Kings", slug: "1-kings", chapter: 8, verse: 22, verseEnd: 27, label: "1 Kings 8:22-27" });
  assert.equal(ref("1kings 8:22")?.slug, "1-kings");
  assert.equal(ref("I Kings 8")?.slug, "1-kings");
  assert.equal(ref("first kings 8")?.slug, "1-kings");
});

test("a whole chapter by abbreviation", () => {
  assert.deepEqual(ref("ps 23"), { book: "Psalms", slug: "psalms", chapter: 23, label: "Psalms 23" });
  assert.equal(ref("Psalm 23")?.slug, "psalms");
  assert.equal(ref("Ps. 23")?.slug, "psalms");
});

test("multi-word names", () => {
  assert.equal(ref("song of solomon 2")?.slug, "song-of-solomon");
  assert.equal(ref("song 2")?.slug, "song-of-solomon");
  assert.equal(ref("wisdom of solomon 7:1")?.slug, "wisdom-of-solomon");
});

test("renumbered aliases and prefixes", () => {
  assert.deepEqual(ref("2 tim 2:15"), { book: "2 Timothy", slug: "2-timothy", chapter: 2, verse: 15, label: "2 Timothy 2:15" });
  assert.equal(ref("2 Tim. 2:15")?.slug, "2-timothy");
  assert.equal(ref("gen 1:1")?.slug, "genesis");
  assert.equal(ref("matt 5")?.slug, "matthew");
  assert.equal(ref("rev 14:12")?.slug, "revelation");
  assert.equal(ref("1 jn 4:8")?.slug, "1-john");
  assert.equal(ref("phil 4:13")?.slug, "philippians");
  assert.equal(ref("philemon 1:4")?.slug, "philemon");
  assert.equal(ref("kings 8")?.slug, "1-kings");
});

test("not a reference", () => {
  assert.equal(ref("unknown 3:16"), null);
  assert.equal(ref("passover"), null);
  assert.equal(ref("john"), null);
  assert.equal(ref("john 99"), null);
  assert.equal(ref("4 kings 8"), null);
  assert.equal(ref("2 genesis 1"), null);
  assert.equal(ref(""), null);
  assert.equal(findBook("", books), null);
});

test("a backwards range is one verse", () => {
  assert.deepEqual(ref("john 3:16-2"), { book: "John", slug: "john", chapter: 3, verse: 16, label: "John 3:16" });
});
