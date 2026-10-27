import { test } from "node:test";
import assert from "node:assert/strict";
import { personDetails } from "../src/person-details.ts";

test("Ask retains priestly membership, identity uncertainty and named sources", () => {
  const text = personDetails({ id: "fixture", name: "Fixture", verses: ["1-maccabees/2/1", "1-maccabees/2/2"],
    priestly: [{ id: "joarib", name: "Joarib", evidenceLabel: "Scripturally confirmed", verses: ["1-maccabees/2/1"] }],
    same: [{ id: "other", name: "Other", evidence: "uncertain", note: "Not yet checked.", sources: [{ id: "JOSEPHUS-ANT", locator: "XII.4.10" }] }],
    titles: [{ title: "Governor", evidence: "history" }], variants: [{ reading: "Other reading", note: "Different textual tradition." }] });
  assert.match(text, /Priestly course \(not a direct-parent claim\): Joarib/);
  assert.doesNotMatch(text, /Father: Joarib/);
  assert.match(text, /uncertain.*Not yet checked.*JOSEPHUS-ANT, XII\.4\.10/);
  assert.match(text, /Named in 2 verses/);
  assert.match(text, /First named at 1-maccabees 2 1/);
  assert.match(text, /Title: Governor \(history\)/);
  assert.match(text, /Textual variant: Other reading/);
});

test("older person records and reverse links remain readable", () => {
  assert.match(personDetails({ id: "old", name: "Old", verses: 3, father: [{ id: "father", name: "Father" }] }), /Father: Father\. Named in 3 verses/);
  const text = personDetails({ id: "reverse", name: "Reverse", alsoNamed: [{ id: "alias", name: "Alias", evidenceLabel: "Parallel identification" }], course: [{ id: "member", name: "Member", evidence: "scripture" }] });
  assert.match(text, /Members of this priestly course: Member/);
  assert.match(text, /Other entries linked to this person.*Alias.*Parallel identification/);
});
