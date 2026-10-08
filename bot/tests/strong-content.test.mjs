import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = new URL("./.build/strong-content.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/strong-content.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { buildTeachings, strongContent } = await import(out);
const row = (videoId, title, extra = {}) => ({ videoId, title, url: `/classes/${videoId}/`, date: "2026-10-03", teacher: "", thumb: `/img/classes/${videoId}.jpg`, ...extra });
const classes = [
  row("CO-THOc-IhQ", "Blood Toucheth Blood", { teacher: "Captain Ashan-El" }),
  row("pZs5reAzxi4", "Haiti: the Rise After the Ruin", { teacher: "Bishop Nathanyel" }),
  row("PkFnZPllE5w", "The Slave Mentality Yesterday & Today: the True Diaspora", { teacher: "Deacon Eythan" }),
  row("TVP5_nyFcHs", "You Are Hated And In Hell", { teacher: "Deacon Isaac" }),
];
const broadcasts = Object.fromEntries([
  ["CO-THOc-IhQ", "12:56:31"], ["PkFnZPllE5w", "16:00:04"], ["TVP5_nyFcHs", "18:58:36"], ["pZs5reAzxi4", "21:56:00"],
].map(([id, time]) => [id, { date: "2026-10-03", broadcastAt: `2026-10-03T${time}Z` }]));

test("the fork uses the owner's restored order, dates, teachers and thumbnails", () => {
  const result = buildTeachings({ classes, captains: [], history: [] }, [], broadcasts, "https://data.example", "UTC");
  assert.deepEqual(result.map(t => t.video), ["pZs5reAzxi4", "TVP5_nyFcHs", "PkFnZPllE5w", "CO-THOc-IhQ"]);
  assert.equal(result[0].teacher, "Bishop Nathanyel");
  assert.equal(result[0].date, "2026-10-03");
  assert.equal(result[0].thumb, "https://data.example/img/classes/pZs5reAzxi4.jpg");
  assert.ok(result.every(t => t.label === "Sabbath class"));
});

test("an upload stays visible until its notes arrive without duplicate recordings or invented teachers", () => {
  const upload = { video: "aaaaaaaaaaa", title: "New upload", published: "2026-10-07T12:00:00Z", views: null };
  const pending = buildTeachings({ classes, captains: [], history: [] }, [upload, upload], broadcasts, "https://data.example", "UTC");
  assert.equal(pending.length, 5);
  assert.deepEqual([pending[0].video, pending[0].pending, pending[0].teacher, pending[0].broadcastAt], [upload.video, true, "", undefined]);
  const noted = buildTeachings({ classes: [...classes, row(upload.video, upload.title)], captains: [], history: [] }, [upload], broadcasts, "https://data.example", "UTC");
  assert.equal(noted.filter(t => t.video === upload.video).length, 1);
  assert.equal(noted.find(t => t.video === upload.video).pending, undefined);
});

test("series and history retain their real labels; viewers' local days are respected", () => {
  const result = buildTeachings({ classes: [row("aaaaaaaaaaa", "Leaven Part 2"), row("bbbbbbbbbbb", "Leaven")], captains: [], history: [row("ccccccccccc", "Our Hidden History", { episode: 8 })] }, [], { aaaaaaaaaaa: { date: "2026-10-03", broadcastAt: "2026-10-04T01:00:00Z" } }, "https://data.example", "America/New_York");
  assert.equal(result[0].date, "2026-10-03");
  assert.equal(result[0].label, "Leaven · Part 2");
  assert.equal(result[1].label, "Leaven · Part 1");
  assert.equal(result[2].sub, "Episode 8");
  assert.equal(result[2].label, "Our Hidden History");
});

test("public feed rejects invalid zones and reports origin outages without erasing saved uploads", async t => {
  const stored = { checked: Date.now(), videos: [{ video: "aaaaaaaaaaa", title: "Awaiting notes", published: "2026-10-07T12:00:00Z", views: null }] };
  const env = { DATA_ORIGIN: "https://data.example", SUBS: { get: async () => stored, put: async () => {} } };
  const ctx = { waitUntil() {} };
  const previousCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  t.after(() => { globalThis.caches = previousCaches; });
  let classesOk = true;
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    if (url.hostname === "www.youtube.com") return new Response("", { status: 404 });
    if (url.pathname === "/search/classes.json") return classesOk ? Response.json(classes) : new Response("", { status: 503 });
    if (url.pathname === "/api/classes/broadcasts.json") return Response.json(broadcasts);
    if (url.pathname === "/search/captains.json") return Response.json([]);
    if (url.pathname === "/api/history/index.json") return new Response("", { status: 503 });
    throw new Error(`Unexpected destination: ${url}`);
  });
  assert.equal((await strongContent.request("https://app.example/teachings?timeZone=bad-zone", {}, env, ctx)).status, 400);
  const response = await strongContent.request("https://app.example/teachings", {}, env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  const body = await response.json();
  assert.equal(body.feedOk, false);
  assert.deepEqual(body.unavailable, ["Our Hidden History"]);
  assert.equal(body.teachings[0].pending, true);
  assert.equal(body.teachings[1].title, "Haiti: the Rise After the Ruin");
  classesOk = false;
  const failed = await strongContent.request("https://app.example/teachings", {}, env, ctx);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "Classes could not be loaded. Please try again." });
});
