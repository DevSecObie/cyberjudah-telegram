import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = new URL("./.build/approved-answers.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/approved-answers.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const { approvedFor, approvedSources } = await import(out);

const entries = [{ id: "twelve-tribes", questions: ["Who are the 12 tribes of Israel today?"], answer: "APPROVED", sources: [{ kind: "class", title: "A class", url: "/classes/x" }] }];

test("an approved answer is given only to its own question, asked first, in near the same words", () => {
  assert.equal(approvedFor("who are the 12 tribes of Israel today", [], entries)?.id, "twelve-tribes");
  assert.equal(approvedFor("Who are the twelve tribes of Israel today?", [], entries), null, "different words are not matched");
  assert.equal(approvedFor("Who are the 12 tribes of Israel today?", [{ role: "user", content: "x" }, { role: "assistant", content: "y" }], entries), null, "a follow-up is answered fresh");
  assert.equal(approvedFor("Who are the 12 tribes of Israel today?", [], []), null);
  assert.deepEqual(approvedSources(entries[0]), [{ kind: "class", title: "A class", url: "/classes/x", text: "", n: 1 }]);
});

test("the approved answers file starts empty: every answer in it is the owner's to approve", async () => {
  const { readFileSync } = await import("node:fs");
  const data = JSON.parse(readFileSync(new URL("../data/approved-answers.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(data.answers));
  for (const a of data.answers) { assert.ok(a.id && a.questions?.length && a.answer, a.id); }
});
