import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { SITE_ROUTES, launchPath, pathToStartParam, siteServes, startParamTarget, startParamToPath } from "../../shared/links.mjs";

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
  "dictionary", "downloads", "encyclopedia", "giving-the-sense", "glossary", "history", "law", "lexicon", "people", "person", "precepts", "privacy",
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

const FILL = { ":book": "john", ":chapter": "3", ":year": "2026", ":era": "kings", ":part": "part-1", ":section": "a", ":slug": "some-slug" };
const sample = (route) => "/" + route.split("/").filter(Boolean).map((s) => {
  if (s.startsWith(":") && !(s in FILL)) throw new Error(`no sample value for ${s} in ${route}`);
  return FILL[s] ?? s;
}).join("/");

test("every site route round-trips through a start param to itself", () => {
  for (const route of SITE_ROUTES) {
    const path = sample(route);
    const param = pathToStartParam(path);
    assert.equal(startParamToPath(param), path, `${route}: ${path} -> ${param}`);
  }
});

// The app's screens (app/src/App.tsx), without the catch-all that shows Home.
const APP = [...fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8").matchAll(/path="([^"]*)"/g)]
  .map((m) => m[1].split("/").filter(Boolean)).filter((a) => a[0] !== "*");
const appServes = (path) => {
  const s = path.replace(/[?#].*$/, "").split("/").filter(Boolean);
  return APP.some((a) => a.at(-1) === "*"
    ? s.length >= a.length - 1 && a.slice(0, -1).every((x, i) => x.startsWith(":") || x === s[i])
    : a.length === s.length && a.every((x, i) => x.startsWith(":") || x === s[i]));
};
// Site pages the app has no screen for yet: their launch shows Home.
const NO_APP_SCREEN = new Set(["/about", "/api", "/downloads"]);

test("every site route's start param opens an app screen in the Mini App", () => {
  for (const route of SITE_ROUTES) {
    const opened = launchPath(pathToStartParam(sample(route)));
    assert.equal(appServes(opened), !NO_APP_SCREEN.has(route), `${route} -> ${opened}`);
  }
  assert.equal(launchPath("giving-the-sense"), "/classes?feed=sense");
});
