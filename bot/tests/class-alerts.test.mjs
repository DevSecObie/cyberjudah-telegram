import { test } from "node:test";
import assert from "node:assert/strict";
import { planClassAlerts, fcmMessage, ALERTS_PER_RUN } from "../src/class-alerts.mjs";

const now = Date.parse("2026-11-07T20:00:00Z");
const v = (video, title, published = "2026-11-07T19:00:00Z") => ({ video, title, published, views: null });
const off = { live: false, upcoming: false, video: null, title: null, starts: null, checked: "" };

test("a first run only remembers what is already up", () => {
  const plan = planClassAlerts({ videos: [v("AAAAAAAAAAA", "One"), v("BBBBBBBBBBB", "Two")], live: off, seen: null, now });
  assert.deepEqual(plan.alerts, []);
  assert.deepEqual(plan.seen, ["AAAAAAAAAAA", "BBBBBBBBBBB"]);
});

test("a new upload is announced once", () => {
  const first = planClassAlerts({ videos: [v("CCCCCCCCCCC", "New one"), v("AAAAAAAAAAA", "One")], live: off, seen: ["AAAAAAAAAAA"], now });
  assert.deepEqual(first.alerts, [{ video: "CCCCCCCCCCC", title: "New one", live: false }]);
  const again = planClassAlerts({ videos: [v("CCCCCCCCCCC", "New one"), v("AAAAAAAAAAA", "One")], live: off, seen: first.seen, now });
  assert.deepEqual(again.alerts, []);
});

test("an upcoming stream waits until it is live, then is announced as live", () => {
  const upcoming = { ...off, upcoming: true, video: "DDDDDDDDDDD", title: "Sabbath class" };
  const waiting = planClassAlerts({ videos: [v("DDDDDDDDDDD", "Sabbath class")], live: upcoming, seen: ["AAAAAAAAAAA"], now });
  assert.deepEqual(waiting.alerts, []);
  assert.ok(!waiting.seen.includes("DDDDDDDDDDD"));
  const onAir = { ...off, live: true, video: "DDDDDDDDDDD", title: "Sabbath class" };
  const started = planClassAlerts({ videos: [v("DDDDDDDDDDD", "Sabbath class")], live: onAir, seen: waiting.seen, now });
  assert.deepEqual(started.alerts, [{ video: "DDDDDDDDDDD", title: "Sabbath class", live: true }]);
  const later = planClassAlerts({ videos: [v("DDDDDDDDDDD", "Sabbath class")], live: off, seen: started.seen, now });
  assert.deepEqual(later.alerts, []);
});

test("old uploads, bad ids and floods are not announced", () => {
  const old = planClassAlerts({ videos: [v("EEEEEEEEEEE", "Old", "2026-11-01T00:00:00Z"), v("bad id", "Bad")], live: off, seen: [], now });
  assert.deepEqual(old.alerts, []);
  const many = Array.from({ length: 6 }, (_, i) => v(`FFFFFFFFFF${i}`, `Class ${i}`));
  const flood = planClassAlerts({ videos: many, live: off, seen: [], now });
  assert.equal(flood.alerts.length, ALERTS_PER_RUN);
  assert.equal(flood.seen.length, 6, "the rest are remembered, not sent later");
});

test("the message goes to the topic with only the class in it", () => {
  const { message } = fcmMessage({ video: "CCCCCCCCCCC", title: "New one", live: false }, "new-classes");
  assert.equal(message.topic, "new-classes");
  assert.equal(message.token, undefined);
  assert.deepEqual(message.notification, { title: "New class", body: "New one" });
  assert.deepEqual(message.data, { kind: "new-class", video: "CCCCCCCCCCC", title: "New one" });
  assert.equal(message.android.notification.channel_id, "new-classes");
});
