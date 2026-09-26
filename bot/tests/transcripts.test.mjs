import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSegments, videoOfThumb } from "../src/transcripts.mjs";

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

test("scraps are never chunks: a short tail joins the chunk before, a short only chunk is left out", () => {
  assert.deepEqual(chunkSegments([[0, "do"], [2, "do do"]]), []);
  const segs = [...Array.from({ length: 14 }, (_, i) => [i * 3, `word${i} two three four five six`]), [60, "do"], [62, "yeah"]];
  const chunks = chunkSegments(segs);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((c) => c.text.split(" ").length >= 25));
  assert.ok(chunks[chunks.length - 1].text.endsWith("do yeah"));
});

test("a chunk's time sits three seconds before its words", () => {
  const long = "bless this is Raleigh and we had a first edition of the class with everyone here today and more words to make it twenty five words";
  assert.equal(chunkSegments([[14.64, long]])[0].t, 11.6);
  assert.equal(chunkSegments([[1, long]])[0].t, 0);
});

test("the video id comes out of a thumbnail URL", () => {
  assert.equal(videoOfThumb("https://i.ytimg.com/vi/CiL1d9RUSfE/mqdefault.jpg"), "CiL1d9RUSfE");
  assert.equal(videoOfThumb(""), null);
});

