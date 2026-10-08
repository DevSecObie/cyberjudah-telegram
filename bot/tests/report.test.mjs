import { test } from "node:test";
import assert from "node:assert/strict";
import { reportMessage } from "../src/report.mjs";

test("a reported Ask answer reaches the admins as its chat, its place and the reason, nothing else", () => {
  const text = reportMessage({ kind: "ask", chat: "abc12345def", turn: 3, reason: "wrong", question: "Why keep the Passover?", user: 42 });
  assert.equal(text, "An Ask answer was reported as wrong or misquoted: chat abc12345def, message 3.");
  assert.doesNotMatch(text, /Passover|42/);
  assert.equal(reportMessage({ kind: "search", reason: "harmful", model: "@cf/zai-org/glm-5.3-flash" }), "A search AI answer was reported as harmful or offensive: model @cf/zai-org/glm-5.3-flash.");
  assert.equal(reportMessage({ kind: "search", reason: "harmful", model: "<b>x</b> y" }), "A search AI answer was reported as harmful or offensive.");
});

test("anything but a report the app sends is refused", () => {
  for (const bad of [null, "x", {}, { kind: "ask", reason: "wrong" }, { kind: "ask", chat: "ABC", turn: 1, reason: "wrong" }, { kind: "ask", chat: "abc12345", turn: -1, reason: "wrong" }, { kind: "ask", chat: "abc12345", turn: 1.5, reason: "wrong" }, { kind: "search", reason: "toString" }, { kind: "search", reason: "spam" }, { kind: "note", reason: "wrong" }]) {
    assert.equal(reportMessage(bad), null, JSON.stringify(bad));
  }
});
