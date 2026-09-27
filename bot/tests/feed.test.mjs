import test from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, parseFeed } from "../src/live.mjs";

test("an all-caps title reads as the notes spell it", () => {
  assert.equal(cleanTitle("THE ART OF WAR - RULES OF ENGAGEMENT"), "The Art of War - Rules of Engagement");
  assert.equal(cleanTitle("The Issues Of Life: Mind, Body, & Soul #IUIC"), "The Issues Of Life: Mind, Body, & Soul");
});
test("the channel feed lists the uploads newest first", () => {
  const xml = `<feed><entry><yt:videoId>eNMvid6j-qk</yt:videoId><title>THE ART OF WAR &amp; PEACE</title><published>2026-09-26T16:29:24+00:00</published><media:group><media:community><media:statistics views="19373"/></media:community></media:group></entry><entry><yt:videoId>lTjnCZsWsng</yt:videoId><title>LATER</title><published>2026-09-26T21:55:07+00:00</published></entry></feed>`;
  const r = parseFeed(xml);
  assert.deepEqual(r.map((v) => v.video), ["lTjnCZsWsng", "eNMvid6j-qk"]);
  assert.deepEqual([r[1].title, r[1].views, r[0].views], ["The Art of War & Peace", 19373, null]);
});
