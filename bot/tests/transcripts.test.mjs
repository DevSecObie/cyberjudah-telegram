import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkSegments, embedChunkModes, embedMiddleMode, embedTailMode, MIN_WORDS, videoOfThumb } from "../src/transcripts.mjs";

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
  // Seeded (mulberry32), so a failure repeats. Placeholder words from a small vocabulary, so words recur.
  let seed = 7;
  const rand = (n) => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) % n; };
  const vocab = ["the", "and", "of", "a", "word", "said", "here", "x1", "x2", "x3"];
  const lengths = new Set();
  for (let run = 0; run < 500; run++) {
    let t = 0;
    const segs = Array.from({ length: 1 + rand(120) }, () => [t += 1 + rand(6), Array.from({ length: 1 + rand(12) }, () => vocab[rand(vocab.length)]).join(" ")]);
    lengths.add(segs.length);
    const texts = segs.map((s) => s[1]);
    // A chunk is a run when, from some segment, the segments joined in order give exactly its text.
    const isRun = (text) => texts.some((_, a) => { let s = ""; for (let b = a; b < texts.length && s.length < text.length; b++) { s = s ? `${s} ${texts[b]}` : texts[b]; if (s === text) return true; } return false; });
    const chunks = chunkSegments(segs);
    for (const c of chunks) assert.ok(isRun(c.text), `run ${run}: a chunk is not a run of the captions`);
    if (chunks.length) assert.ok(chunks[chunks.length - 1].text.endsWith(texts[texts.length - 1]), `run ${run}: the last words are kept`);
  }
  assert.ok(lengths.size > 80, "the runs cover many caption counts");
});

test("an unknown fold is refused, and the switch reads only \"whole\" (any case or spacing) as on", () => {
  assert.throws(() => chunkSegments([[0, "x"]], { tail: "Legacy" }), /unknown tail mode/);
  assert.deepEqual(chunkSegments([], null), []);
  assert.equal(embedTailMode(" Whole "), "whole");
  assert.equal(embedTailMode("legacy"), "legacy");
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

// Placeholder words. 45 seconds of one-word captions (the chunk closes on time), then a few sparse
// captions, then 45 more seconds of one-word captions: the chunks around the sparse stretch are short.
const sparse = () => [
  ...Array.from({ length: 45 }, (_, t) => [t, `a${t}`]),
  [60, "m1 m2"], [100, "m3"], [130, "m4"],
  ...Array.from({ length: 45 }, (_, k) => [170 + k, `b${k}`]),
];

test("a short chunk in the middle joins the next one, so sparse captions are still found", () => {
  const segs = sparse();
  const chunks = chunkSegments(segs);
  const all = chunks.map((c) => c.text).join(" ").split(" ");
  for (const [, text] of segs) for (const w of text.split(" ")) assert.ok(all.includes(w), `"${w}" is in a chunk`);
  assert.ok(chunks.every((c) => c.text.split(" ").length >= MIN_WORDS));
  // The chunk that took in the short ones holds them from the first; the sparse stretch ran over two
  // minutes, so it keeps its own time, by the words after it.
  const m = chunks.find((c) => c.text.includes("m1"));
  assert.ok(m.text.startsWith("a42 a43 a44 m1 m2"));
  assert.ok(m.t >= 160, `opens by the dense words, not at ${m.t}`);
  // The old rule left the sparse words out.
  const old = chunkSegments(segs, { middle: "drop" }).map((c) => c.text).join(" ").split(" ");
  assert.ok(!old.includes("m3") && !old.includes("m4"));
});

test("a short run of at most 45 seconds opens the chunk it joins; a longer one never moves it back", () => {
  // Placeholder words. A short stretch 36 seconds long: the chunk that takes it in opens where it began.
  const near = [...Array.from({ length: 45 }, (_, t) => [t, `a${t}`]), [80, "m1 m2 m3"], ...Array.from({ length: 30 }, (_, k) => [100 + k, `b${k}`])];
  const m = chunkSegments(near).find((c) => c.text.includes("m1"));
  assert.ok(m.text.startsWith("a42 a43 a44 m1 m2 m3 b0"));
  assert.equal(m.t, 39);
  // Twenty one-word captions a minute apart, then dense words at 20 minutes: those words open at
  // 20 minutes, not at the start of the sparse stretch.
  const far = [...Array.from({ length: 20 }, (_, k) => [k * 60, `s${k}`]), ...Array.from({ length: 80 }, (_, k) => [1200 + k * 0.5, `d${k}`])];
  const chunks = chunkSegments(far);
  const d = chunks.find((c) => c.text.includes("d0"));
  assert.ok(d.t >= 1140, `the dense words open at ${d.t}`);
  for (const c of chunks) assert.ok(!c.text.includes("d0") || c.t >= 1140);
  const all = chunks.map((c) => c.text).join(" ").split(" ");
  for (let k = 0; k < 20; k++) assert.ok(all.includes(`s${k}`), `s${k} is in a chunk`);
});

test("a joined chunk never takes the index id (video and rounded second) of the chunk before", () => {
  // Placeholder words: a short chunk that starts 0.4 seconds after the chunk before it.
  const x = Array.from({ length: 30 }, (_, k) => `x${k}`).join(" "), w = Array.from({ length: 30 }, (_, k) => `w${k}`).join(" ");
  const chunks = chunkSegments([[100, x], [100.4, "y"], [120, "z"], [146, w], [150, "v"]]);
  const ids = chunks.map((c) => Math.round(c.t));
  assert.equal(new Set(ids).size, ids.length, `ids ${ids.join(", ")}`);
  for (const k of ["x0", "y", "z", "w0", "v"]) assert.ok(chunks.some((c) => c.text.split(" ").includes(k)), `"${k}" is in a chunk`);
});

test("in a chain of short chunks the 45-second limit counts from where the whole run began", () => {
  // Placeholder words: dense speech, then one-word captions 40 seconds apart, then dense speech.
  const segs = [...Array.from({ length: 45 }, (_, t) => [t, `a${t}`]), [60, "p"], [100, "q"], [140, "r"], [180, "s"], ...Array.from({ length: 45 }, (_, k) => [200 + k, `b${k}`])];
  const chunks = chunkSegments(segs);
  const p = chunks.find((c) => c.text.split(" ").includes("p"));
  // The run began more than 45 seconds before the chunk that took it in, so that chunk keeps its own time.
  assert.ok(p.t >= 140, `opens at ${p.t}`);
});

test("with the middle fold every caption is in a chunk, unless the recording is too short for any", () => {
  let seed = 11;
  const rand = (n) => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) % n; };
  let dropMissed = 0;
  for (let run = 0; run < 300; run++) {
    // Each caption carries its own tag (c0, c1, ...); gaps of up to 40 seconds make short chunks.
    let t = 0;
    const segs = Array.from({ length: 1 + rand(150) }, (_, k) => [t += 1 + (rand(4) ? rand(4) : rand(40)), [`c${k}`, ...Array.from({ length: rand(6) }, () => "w")].join(" ")]);
    const texts = segs.map((s) => s[1]);
    const isRun = (text) => texts.some((_, a) => { let s = ""; for (let b = a; b < texts.length && s.length < text.length; b++) { s = s ? `${s} ${texts[b]}` : texts[b]; if (s === text) return true; } return false; });
    const tags = (chunks) => new Set(chunks.flatMap((c) => c.text.split(" ").filter((w) => /^c\d+$/.test(w))));
    const chunks = chunkSegments(segs);
    for (const c of chunks) {
      assert.ok(isRun(c.text), `run ${run}: a chunk is not a run of the captions`);
      assert.ok(c.text.split(" ").length >= MIN_WORDS, `run ${run}: a short chunk`);
    }
    if (chunks.length) assert.equal(tags(chunks).size, segs.length, `run ${run}: a caption is in no chunk`);
    else assert.ok(texts.join(" ").split(" ").length < MIN_WORDS, `run ${run}: a recording of ${MIN_WORDS}+ words made no chunk`);
    if (tags(chunkSegments(segs, { middle: "drop" })).size < segs.length) dropMissed++;
  }
  assert.ok(dropMissed > 10, "the runs include recordings the old rule left words out of");
});

