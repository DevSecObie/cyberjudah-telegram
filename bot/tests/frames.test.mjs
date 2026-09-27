import { test } from "node:test";
import assert from "node:assert/strict";
import { extractStoryboard, locate, parseStoryboard, pickLevel, publicLevel } from "../src/frames.mjs";

const SPEC = "https://i.ytimg.com/sb/abc123/storyboard3_L$L/$N.jpg?sqp=xyz|48#27#100#10#10#0#default#rs$A|80#45#916#10#10#10000#M$M#rs$B|160#90#916#5#5#10000#M$M#rs$C";

test("the spec becomes levels with sheet counts and signed sheet URLs", () => {
  const levels = parseStoryboard(SPEC, 9160);
  assert.equal(levels.length, 3);
  const l2 = levels[2];
  assert.equal(l2.w, 160); assert.equal(l2.rows, 5); assert.equal(l2.cols, 5);
  assert.equal(l2.sheets, Math.ceil(916 / 25));
  assert.equal(Math.round(l2.interval * 100) / 100, 10);
  assert.equal(l2.url(3), "https://i.ytimg.com/sb/abc123/storyboard3_L2/M3.jpg?sqp=xyz&sigh=rs$C");
  assert.equal(levels[0].url(0), "https://i.ytimg.com/sb/abc123/storyboard3_L0/default.jpg?sqp=xyz&sigh=rs$A");
  assert.ok(!("url" in publicLevel(l2)));
});

test("without the length the spec's millisecond field gives the interval", () => {
  const [, l1] = parseStoryboard(SPEC);
  assert.equal(l1.interval, 10);
});

test("a moment lands on its sheet and cell", () => {
  const [, , l2] = parseStoryboard(SPEC, 9160);
  assert.deepEqual(locate(l2, 0), { sheet: 0, row: 0, col: 0, frame: 0 });
  assert.deepEqual(locate(l2, 597), { sheet: 2, row: 1, col: 4, frame: 59 });
  assert.equal(locate(l2, 99999).frame, 915);
});

test("the level is picked by width", () => {
  const levels = parseStoryboard(SPEC, 9160);
  assert.equal(pickLevel(levels, 120).w, 160);
  assert.equal(pickLevel(levels, 60).w, 80);
  assert.equal(pickLevel(levels, 999).w, 160);
});

test("the spec and length come out of a watch page", () => {
  const html = `x"videoDetails":{"videoId":"abc123","lengthSeconds":"9160"}y"playerStoryboardSpecRenderer":{"spec":"https://i.ytimg.com/sb/abc123/storyboard3_L$L/$N.jpg?sqp=xyz\\u0026sig=1|48#27#100#10#10#0#default#rs$A"}z`;
  const got = extractStoryboard(html);
  assert.equal(got.duration, 9160);
  assert.ok(got.spec.includes("?sqp=xyz&sig=1|48#27"));
  assert.equal(extractStoryboard("nothing"), null);
});
