import assert from "node:assert/strict";
import test from "node:test";
import { safeLinks } from "../src/lib/safe-links.ts";

test("an answer's links stay links only when they lead inside the app", () => {
  assert.equal(safeLinks('<a href="/settings/reminders">Reading reminders</a>'), '<a class="applink" href="/settings/reminders">Reading reminders</a>');
  assert.equal(safeLinks('<a href="/ask?chat=abc12345&amp;x=1">chat</a>'), '<a class="applink" href="/ask?chat=abc12345&amp;x=1">chat</a>');
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "https://evil.example/x", "//evil.example/x", "/\\evil.example", "data:text/html,x", "mailto:a@b.c", "/x?u=https://evil.example"]) {
    assert.equal(safeLinks(`<a href="${href}" title="t">click</a>`), "click", href);
  }
});
