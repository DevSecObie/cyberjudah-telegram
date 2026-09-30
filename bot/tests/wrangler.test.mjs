import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// wrangler.jsonc without its comments (none of its strings contain "//" or "/*").
const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
);

test("staging has every production setting (environments do not inherit vars)", () => {
  const prod = Object.keys(config.vars).sort();
  const staging = Object.keys(config.env.staging.vars).sort();
  assert.deepEqual(staging, prod);
  assert.equal(config.env.staging.vars.DATA_ORIGIN, config.vars.DATA_ORIGIN);
  assert.notEqual(config.env.staging.vars.APP_URL, config.vars.APP_URL);
});
