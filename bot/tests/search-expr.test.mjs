import { test } from "node:test";
import assert from "node:assert/strict";
import { alternatives, ftsExpr, parseQuery } from "../src/search.ts";

test("a number matches as a word and as a figure", () => {
  assert.deepEqual(alternatives("twelve"), ["twelve", "12"]);
  assert.deepEqual(alternatives("12"), ["12", "twelve"]);
  assert.equal(ftsExpr(parseQuery("twelve tribes"), "AND"), '("twelve" OR "12") AND "tribes"');
});

test("a name matches its other KJV spellings", () => {
  assert.deepEqual(alternatives("melchisedec"), ["melchisedec", "melchizedek", "melchisedek"]);
  assert.equal(ftsExpr(parseQuery("Elijah"), "AND"), '("elijah" OR "elias")');
});

test("a phrase is kept whole and never widened", () => {
  assert.equal(ftsExpr(parseQuery('"most high" twelve'), "OR"), '"most high" AND ("twelve" OR "12")');
});

test("while typing the last word matches as a beginning; the fallback makes every word a beginning", () => {
  assert.equal(ftsExpr(parseQuery("lost she"), "AND", "last"), '"lost" AND ("she" OR "she" *)');
  assert.equal(ftsExpr(parseQuery("melchi"), "AND", "all"), '("melchi" OR "melchi" *)');
  // Words under three letters never become beginnings: "a" * would match half the library.
  assert.equal(ftsExpr(parseQuery("ox"), "AND", "all"), '"ox"');
});
