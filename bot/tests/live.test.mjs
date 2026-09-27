import test from "node:test";
import assert from "node:assert/strict";
import { parseLive } from "../src/live.mjs";

const page = (details, extra = "") => `<html>${extra}var ytInitialPlayerResponse = {"videoDetails":{${details}},"playerConfig":{}}</html>`;

test("a stream on the air is live, with its id and title", () => {
  const r = parseLive(page('"videoId":"lTjnCZsWsng","title":"THE IMAGE OF GOD \\u0026 MAN","isLive":true,"isLiveContent":true', '"isLiveNow":true'), "now");
  assert.deepEqual([r.live, r.upcoming, r.video, r.title], [true, false, "lTjnCZsWsng", "THE IMAGE OF GOD & MAN"]);
});
test("a scheduled stream is upcoming, with its start", () => {
  const r = parseLive(page('"videoId":"yRPiKi_Q6LU","title":"Class","isLive":true,"isUpcoming":true', '"scheduledStartTime":"1790500000"'), "now");
  assert.equal(r.live, false); assert.equal(r.upcoming, true); assert.equal(r.starts, "2026-09-27T09:06:40.000Z");
});
test("no player on the page means nothing is on", () => {
  assert.equal(parseLive("<html>channel page</html>", "now").video, null);
});
