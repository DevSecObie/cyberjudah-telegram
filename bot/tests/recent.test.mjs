import test from "node:test";
import assert from "node:assert/strict";
import { parseChannelVideos } from "../src/live.mjs";
import { recentVideos } from "../src/live.ts";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const A = "abcdefghijk", B = "ABCDEFGHIJK";
const video = (id = A, extra = {}) => ({ videoRenderer: {
  videoId: id, title: { runs: [{ text: 'THE CLASS {OF} "TODAY" & HOPE'  }] },
  publishedTimeText: { simpleText: "Streamed 2 hours ago" }, viewCountText: { simpleText: "1,234 views" }, ...extra,
} });
// Reduced channel-page shapes, not a recording of today's upstream response.
const page = (cards = [video()], prefix = "var ytInitialData") => `<script>${prefix} = ${JSON.stringify({
  contents: { twoColumnBrowseResultsRenderer: { tabs: [
    { tabRenderer: { selected: false, content: { videoRenderer: video(B).videoRenderer } } },
    { tabRenderer: { selected: true, content: { richGridRenderer: { contents: cards.map((card) => ({ richItemRenderer: { content: card } })) } } } },
  ] } }, recommendations: video("recommended"),
})};</script>`;
const rss = `<feed><entry><yt:videoId>${A}</yt:videoId><title>TODAY'S CLASS</title><published>2026-10-04T10:00:00Z</published></entry></feed>`;
const retained = { video: B, title: "A saved class", published: "2026-10-03T12:00:00Z", views: null };

test("channel fallback reads only the selected tab and handles braces/quotes in JSON titles", () => {
  const found = parseChannelVideos(page(), NOW);
  assert.deepEqual(found, [{ video: A, title: 'The Class {of} "today" & Hope', published: "2026-10-04T10:00:00.000Z", views: 1234 }]);
  assert.deepEqual(parseChannelVideos(page([video()], 'window["ytInitialData"]'), NOW), found);
});

test("channel fallback skips scheduled/live streams, Shorts, invalid dates and invalid IDs", () => {
  const cards = [
    video(A, { upcomingEventData: { startTime: "9999999999" } }),
    video(A, { thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: "LIVE" } }] }),
    video(A, { badges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_LIVE_NOW" } }] }),
    video(A, { publishedTimeText: { simpleText: "Started streaming 2 hours ago" } }),
    video(A, { publishedTimeText: {} }), video("invalid"),
    { shortsLockupViewModel: { videoId: A } },
    { gridVideoRenderer: video(B, { publishedTimeText: { runs: [{ text: "Premiered Oct 3, 2026" }] }, viewCountText: { simpleText: "1.2K views" } }).videoRenderer },
  ];
  assert.deepEqual(parseChannelVideos(page(cards), NOW), [{ ...retained, title: 'The Class {of} "today" & Hope', published: "2026-10-03T00:00:00.000Z" }]);
  for (const html of ["", "<html>Consent required</html>", "var ytInitialData = {bad};", "var ytInitialData = {};"]) assert.deepEqual(parseChannelVideos(html, NOW), []);
});

test("unexpected channel-card fields do not break the outage fallback", () => {
  const cards = [null, video(A, { title: { simpleText: {} } }), video(A, { title: { runs: {} } }), video(12345678901),
    video(B, { badges: [null], thumbnailOverlays: [null], title: { runs: [null, { text: "A valid class" }] } })];
  assert.deepEqual(parseChannelVideos(page(cards), NOW).map((v) => [v.video, v.title]), [[B, "A valid class"]]);
  assert.deepEqual(parseChannelVideos('var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[null]}}};', NOW), []);
});

