import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, decodeBase64, encodeBase64, isAdminId, NOTE_FILE } from "../src/edit.mjs";

const NOTE = `---\ntitle: "The Art of War"\ndate: 2026-09-26\nteacher: ""\n---\n\nThe teacher said Yawasap twice: Yawasap.\n`;

test("only note files under blog/ or captains/ can be edited", () => {
  assert.ok(NOTE_FILE.test("blog/2026/2026-09-26-the-art-of-war.md"));
  assert.ok(NOTE_FILE.test("captains/2025/2025-01-01-episode.md"));
  assert.ok(!NOTE_FILE.test("data/bible/genesis.json"));
  assert.ok(!NOTE_FILE.test("blog/2026/../../.github/workflows/deploy.yml"));
});

test("admins come from ADMIN_IDS", () => {
  assert.ok(isAdminId("12345, 678", 678));
  assert.ok(!isAdminId("12345", 678));
  assert.ok(!isAdminId(undefined, 0));
});

test("the teacher and title land in the front matter", () => {
  const { text, summary } = applyEdit(NOTE, { file: "x", teacher: "Bishop Yawasap", title: 'Rules of "Engagement"' });
  assert.match(text, /^teacher: "Bishop Yawasap"$/m);
  assert.match(text, /^title: "Rules of \\"Engagement\\""$/m);
  assert.equal(summary.length, 2);
  assert.ok(text.endsWith("Yawasap.\n"));
});

test("a spelling fix replaces every occurrence and counts them", () => {
  const { text, summary } = applyEdit(NOTE, { file: "x", replace: [{ from: "Yawasap", to: "Yahwasap" }] });
  assert.equal(text.split("Yahwasap").length - 1, 2);
  assert.deepEqual(summary, ['"Yawasap" → "Yahwasap" (2)']);
});

test("an edit that changes nothing is refused", () => {
  assert.throws(() => applyEdit(NOTE, { file: "x" }), /Nothing to change/);
  assert.throws(() => applyEdit(NOTE, { file: "x", replace: [{ from: "absent", to: "x" }] }), /not in this note/);
  assert.throws(() => applyEdit(NOTE, { file: "x", body: "no front matter" }), /front matter/);
});

test("a long note with Hebrew and quotes survives the trip to GitHub and back", () => {
  const long = ("שָׁלוֹם “quoted” — " + "x".repeat(997) + "\n").repeat(120); // ~150 KB of UTF-8
  const b64 = encodeBase64(long);
  assert.equal(decodeBase64(b64), long);
  assert.equal(decodeBase64(b64.replace(/(.{60})/g, "$1\n")), long);
});
