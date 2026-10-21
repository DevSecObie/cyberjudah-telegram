import { test } from "node:test";
import assert from "node:assert/strict";
import { area, vitalsPoints } from "../../shared/vitals.mjs";

const report = { area: "read", platform: "telegram", nav: "navigate", conn: "4g", metrics: { TTFB: 120, LCP: 1800, CLS: 0.02 } };

test("a speed report becomes one data point per measurement, with nothing but the report in it", () => {
  assert.deepEqual(vitalsPoints(report), [
    { indexes: ["TTFB"], blobs: ["TTFB", "read", "telegram", "navigate", "4g"], doubles: [120] },
    { indexes: ["LCP"], blobs: ["LCP", "read", "telegram", "navigate", "4g"], doubles: [1800] },
    { indexes: ["CLS"], blobs: ["CLS", "read", "telegram", "navigate", "4g"], doubles: [0.02] },
  ]);
  const { conn: _conn, ...noConn } = report;
  assert.equal(vitalsPoints(noConn)[0].blobs[4], "unknown");
  assert.equal(vitalsPoints({ ...report, user: 42, initData: "x" }).flatMap((p) => p.blobs).some((b) => /42|x/.test(b)), false);
});

test("anything but a report the app sends is refused", () => {
  for (const bad of [null, "x", [], {}, { ...report, area: "read/genesis/1" }, { ...report, platform: "linux" }, { ...report, nav: "x" }, { ...report, conn: "5g" },
    { ...report, metrics: {} }, { ...report, metrics: [] }, { ...report, metrics: { FID: 10 } }, { ...report, metrics: { toString: 1 } }, { ...report, metrics: { LCP: -1 } },
    { ...report, metrics: { LCP: 60_001 } }, { ...report, metrics: { LCP: "1" } }, { ...report, metrics: { LCP: Number.NaN } }, { ...report, metrics: { CLS: 51 } }]) {
    assert.equal(vitalsPoints(bad), null, JSON.stringify(bad));
  }
});

test("a path is reduced to its screen area, never the book, video or note in it", () => {
  assert.equal(area("/app/"), "home");
  assert.equal(area("/"), "home");
  assert.equal(area("/app/read/genesis/1"), "read");
  assert.equal(area("/watch/dQw4w9WgXcQ"), "watch");
  assert.equal(area("/app/settings/credits"), "settings");
  assert.equal(area("/application"), "other");
  assert.equal(area("/somewhere/else"), "other");
});