/** Exercise the Worker entry point with real parsers, edge-cache semantics and KV snapshots. */
function worker(t, response, saved = null) {
  const calls = [], edge = new Map(), writes = [];
  let snapshot = saved;
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push(String(url)); assert.ok(init.signal); return response(String(url)); });
  const previous = globalThis.caches;
  globalThis.caches = { default: {
    match: async (key) => edge.get(key)?.clone(),
    put: async (key, value) => { edge.set(key, value.clone()); },
  } };
  t.after(() => { if (previous === undefined) delete globalThis.caches; else globalThis.caches = previous; });
  const env = { LIVE_CHANNEL: "UCtest", SUBS: {
    get: async (key, type) => { assert.equal(key, "recent:v2:UCtest"); assert.equal(type, "json"); return snapshot; },
    put: async (key, value, options) => { snapshot = JSON.parse(value); writes.push({ key, value: snapshot, options }); },
  } };
  return { env, calls, edge, writes };
}

test("healthy RSS stays primary, persists last-good results and serves the edge cache", async (t) => {
  const w = worker(t, () => new Response(rss));
  const first = await recentVideos(w.env);
  assert.deepEqual(first.map((v) => v.video), [A]);
  assert.deepEqual(await recentVideos(w.env), first);
  assert.equal(w.calls.length, 1);
  assert.match(w.calls[0], /feeds\/videos.xml\?channel_id=UCtest$/);
  assert.equal(w.writes[0].options.expirationTtl, 7 * 86400);
  assert.equal([...w.edge.values()][0].headers.get("cache-control"), "public, max-age=600");
});

for (const failure of ["404", "network", "empty", "malformed", "timeout"]) {
  test(`RSS ${failure} falls back to both uploads and completed livestreams`, async (t) => {
    const w = worker(t, (url) => {
      if (url.includes("feeds/")) {
        if (failure === "network") throw new Error("offline");
        if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
        return new Response(failure === "malformed" ? "<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>Broken</title><published>invalid</published></entry></feed>" : "<feed/>", { status: failure === "404" ? 404 : 200 });
      }
      return new Response(page([video(url.includes("/streams") ? B : A)]));
    });
    const found = await recentVideos(w.env);
    assert.deepEqual(new Set(found.map((v) => v.video)), new Set([A, B]));
    assert.equal(w.calls.length, 3);
    assert.equal(w.writes.length, 1);
  });
}

test("total upstream outage retains last-good classes and retries soon without extending their lifetime", async (t) => {
  const w = worker(t, () => new Response("unavailable", { status: 404 }), { checked: Date.now() - 86400_000, videos: [retained] });
  assert.deepEqual(await recentVideos(w.env), [retained]);
  assert.equal(w.writes.length, 0);
  assert.equal([...w.edge.values()][0].headers.get("cache-control"), "public, max-age=60");
  w.edge.clear(); // Another edge has no Cache API entry but reads the shared KV snapshot.
  assert.deepEqual(await recentVideos(w.env), [retained]);
});

test("a partial channel outage merges known classes with new uploads and prefers fresh duplicates", async (t) => {
  const w = worker(t, (url) => url.includes("/videos?") ? new Response(page([video(A, { title: { simpleText: "Updated title" } })])) : new Response("", { status: 404 }),
    { checked: Date.now(), videos: [retained, { ...retained, video: A, title: "Old title" }] });
  const found = await recentVideos(w.env);
  assert.equal(found.length, 2);
  assert.equal(found.find((v) => v.video === A).title, "Updated title");
  assert.ok(found.some((v) => v.video === B));
});

test("cold/expired cache and failed sources retry in one minute without saving an empty result", async (t) => {
  const w = worker(t, () => new Response("<html>Consent required</html>"), { checked: Date.now() - 8 * 86400_000, videos: [retained] });
  assert.deepEqual(await recentVideos(w.env), []);
  assert.equal(w.writes.length, 0);
  assert.equal([...w.edge.values()][0].headers.get("cache-control"), "public, max-age=60");
});

test("KV failure does not discard successful fallback recordings", async (t) => {
  const w = worker(t, (url) => new Response(url.includes("feeds/") ? "" : page()));
  w.env.SUBS.get = async () => { throw new Error("KV unavailable"); };
  w.env.SUBS.put = async () => { throw new Error("KV unavailable"); };
  assert.deepEqual((await recentVideos(w.env)).map((v) => v.video), [A]);
});
