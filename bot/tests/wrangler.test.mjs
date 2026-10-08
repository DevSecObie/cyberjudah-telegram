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

test("staging explicitly binds inference and the shared published library, with separate reader storage", () => {
  const staging = config.env.staging;
  for (const key of ["ai", "vectorize", "r2_buckets"]) assert.deepEqual(staging[key], config[key], `${key} is not inherited`);
  const database = env => env.d1_databases.find(db => db.binding === "DB").database_name;
  assert.notEqual(database(staging), database(config));
  assert.deepEqual(staging.routes, [], "staging must not take production's routes");
});

test("the end-to-end tests' clock is never on in a deployed Worker", () => {
  assert.equal(config.vars.E2E_CLOCK, undefined);
  assert.equal(config.env.staging.vars.E2E_CLOCK, undefined);
});

test("Ask is sold at cost: no margin, no plan, no free daily allowance for paid models", () => {
  for (const vars of [config.vars, config.env.staging.vars]) {
    assert.equal(vars.ASK_MARGIN, "1");
    for (const gone of ["ASK_PLAN_STARS", "ASK_PLAN_BONUS", "ASK_PACKS", "ASK_FREE_DAILY", "ASK_FREE_DAILY_CREDITS", "ASK_BASIC_DAILY", "ASK_USD_PER_MTOK"]) assert.equal(vars[gone], undefined, gone);
    assert.equal(vars.ASK_TOPUPS_USD, "1,5,20");
  }
});

test("Workers Logs keep console output but no invocation logs, whose URLs carry search words", () => {
  assert.equal(config.observability.enabled, true);
  assert.equal(config.observability.logs.enabled, true);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.env.staging.observability, undefined, "staging inherits the same setting");
});
