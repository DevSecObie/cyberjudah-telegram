import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, chunkRecord, citations, dedupeMatches, docRecord, hash } from "../src/ai.mjs";

test("records have stable ids from what they are, not where they sit", () => {
  const a = docRecord({ kind: "class", title: "Passover", url: "/classes/x", sub: "In Closing", text: "t1" });
  const b = docRecord({ kind: "class", title: "Passover", url: "/classes/x", sub: "In Closing", text: "t2" });
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, docRecord({ kind: "class", title: "Passover", url: "/classes/y", sub: "In Closing", text: "t1" }).id);
  assert.equal(chunkRecord({ video: "v", t: 12.6, text: "x", kind: "class", title: "T" }).id, "t:v:13");
  assert.equal(hash("a").length, 8);
});

test("the prompt numbers the passages and the citations read back in order of use", () => {
  const msgs = buildPrompt("What is the Passover?", [{ kind: "class", title: "A", url: "/a", text: "one" }, { kind: "spoken", title: "B", url: "", video: "v", t: 30, text: "two" }]);
  assert.equal(msgs[0].role, "system");
  assert.ok(msgs[1].content.includes("[1] A\none"));
  assert.ok(msgs[1].content.includes("[2] B (spoken at 30s)\ntwo"));
  const withHistory = buildPrompt("and the feast?", [{ kind: "class", title: "A", url: "/a", text: "one" }], [{ role: "user", content: "What is the Passover?" }, { role: "assistant", content: "The class teaches…" }]);
  assert.equal(withHistory.length, 4);
  assert.equal(withHistory[1].role, "user");
  assert.equal(withHistory[2].role, "assistant");
  assert.ok(withHistory[3].content.endsWith("Question: and the feast?"));
  assert.deepEqual(citations("The class teaches it [2]. Also [1, 2] and [9].", 2), [2, 1]);
  assert.deepEqual(citations("nothing", 2), []);
});

test("matches collapse to one per page or per recording minute-and-a-half, best score first", () => {
  const m = dedupeMatches([
    { id: "1", score: 0.5, metadata: { kind: "class", url: "/a", sub: "" } },
    { id: "2", score: 0.9, metadata: { kind: "class", url: "/a", sub: "" } },
    { id: "3", score: 0.7, metadata: { video: "v", t: 10 } },
    { id: "4", score: 0.6, metadata: { video: "v", t: 40 } },
    { id: "5", score: 0.8, metadata: { video: "v", t: 400 } },
  ]);
  assert.deepEqual(m.map((x) => x.id), ["2", "5", "3"]);
});
