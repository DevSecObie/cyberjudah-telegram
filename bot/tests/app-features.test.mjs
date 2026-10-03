import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { FEATURES } from "../../shared/app-features.mjs";
import { checkInput, findFeatures } from "../src/assistant.mjs";

/** The routes the app actually has, read from its router. */
const ROUTES = [...fs.readFileSync(new URL("../../app/src/App.tsx", import.meta.url), "utf8").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

test("every feature Ask can name is a route the app has, once", () => {
  for (const f of FEATURES) assert.ok(ROUTES.includes(f.path), `${f.id}: ${f.path} is not a route in App.tsx`);
  assert.equal(new Set(FEATURES.map((f) => f.id)).size, FEATURES.length);
  assert.equal(new Set(FEATURES.map((f) => f.path)).size, FEATURES.length);
  assert.ok(FEATURES.filter((f) => f.main).length >= 5);
});

test("app questions find the screen that does it, and nothing for what the app does not have", () => {
  assert.equal(findFeatures(FEATURES, "remind me to read")[0].id, "reminders");
  assert.equal(findFeatures(FEATURES, "change the font size")[0].id, "settings");
  assert.equal(findFeatures(FEATURES, "when does sabbath start")[0].id, "sabbath");
  assert.equal(findFeatures(FEATURES, "hebrew word study")[0].id, "lexicon");
  assert.equal(findFeatures(FEATURES, "my saved chats")[0].id, "ask");
  assert.deepEqual(findFeatures(FEATURES, "podcast upload"), []);
});

test("streamed tool inputs are checked against the tool's schema before it runs", () => {
  const schema = { type: "object", properties: { query: { type: "string" }, minute: { type: "integer", enum: [0, 15, 30, 45] }, on: { type: "boolean" } }, required: ["query"] };
  assert.equal(checkInput(schema, { query: "passover" }), "");
  assert.equal(checkInput(schema, { query: "x", minute: 30, on: true }), "");
  assert.match(checkInput(schema, {}), /"query" is required/);
  assert.match(checkInput(schema, { query: 5 }), /must be text/);
  assert.match(checkInput(schema, { query: "x", minute: 10 }), /one of 0, 15, 30, 45/);
  assert.match(checkInput(schema, { query: "x", minute: 1.5 }), /whole number/);
  assert.match(checkInput(schema, { query: "x", on: "yes" }), /true or false/);
  assert.match(checkInput(schema, { query: "x", extra: 1 }), /not a field/);
  assert.match(checkInput(schema, "query"), /must be an object/);
  assert.match(checkInput(undefined, {}), /No such tool/);
});
