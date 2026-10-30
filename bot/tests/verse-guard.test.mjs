import { test } from "node:test";
import assert from "node:assert/strict";
import { guardVerses } from "../src/verse-guard.mjs";

const books = [{ book: "Exodus", slug: "exodus", chapters: 40 }, { book: "Deuteronomy", slug: "deuteronomy", chapters: 34 }];
const chapters = {
  "exodus/12": { verses: [{ verse: 14, text: "And this day shall be unto you for a memorial; and ye shall keep it a feast to the LORD throughout your generations; ye shall keep it a feast by an ordinance for ever." }] },
  "deuteronomy/28": { verses: [{ verse: 68, text: "And the LORD shall bring thee into Egypt again with ships, by the way whereof I spake unto thee, Thou shalt see it no more again: and there ye shall be sold unto your enemies for bondmen and bondwomen, and no man shall buy you." }] },
};
const chapter = async (slug, ch) => chapters[`${slug}/${ch}`] ?? null;

test("a verse quoted word for word stays, with an ellipsis for words left out", async () => {
  const answer = "It is kept for ever [1].\n\n> And this day shall be unto you for a memorial… ye shall keep it a feast by an ordinance for ever. **Exodus 12:14**";
  const r = await guardVerses(answer, books, chapter);
  assert.equal(r.text, answer);
  assert.deepEqual([r.checked, r.fixed, r.removed], [1, 0, 0]);
});

test("a misquoted verse is replaced with the King James text; an unreadable one is left alone", async () => {
  const r = await guardVerses("> The Lord will send you back to Egypt on boats. **Deuteronomy 28:68**\n> Something. **Genesis 1:1**", books, chapter);
  assert.match(r.text, /^> And the LORD shall bring thee into Egypt again with ships, .* no man shall buy you\. \*\*Deuteronomy 28:68\*\*/);
  assert.match(r.text, /> Something\. \*\*Genesis 1:1\*\*$/, "a book the catalog does not know is not touched");
  assert.equal(r.fixed, 1);
});

test("a misquote of a long range is taken out rather than pasted whole", async () => {
  const long = { verses: Array.from({ length: 10 }, (_, i) => ({ verse: i + 1, text: `verse ${i + 1} text of the law` })) };
  const r = await guardVerses("Before.\n> Made-up words here. **Exodus 12:1-10**\nAfter.", books, async () => long);
  assert.equal(r.text, "Before.\nAfter.");
  assert.equal(r.removed, 1);
});

test("the Ask test set is well formed: unique ids, a question each, and no approved answer invented for the owner", async () => {
  const { readFileSync } = await import("node:fs");
  const { questions } = JSON.parse(readFileSync(new URL("../evals/ask-questions.json", import.meta.url), "utf8"));
  assert.ok(questions.length >= 20);
  assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
  for (const q of questions) { assert.ok(q.q?.length >= 2, q.id); assert.equal(typeof q.approved, "string", q.id); }
});
