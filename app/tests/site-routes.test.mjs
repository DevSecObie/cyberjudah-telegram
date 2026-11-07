import test from "node:test";
import assert from "node:assert/strict";
import { SITE_ROUTES, launchPath, siteServes, startParamTarget, startParamToPath } from "../../shared/links.mjs";

// The website's routes, copied from the cyberjudah repo's router (site/src/routes, a149538d). Kept
// apart from SITE_ROUTES on purpose: a route added to links.mjs that the site lacks fails here.
const SITE = new Set([
  "/", "/about", "/api", "/downloads", "/giving-the-sense", "/glossary", "/search", "/teachings", "/truth-shall-make-you-free",
  "/bible", "/bible/:book", "/bible/:book/:chapter", "/captains", "/captains/:year/:slug", "/cases", "/cases/:era/:slug",
  "/classes", "/classes/:year/:slug", "/concordance", "/concordance/:book", "/dictionary", "/dictionary/:slug",
  "/doctrine", "/doctrine/:slug", "/encyclopedia", "/encyclopedia/:slug", "/history", "/history/:year/:slug",
  "/law", "/law/:part", "/law/:part/:section", "/precepts", "/precepts/:slug", "/shows", "/shows/:slug",
  "/study", "/study/:book", "/study/:book/:chapter", "/topics", "/topics/:slug",
]);

test("SITE_ROUTES is the site's router, route for route", () => {
  assert.deepEqual([...SITE_ROUTES].sort(), [...SITE].sort());
});

// Every page kind a start param can name, at each depth it can take.
const KINDS = ["plan", "resources", "doctrine", "about", "api", "ask", "bible", "captains", "cases", "classes", "concordance",
  "dictionary", "downloads", "encyclopedia", "glossary", "history", "law", "lexicon", "people", "person", "precepts", "privacy",
  "search", "settings", "shows", "study", "tags", "teachings", "terms", "timeline", "topics", "truth-shall-make-you-free"];
const params = KINDS.flatMap((k) => [k, `${k}_a`, `${k}_2026_b`, `${k}_a_b_c`]).concat(["john", "john_3", "john_3_16-18x20", ""]);

test("every site link a start param gives is a route the site serves, or null", () => {
  for (const p of params) {
    const path = startParamToPath(p);
    if (path === null) continue;
    const bare = path.replace(/[?#].*$/, "");
    const segs = bare.split("/").filter(Boolean);
    const hit = [...SITE].some((r) => { const s = r.split("/").filter(Boolean); return s.length === segs.length && s.every((x, i) => x.startsWith(":") || x === segs[i]); });
    assert.ok(hit, `${p} -> ${path} has no site route`);
  }
});

test("pages the site doesn't have give null", () => {
  for (const p of ["timeline", "people", "person_moses", "classes_2026", "plan", "resources", "ask", "lexicon", "tags",
    "privacy", "settings", "terms", "captains_2026", "history_2026", "cases_era", "bible_john_3_16_17"]) {
    assert.equal(startParamToPath(p), null, p);
  }
});

test("pages the site has keep their link", () => {
  assert.equal(startParamToPath(""), "/");
  assert.equal(startParamToPath("bad param!"), "/");
  assert.equal(startParamToPath("classes_2026_some-class"), "/classes/2026/some-class");
  assert.equal(startParamToPath("john_3"), "/bible/john/3");
  assert.equal(startParamToPath("john_3_16-18x20"), "/bible/john/3?v=16-18,20#v16");
  assert.equal(startParamToPath("law_part-1"), "/law/part-1");
  assert.equal(startParamToPath("glossary"), "/glossary");
  assert.equal(startParamToPath("doctrine_some-slug"), "/doctrine/some-slug");
  assert.ok(siteServes("/bible/john/3?v=1#v1"));
});

test("the app still opens its own screens the site lacks", () => {
  assert.equal(startParamTarget("people"), "/people");
  assert.equal(launchPath("people"), "/people");
  assert.equal(launchPath("timeline"), "/timeline");
  assert.equal(launchPath("privacy"), "/privacy");
  assert.equal(launchPath("person_moses"), "/person/moses");
});
