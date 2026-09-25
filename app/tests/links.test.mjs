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
  assert.equal(toAppPath("https://example.com/x"), null);
});

test("share links round-trip", () => {
  const p = pathToStartParam("/bible/john/3", "16-18,20");
  assert.equal(startParamToPath(p), "/bible/john/3?v=16-18,20#v16");
  assert.equal(appLink("https://t.me/bot/read", "https://cyberjudah.io", "/bible/john/3", "16"), "https://t.me/bot/read?startapp=bible_john_3_16");
  assert.equal(appLink("", "https://cyberjudah.io", "/classes/2026/x"), "https://cyberjudah.io/classes/2026/x");
  assert.equal(sitePathOf("/read/john/3"), "/bible/john/3");
  assert.equal(sitePathOf("/note/classes/2026/x"), "/classes/2026/x");
});
