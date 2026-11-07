import { test } from "node:test";
import assert from "node:assert/strict";
import { personDetails } from "../src/person-details.ts";

test("Ask retains priestly membership, identity uncertainty and named sources", () => {
  const text = personDetails({ id: "fixture", name: "Fixture", description: "A fixture person", verses: ["1-maccabees/2/1", "1-maccabees/2/2"],
    priestly: [{ id: "joarib", name: "Joarib", evidenceLabel: "Scripturally confirmed", verses: ["1-maccabees/2/1"] }],
    same: [{ id: "other", name: "Other", evidence: "uncertain", note: "Not yet checked.", sources: [{ title: "Jewish Encyclopedia (1901-1906)", url: "https://example.org/je" }] }],
    titles: [{ title: "Governor", evidence: "history" }], variants: [{ reading: "Other reading", note: "Different textual tradition." }] });
  assert.match(text, /^A fixture person\. /);
  assert.match(text, /Priestly course \(not a direct-parent claim\): Joarib/);
  assert.doesNotMatch(text, /Father: Joarib/);
  assert.match(text, /uncertain.*Not yet checked.*Jewish Encyclopedia \(1901-1906\) <https:\/\/example\.org\/je>/);
  assert.match(text, /Named in 2 verses/);
  assert.doesNotMatch(text, /Named in 1-maccabees/);
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
