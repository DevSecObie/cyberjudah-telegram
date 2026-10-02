import test from "node:test";
import assert from "node:assert/strict";
import { routerBasename } from "../../shared/basename.mjs";

// Regression: the app rendered blank at cyberjudah.io/app (basename "/app/" with no trailing
// slash in the URL, PR #18) and from the bot's buttons, which open the Worker's root (PR #21).
test("the production build opened at /app, /app/ or a screen under it routes under /app", () => {
  for (const path of ["/app", "/app/", "/app/read/john/3", "/app/note/classes/2026/x"]) assert.equal(routerBasename("/app/", path), "/app", path);
});

test("the same build opened at the Worker's root (the bot's buttons) routes from /", () => {
  for (const path of ["/", "/read/john/3", "/settings", "/apple", "/application"]) assert.equal(routerBasename("/app/", path), "/", path);
});

test("a build rooted at / (dev, tests) always routes from /", () => {
  assert.equal(routerBasename("/", "/app"), "/");
  assert.equal(routerBasename("", "/read/john/3"), "/");
});
