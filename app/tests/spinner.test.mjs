import assert from "node:assert/strict";
import test from "node:test";
import { SPINNER, spinnerLine, toneOf } from "../src/lib/spinner.ts";

test("the waiting line suits the question: serious for doctrine, the law and judgment, lighter for the app", () => {
  assert.equal(toneOf("Why do we keep the Passover?"), "scripture");
  assert.equal(toneOf("What does the law say about usury?"), "law");
  assert.equal(toneOf("Why did Israel go into captivity?"), "judgment");
  assert.equal(toneOf("Who was Melchizedek?"), "people");
  assert.equal(toneOf("How do I turn on dark mode?"), "app");
  assert.equal(toneOf("Remind me to read every morning"), "time");
  assert.equal(toneOf("When does sabbath start tonight?"), "time");
  assert.equal(toneOf("What did I ask you before about the feasts?"), "memory");
  assert.equal(toneOf("Find my saved chats"), "memory");
  assert.equal(toneOf("Why was Judah carried to Babylon?"), "judgment");
  assert.equal(toneOf("and then?"), "light");
  // Doctrine is the default: when in doubt, serious.
  assert.equal(toneOf("Explain the meaning of the second death in the Scripture"), "scripture");
});

test("the line changes every tick, stays within its tone, and starts at a different place per question", () => {
  const q = "Why do we keep the Passover?";
  const seen = new Set(Array.from({ length: SPINNER.scripture.length }, (_, i) => spinnerLine(q, i)));
  assert.equal(seen.size, SPINNER.scripture.length);
  for (const l of seen) assert.ok(SPINNER.scripture.includes(l));
  assert.notEqual(spinnerLine("Who are the twelve tribes today?", 0), undefined);
  for (const lines of Object.values(SPINNER)) {
    assert.ok(lines.length >= 6, "enough to vary");
    assert.equal(new Set(lines).size, lines.length, "no repeats within a tone");
    for (const l of lines) assert.ok(l.length <= 64 && !/[“”"]/.test(l), l);
  }
});
