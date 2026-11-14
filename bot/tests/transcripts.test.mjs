import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSegments, embedTailMode, videoOfThumb } from "../src/transcripts.mjs";

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

test("a short last chunk joins the one before with every word said, in order, none dropped", () => {
  // Placeholder words. One-word segments for 45 seconds (the chunk closes on time), then a short
  // stretch whose words ("the", "x7") were also said earlier: once dropped, now kept.
  const segs = [...Array.from({ length: 45 }, (_, t) => [t, t % 5 === 0 ? "the" : `x${t}`]), [46, "the new x7 point"], [47, "and the last word"]];
  const chunks = chunkSegments(segs);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, segs.map((s) => s[1]).join(" "));
});

test("every chunk is an unbroken run of the captions, and the last ends on the last words said", () => {
  // Seeded, so a failure repeats. Placeholder words from a small vocabulary, so words recur.
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const vocab = ["the", "and", "of", "a", "word", "said", "here", "x1", "x2", "x3"];
  for (let run = 0; run < 300; run++) {
    let t = 0;
    const segs = Array.from({ length: 1 + rand(80) }, () => [t += 1 + rand(6), Array.from({ length: 1 + rand(12) }, () => vocab[rand(vocab.length)]).join(" ")]);
    const texts = segs.map((s) => s[1]);
    const runs = new Set();
    for (let a = 0; a < texts.length; a++) for (let b = a + 1; b <= texts.length; b++) runs.add(texts.slice(a, b).join(" "));
    const chunks = chunkSegments(segs);
    for (const c of chunks) assert.ok(runs.has(c.text), `run ${run}: a chunk is not a run of the captions`);
    if (chunks.length) assert.ok(chunks[chunks.length - 1].text.endsWith(texts[texts.length - 1]), `run ${run}: the last words are kept`);
  }
});

test("the embedding job keeps the old fold until EMBED_CHUNK_TAIL=whole, so merging re-embeds nothing", () => {
  assert.equal(embedTailMode(undefined), "legacy");
  assert.equal(embedTailMode(""), "legacy");
  assert.equal(embedTailMode("on"), "legacy");
  assert.equal(embedTailMode("whole"), "whole");
  // The old fold, kept as it was: the same placeholder tail loses "the" and "x7" there.
  const segs = [...Array.from({ length: 45 }, (_, t) => [t, t % 5 === 0 ? "the" : `x${t}`]), [46, "the new x7 point"], [47, "and the last word"]];
  assert.ok(chunkSegments(segs, { tail: "legacy" })[0].text.endsWith("x44 new point and last word"));
  assert.ok(chunkSegments(segs)[0].text.endsWith("x44 the new x7 point and the last word"));
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


test("the video behind a thumbnail, YouTube's or the site's local copy", async () => {
  const { videoOfThumb } = await import("../src/transcripts.mjs");
  assert.equal(videoOfThumb("https://i.ytimg.com/vi/CiL1d9RUSfE/mqdefault.jpg"), "CiL1d9RUSfE");
  assert.equal(videoOfThumb("https://data.cyberjudah.io/img/classes/CiL1d9RUSfE.jpg"), "CiL1d9RUSfE");
  assert.equal(videoOfThumb("/img/captains/kw1RCi6Wuzk.jpg"), "kw1RCi6Wuzk");
  assert.equal(videoOfThumb(""), null);
});
