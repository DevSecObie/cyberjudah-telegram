import { test } from "node:test";
import assert from "node:assert/strict";
import { findVisuals, isCue } from "../src/visuals.mjs";

test("a line that points at the screen is a cue; teaching lines are not", () => {
  assert.ok(isCue("Look at this picture right here, this is the map of the migration."));
  assert.ok(isCue("Go to the next slide."));
  assert.ok(isCue("Pull that up on the screen for them."));
  assert.ok(isCue("As you can see, the article says it plainly."));
  assert.ok(!isCue("Let us read from Deuteronomy chapter 28."));
  assert.ok(!isCue("The picture of Christ in Revelation is a warrior."));
});

test("cues close together merge into one visual, a few seconds after the words", () => {
  const v = findVisuals([[10, "Turn to Isaiah 11."], [597, "Look at this map."], [604, "You can see here the islands of the sea."], [1200, "Next slide."], [1300, "Reading on."]]);
  assert.equal(v.length, 2);
  assert.deepEqual(v[0], { t: 602, said: 597, text: "Look at this map. You can see here the islands of the sea." });
  assert.equal(v[1].t, 1205);
});
