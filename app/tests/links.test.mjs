import test from "node:test";
import assert from "node:assert/strict";
import { appLink, launchPath, pathToStartParam, sitePathOf, startParamToPath, toAppPath } from "../../shared/links.mjs";

test("start params open the screen they name", () => {
  assert.equal(launchPath(""), "/");
  assert.equal(launchPath("john_3_16"), "/read/john/3?v=16");
  assert.equal(launchPath("John_3_16-18"), "/read/john/3?v=16-18");
  assert.equal(launchPath("1-kings_8_22x27"), "/read/1-kings/8?v=22,27");
  assert.equal(launchPath("psalms"), "/bible?book=psalms");
  assert.equal(launchPath("classes_2026_the-coming-crisis"), "/note/classes/2026/the-coming-crisis");
  assert.equal(launchPath("law"), "/law");
  assert.equal(launchPath("privacy"), "/privacy");
  assert.equal(launchPath("terms"), "/terms");
  assert.equal(launchPath("a/b"), "/");
  assert.equal(launchPath("x".repeat(513)), "/");
});

test("site links inside the notes open the app's screens", () => {
  assert.equal(toAppPath("/bible/john/3#v4"), "/read/john/3#v4");
  assert.equal(toAppPath("/study/john/3"), "/note/study/john/3");
  assert.equal(toAppPath("/classes/2026/x"), "/note/classes/2026/x");
  assert.equal(toAppPath("/law/01-x/1a#1A.1"), "/law/01-x/1a#1A.1");
  assert.equal(toAppPath("/captains"), "/classes?feed=captains");
  assert.equal(toAppPath("/truth-shall-make-you-free"), "/classes?feed=truth");
  assert.equal(toAppPath("/shows"), "/classes?feed=shows");
  assert.equal(toAppPath("/shows/patient-saints-radio"), "/classes?feed=shows&show=patient-saints-radio");
  assert.equal(toAppPath("https://example.com/x"), null);
});

test("share links round-trip", () => {
  const p = pathToStartParam("/bible/john/3", "16-18,20");
  assert.equal(startParamToPath(p), "/bible/john/3?v=16-18,20#v16");
  assert.equal(appLink("https://t.me/bot/read", "https://cyberjudah.io", "/bible/john/3", "16"), "https://t.me/bot/read?startapp=bible_john_3_16");
  assert.equal(appLink("", "https://cyberjudah.io", "/classes/2026/x"), "https://cyberjudah.io/classes/2026/x");
  assert.equal(sitePathOf("/read/john/3"), "/bible/john/3");
  assert.equal(sitePathOf("/note/classes/2026/x"), "/classes/2026/x");
  assert.equal(sitePathOf("/glossary"), "/glossary");
  assert.equal(sitePathOf("/classes?feed=sense"), "/giving-the-sense");
  assert.equal(sitePathOf("/classes?feed=truth"), "/truth-shall-make-you-free");
  assert.equal(sitePathOf("/classes?feed=captains"), "/captains");
  assert.equal(sitePathOf("/classes?feed=history"), "/history");
  assert.equal(sitePathOf("/classes?feed=shows&show=patient-saints-radio"), "/shows/patient-saints-radio");
  assert.equal(sitePathOf("/classes?feed=sabbath"), "/classes");
  for (const f of ["constructor", "__proto__", "toString"]) assert.equal(sitePathOf(`/classes?feed=${f}`), "/classes");
  assert.equal(sitePathOf("/bible?book=john"), "/bible/john");
  assert.equal(sitePathOf("/bible?book=John"), "/bible/john");
  assert.equal(sitePathOf("/bible?x=1#&book=john"), "/bible?x=1#&book=john");
  assert.equal(sitePathOf(toAppPath("/bible/john")), "/bible/john");
  assert.equal(sitePathOf("/read/john/3?v=16"), "/bible/john/3?v=16");
  assert.equal(sitePathOf("/glossary#amalek"), "/glossary#amalek");
  // Each site page toAppPath turns into a feed comes back to itself.
  for (const p of ["/giving-the-sense", "/truth-shall-make-you-free", "/captains", "/history", "/shows", "/shows/patient-saints-radio"]) assert.equal(sitePathOf(toAppPath(p)), p);
  assert.equal(sitePathOf("/classes"), "/classes");
  assert.equal(toAppPath("/glossary#amalek"), "/glossary#amalek");
  assert.equal(sitePathOf("/concordance/genesis"), "/concordance/genesis");
  assert.equal(toAppPath("/concordance/genesis#ch-3"), "/concordance/genesis#ch-3");
});
