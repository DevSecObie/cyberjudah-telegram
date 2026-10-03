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
  // The bot's link buttons must launch the Mini App (with signed launch data), not open the web
  // address in Telegram's in-app browser, where Ask and Search could only offer to reopen Telegram.
  for (const v of [config.vars, config.env.staging.vars]) assert.match(v.APP_URL, /^https:\/\/t\.me\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+$/);
});
