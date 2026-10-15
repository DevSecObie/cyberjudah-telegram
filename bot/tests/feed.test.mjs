import test from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, parseFeed } from "../src/live.mjs";

test("an all-caps title reads as the notes spell it", () => {
  assert.equal(cleanTitle("THE ART OF WAR - RULES OF ENGAGEMENT"), "The Art of War - Rules of Engagement");
  assert.equal(cleanTitle("The Issues Of Life: Mind, Body, & Soul #IUIC"), "The Issues Of Life: Mind, Body, & Soul");
});
test("the channel feed lists the uploads newest day first", () => {
  const xml = `<feed><entry><yt:videoId>eNMvid6j-qk</yt:videoId><title>THE ART OF WAR &amp; PEACE</title><published>2026-09-26T16:29:24+00:00</published><media:group><media:community><media:statistics views="19373"/></media:community></media:group></entry><entry><yt:videoId>lTjnCZsWsng</yt:videoId><title>LATER</title><published>2026-09-25T21:55:07+00:00</published></entry></feed>`;
  const r = parseFeed(xml);
  assert.deepEqual(r.map((v) => v.video), ["eNMvid6j-qk", "lTjnCZsWsng"]);
  assert.deepEqual([r[0].title, r[0].views, r[1].views], ["The Art of War & Peace", 19373, null]);
});
test("same-day uploads keep the feed's order, not their upload timestamps", () => {
  // Oct 10, 2026, as the owner reported it: the feed lists The Ear Gate first, but its
  // published timestamp (18:55Z) is earlier than Dominican & Haitian History's (19:18Z).
  // The feed order is the taught order; the timestamps are only upload times.
  const xml = `<feed><entry><yt:videoId>earGate0001</yt:videoId><title>THE EAR GATE</title><published>2026-10-10T18:55:00+00:00</published></entry><entry><yt:videoId>dominican01</yt:videoId><title>DOMINICAN &amp; HAITIAN HISTORY</title><published>2026-10-10T19:18:00+00:00</published></entry><entry><yt:videoId>trueUnity01</yt:videoId><title>TRUE UNITY AMONGST THE ISRAELITES</title><published>2026-10-10T20:02:00+00:00</published></entry></feed>`;
  assert.deepEqual(parseFeed(xml).map((v) => v.video), ["earGate0001", "dominican01", "trueUnity01"]);
});
