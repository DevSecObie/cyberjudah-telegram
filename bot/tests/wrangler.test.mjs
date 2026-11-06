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
  const staging = Object.keys(config.env.staging.vars).filter(key => key !== "REFERENCE_HOSTING").sort();
  assert.deepEqual(staging, prod);
  assert.equal(config.env.staging.vars.DATA_ORIGIN, config.vars.DATA_ORIGIN);
  assert.notEqual(config.env.staging.vars.APP_URL, config.vars.APP_URL);
  assert.equal(config.env.staging.vars.REFERENCE_HOSTING, "nave-self-hosted");
  assert.deepEqual(config.env.staging.services, [{ binding: "REFERENCE_PUBLICATIONS", service: "cyberjudah-resources-staging" }]);
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

test("production and staging search use only a hosted free-tier model", () => {
  for (const vars of [config.vars, config.env.staging.vars]) {
    assert.equal(vars.SEARCH_AI_FREE_ONLY, "on");
    assert.match(vars.SEARCH_AI_MODEL, /^@cf\//);
  }
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

test("production and staging exempt only the release check's synthetic reader from the search answer quota", () => {
  assert.equal(config.vars.SEARCH_AI_QUOTA_EXEMPT, "1");
  assert.equal(config.env.staging.vars.SEARCH_AI_QUOTA_EXEMPT, "1");
});

test("signed-in requests are limited per person; per-address limits leave room for a class on one Wi-Fi", () => {
  for (const env of [config, config.env.staging]) {
    const limit = name => env.ratelimits.find(r => r.name === name)?.simple.limit;
    assert.equal(limit("FIREBASE_UID_LIMIT"), 60);
    assert.ok(limit("FIREBASE_SESSION_LIMIT") >= 600);
    assert.ok(limit("READER_LIMIT") >= 600);
  }
  const ids = [...config.ratelimits, ...config.env.staging.ratelimits].map(r => r.namespace_id);
  assert.equal(new Set(ids).size, ids.length, "every limiter has its own namespace");
});

test("free Ask answers have room for several answers at once; Claude answers only in production, under a total cap", () => {
  for (const vars of [config.vars, config.env.staging.vars]) {
    assert.ok(Number(vars.ASK_FREE_DAILY_USD_CAP) >= 10 * Number(vars.ASK_FREE_MAX_USD), "the daily cap holds at least ten answers' reservations");
  }
  for (const vars of [config.vars, config.env.staging.vars]) assert.equal(vars.ASK_DAILY_LIMIT, "20");
  assert.equal(config.env.staging.vars.ASK_CLAUDE_FOR_READERS, "off");
  assert.ok(Number(config.vars.ASK_CLAUDE_TOTAL_USD_CAP) > 0, "production's Claude answers have a total cap");
});