test("an unknown middle mode is refused, and the switch reads only \"fold\" (any case or spacing) as on", () => {
  assert.throws(() => chunkSegments([[0, "x"]], { middle: "Fold" }), /unknown middle mode/);
  assert.equal(embedMiddleMode(" FOLD "), "fold");
  assert.equal(embedMiddleMode("drop"), "drop");
});

test("the embedding job keeps the old middle rule until EMBED_CHUNK_MIDDLE=fold, so merging re-embeds nothing", () => {
  assert.equal(embedMiddleMode(undefined), "drop");
  assert.equal(embedMiddleMode(""), "drop");
  assert.equal(embedMiddleMode("on"), "drop");
  // With no short middle chunk, both rules give the same chunks.
  const dense = Array.from({ length: 60 }, (_, i) => [i * 3, `word${i} and some more words here`]);
  assert.deepEqual(chunkSegments(dense, { middle: "drop" }), chunkSegments(dense));
  // The two switches are separate: the old tail fold and the new middle fold together.
  const both = chunkSegments(sparse(), { tail: "legacy", middle: "fold" }).map((c) => c.text).join(" ").split(" ");
  for (const w of ["m1", "m2", "m3", "m4", "b44"]) assert.ok(both.includes(w), `"${w}" is in a chunk`);
});

test("the embedding job folds middle chunks only with the whole-words tail fold too", () => {
  assert.deepEqual(embedChunkModes({}), { tail: "legacy", middle: "drop" });
  assert.deepEqual(embedChunkModes({ EMBED_CHUNK_MIDDLE: "fold" }), { tail: "legacy", middle: "drop" });
  assert.deepEqual(embedChunkModes({ EMBED_CHUNK_TAIL: "whole" }), { tail: "whole", middle: "drop" });
  assert.deepEqual(embedChunkModes({ EMBED_CHUNK_TAIL: "whole", EMBED_CHUNK_MIDDLE: "fold" }), { tail: "whole", middle: "fold" });
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
