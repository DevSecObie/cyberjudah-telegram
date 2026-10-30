import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCandidates, buildPrompt, chunkRecord, citations, dedupeMatches, docRecord, hash, SYSTEM } from "../src/ai.mjs";

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
  const withHistory = buildPrompt("and the feast?", [{ kind: "class", title: "A", url: "/a", text: "one" }], [{ role: "user", content: "What is the Passover?" }, { role: "assistant", content: "It is kept because…" }]);
  assert.equal(withHistory.length, 4);
  assert.equal(withHistory[1].role, "user");
  assert.equal(withHistory[2].role, "assistant");
  assert.ok(withHistory[3].content.endsWith("Question: and the feast?"));
  assert.deepEqual(citations("It is kept for this reason [2]. Also [1, 2] and [9].", 2), [2, 1]);
  assert.deepEqual(citations("nothing", 2), []);
});

test("the answer contract preserves CyberJudah identity terminology", () => {
  assert.match(SYSTEM, /IUIC means "Israel United in Christ"/);
  assert.match(SYSTEM, /Bishop Nathanyel/);
  assert.doesNotMatch(SYSTEM, /Bishop Nathanael/);
  assert.match(SYSTEM, /Do not call him a Christian pastor/);
  assert.match(SYSTEM, /Never invent an expansion, synonym, denomination, occupation or affiliation/);
});

test("junk transcript fragments cannot become answer evidence", () => {
  const good = { kind: "class", title: "Why We Keep the Passover", url: "/class", text: "The Passover is kept as a memorial of deliverance from bondage and the congregation observes it according to the law.", score: 0.72 };
  const filler = { kind: "spoken", title: "A class", url: "", text: "do do do do do do do do do do do do", score: 0.99 };
  const tiny = { kind: "spoken", title: "Another class", url: "", text: "keep the Passover", score: 0.98 };
  assert.deepEqual(answerCandidates("Why do we keep the Passover?", [filler, tiny, good]), [good]);
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

test("the answer's last line of follow-up questions is taken off the answer", async () => {
  const { splitFollowups } = await import("../src/ai.mjs");
  const r = splitFollowups("The feast is kept for ever [2].\n\n> A memorial. **Exodus 12:14**\n\nFollow-ups: Why the lamb? | What of leaven? | When is Abib?");
  assert.equal(r.answer, "The feast is kept for ever [2].\n\n> A memorial. **Exodus 12:14**");
  assert.deepEqual(r.followups, ["Why the lamb?", "What of leaven?", "When is Abib?"]);
  assert.deepEqual(splitFollowups("No suggestions here.").followups, []);
});

test("a follow-up is searched with the question before it; a new question stands alone", async () => {
  const { retrievalText } = await import("../src/ai.mjs");
  const history = [{ role: "user", content: "Who was Melchizedek?" }, { role: "assistant", content: "The king of Salem." }];
  assert.equal(retrievalText("why?", history), "Who was Melchizedek? why?");
  assert.equal(retrievalText("what did he bring out to Abram when he met him", history), "Who was Melchizedek? what did he bring out to Abram when he met him");
  assert.equal(retrievalText("What does the law say about eating swine and the unclean beasts?", history), "What does the law say about eating swine and the unclean beasts?");
  assert.equal(retrievalText("why?", []), "why?");
});

test("the verse references a question names are found, numbered books and ranges included", async () => {
  const { referencesIn } = await import("../src/ai.mjs");
  assert.deepEqual(referencesIn("What does Deuteronomy 28:68 mean, and how does 1 John 3:4-8 fit?"), ["Deuteronomy 28:68", "1 John 3:4-8"]);
  assert.deepEqual(referencesIn("Explain Wisdom of Solomon 2:12"), ["Wisdom of Solomon 2:12"]);
  assert.deepEqual(referencesIn("Who are the Israelites?"), []);
});

test("with no passages the model is told to say so and to quote and cite nothing", () => {
  const [, user] = buildPrompt("thanks", []);
  assert.match(user.content, /No passages from the library were found/);
  assert.match(user.content, /quote no Scripture and cite nothing/);
  assert.ok(user.content.endsWith("Question: thanks"));
});

test("the answer contract keeps the classes' language, the evidence rule, and conversation", () => {
  assert.match(SYSTEM, /Never invent a reference, a quote, a date, a name/);
  assert.match(SYSTEM, /Do not soften, tone down or apologise for what the classes teach/);
  assert.match(SYSTEM, /answer every part, in order/);
  assert.match(SYSTEM, /answer the most likely meaning, say in one short line which meaning you took/);
  assert.match(SYSTEM, /say plainly which part the library you were given does not cover/);
  assert.doesNotMatch(SYSTEM, /Do not quote the captions/);
});

test("a passage's teacher is shown to the model, and a Bishop's or Deacon's relevant teaching makes the cut first", () => {
  const [, user] = buildPrompt("Why keep the Passover?", [{ kind: "spoken", title: "Passover", url: "", video: "v", t: 5, teacher: "Bishop Nathanyel", text: "one" }]);
  assert.match(user.content, /\[1\] Passover \(taught by Bishop Nathanyel\) \(spoken at 5s\)/);
  const text = "The Passover is kept as a memorial of deliverance from bondage, and the congregation observes it according to the law.";
  const captain = { kind: "spoken", title: "A", url: "", teacher: "Captain Ashan-El", text, score: 0.70 };
  const bishop = { kind: "spoken", title: "B", url: "", teacher: "Bishop Nathanyel", text, score: 0.66 };
  assert.deepEqual(answerCandidates("Why keep the Passover?", [captain, bishop], 1), [bishop]);
  assert.match(SYSTEM, /Never name a teacher for a passage that is not marked/);
});
