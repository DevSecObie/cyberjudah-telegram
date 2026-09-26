import { test } from "node:test";
import assert from "node:assert/strict";
import { CLOSE, OPEN, passageExcerpt, runs } from "../src/teachings.mjs";

test("the excerpt sits around the first match and the video opens at that caption", () => {
  const words = Array.from({ length: 120 }, (_, i) => `w${i}`);
  words[60] = `${OPEN}Seattle${CLOSE}`;
  const marked = words.join(" ");
  const cues = JSON.stringify([[0, 10], [200, 50], [400, 90]]);
  const r = passageExcerpt(marked, cues, 5);
  assert.ok(r.excerpt.startsWith("… w48 "));
  assert.ok(r.excerpt.includes(`${OPEN}Seattle${CLOSE}`));
  assert.ok(r.excerpt.endsWith(" …"));
  assert.equal(r.timing, "caption");
  assert.equal(r.start, 50);
});

test("without cue offsets the passage start is kept", () => {
  const r = passageExcerpt(`a ${OPEN}b${CLOSE} c`, null, 33);
  assert.deepEqual(r, { excerpt: `a ${OPEN}b${CLOSE} c`, start: 33, timing: "passage" });
});

test("runs split the marks out for rendering", () => {
  assert.deepEqual(runs(`x ${OPEN}y${CLOSE} z`), [{ text: "x ", match: false }, { text: "y", match: true }, { text: " z", match: false }]);
});
