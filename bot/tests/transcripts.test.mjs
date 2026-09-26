import { test } from "node:test";
import assert from "node:assert/strict";
import { batchSql, chunkSegments, dedupeHits, exactExpr, videoOfThumb, words } from "../src/transcripts.mjs";

test("chunks follow the captions: about 45 seconds or 70 words, overlapping by three segments", () => {
  const segs = Array.from({ length: 60 }, (_, i) => [i * 3, `word${i} and some more words here`]);
  const chunks = chunkSegments(segs);
  assert.ok(chunks.length > 3);
  assert.equal(chunks[0].t, 0);
  assert.ok(chunks[0].text.startsWith("word0 and"));
  // The second chunk starts three segments before the first one ended.
  const firstEnd = chunks[0].text.split(" ").filter((w) => /^word\d+$/.test(w)).length;
  assert.ok(chunks[1].text.startsWith(`word${firstEnd - 3} `));
  assert.ok(chunks.every((c) => c.text.split(" ").length <= 70 + 6));
  assert.deepEqual(chunkSegments([]), []);
  assert.deepEqual(chunkSegments([[10, "  "]]), []);
});

test("a chunk's time sits three seconds before its words", () => {
  assert.equal(chunkSegments([[14.64, "bless this is Raleigh"]])[0].t, 11.6);
  assert.equal(chunkSegments([[1, "x"]])[0].t, 0);
});

test("the exact expression is the typed words as one phrase, punctuation and case aside", () => {
  assert.equal(exactExpr("The Most High, God!"), '"the most high god"');
  assert.equal(exactExpr("don't"), '"don t"');
  assert.equal(exactExpr("  "), "");
  assert.deepEqual(words("Matthew 15:24"), ["matthew", "15", "24"]);
});

test("a scripture reference allows the spoken forms: chapter, verse, and, Psalm or Psalms", () => {
  assert.equal(exactExpr("Matthew 15:24", { book: "Matthew", chapter: 15, verse: 24 }), 'NEAR("matthew" "15" "24", 3)');
  assert.equal(exactExpr("ps 23", { book: "Psalms", chapter: 23 }), 'NEAR("psalm"* "23", 3)');
  assert.equal(exactExpr("1 kings 8:22", { book: "1 Kings", chapter: 8, verse: 22 }), 'NEAR("1 kings" "8" "22", 3)');
});

test("hits within a minute of each other in the same recording are one hit", () => {
  const hits = [{ video: "a", t: 10 }, { video: "a", t: 40 }, { video: "a", t: 200 }, { video: "b", t: 12 }];
  assert.deepEqual(dedupeHits(hits).map((h) => `${h.video}@${h.t}`), ["a@10", "a@200", "b@12"]);
});

test("the video id comes out of a thumbnail URL", () => {
  assert.equal(videoOfThumb("https://i.ytimg.com/vi/CiL1d9RUSfE/mqdefault.jpg"), "CiL1d9RUSfE");
  assert.equal(videoOfThumb(""), null);
});

test("a batch replaces its videos' chunks and records the files, quoting safely", () => {
  const sql = batchSql([{ video: "v1", sha: "abc", kind: "class", title: "It's a 'test'", url: "/classes/x", date: "2026-01-01", duration: 10, chunks: [{ t: 0, text: "hello 'world'" }] }]);
  assert.ok(sql[0].startsWith("INSERT INTO transcript_fts(transcript_fts, rowid, text) SELECT 'delete'"));
  assert.ok(sql[1].startsWith("DELETE FROM transcript_chunks WHERE video IN ('v1')"));
  assert.ok(sql[2].includes("('v1',0,'hello ''world''')"));
  assert.ok(sql.at(-1).includes("'It''s a ''test'''"));
  assert.ok(sql.at(-2).startsWith("INSERT INTO transcript_fts(rowid, text) SELECT id, text"));
});
