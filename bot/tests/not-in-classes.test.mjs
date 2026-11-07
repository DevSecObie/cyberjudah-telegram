import { test } from "node:test";
import assert from "node:assert/strict";
import { notInTheClasses, SYSTEM } from "../src/ai.mjs";

test("nothing found: states the search's limit naturally, with no class named", () => {
  const r = notInTheClasses([{ kind: "note", title: "A note", url: "/n", text: "x" }]);
  assert.match(r.answer, /^I couldn't find enough library material/);
  assert.deepEqual(r.sources, []);
});

test("points only to the closest class moment the search found, as source 1", () => {
  const found = [
    { kind: "note", title: "A note", url: "/n", text: "x" },
    { kind: "spoken", title: "The *Feasts* [Part 2]", url: "/c", video: "abcdefghijk", t: 754, text: "y" },
  ];
  const r = notInTheClasses(found);
  assert.match(r.answer, /^I couldn't find material that answers this directly\./);
  assert.match(r.answer, /\*\*The Feasts Part 2\*\* \[1\]/);
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].n, 1);
  assert.equal(r.sources[0].video, "abcdefghijk");
  assert.equal(r.sources[0].t, 754);
});

test("the prompt distinguishes a missing search result from an untaught subject and names only retrieved sources", () => {
  assert.match(SYSTEM, /A missing search result does not prove the subject has never been discussed/);
  assert.match(SYSTEM, /never name a class, teacher or moment you were not given/);
});

import { withReading } from "../src/ai.mjs";
test("Ask from the reader starts from the open passage, unless the question names its own", () => {
  assert.equal(withReading("What does this mean?", "Genesis 1:3"), "What does this mean?\n\n(I have Genesis 1:3 open in the Bible.)");
  assert.equal(withReading("What does Exodus 12:14 mean?", "Genesis 1:3"), "What does Exodus 12:14 mean?");
  assert.equal(withReading("What does this mean?", undefined), "What does this mean?");
});
