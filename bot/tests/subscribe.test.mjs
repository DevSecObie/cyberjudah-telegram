import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { signInitData } from "../src/initdata.mjs";

// The daily verse's subscription: POST /api/subscribe checks what it's sent (a 400, never a quiet
// default), keeps an IANA zone when the app sends one, and the daily send finds the subscriber's
// local hour from that zone (right across daylight saving) or, for older apps, the minutes offset.
const out = new URL("./.build/subscribe.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/subscribe.ts"; export { localHour } from "./src/daily.ts"; export { open } from "./src/privacy.mjs"; export { default as worker } from "./src/index.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const m = await import(out);

const TOKEN = ["test-bot", "token", "not-a-credential"].join("-");

test("parseSubscribe accepts a real zone and keeps it as sent", () => {
  assert.deepEqual(m.parseSubscribe({ on: true, hour: 7, tz: -300, zone: "America/Chicago" }), { ok: true, on: true, hour: 7, tz: -300, zone: "America/Chicago" });
  assert.equal(m.parseSubscribe({ on: true, hour: 7, zone: "Europe/London" }).zone, "Europe/London");
  assert.equal(m.parseSubscribe({ on: true, hour: 7, zone: "Asia/Kolkata" }).zone, "Asia/Kolkata");
  assert.equal(m.parseSubscribe({ on: true, hour: 7, zone: "UTC" }).zone, "UTC");
});

test("parseSubscribe keeps the older offset-only body working, with the same defaults when a field is absent", () => {
  assert.deepEqual(m.parseSubscribe({ on: true, hour: 6, tz: 120 }), { ok: true, on: true, hour: 6, tz: 120 });
  assert.deepEqual(m.parseSubscribe({ on: true }), { ok: true, on: true, hour: 8, tz: 0 });
  assert.deepEqual(m.parseSubscribe({ on: true, hour: 6, zone: null }), { ok: true, on: true, hour: 6, tz: 0 });
  assert.deepEqual(m.parseSubscribe({ on: false, hour: 99 }), { ok: true, on: false });
  assert.deepEqual(m.parseSubscribe({}), { ok: true, on: false });
});

test("parseSubscribe refuses what isn't valid instead of defaulting it", () => {
  const bad = (body, error) => assert.deepEqual(m.parseSubscribe(body), { ok: false, error }, JSON.stringify(body));
  for (const body of [null, [], "on", 5]) bad(body, "bad-json");
  bad({ on: "yes" }, "bad-on");
  for (const hour of [-1, 24, 7.5, "7", null, Number.NaN]) bad({ on: true, hour }, "bad-hour");
  for (const tz of [841, -841, 30.5, "60", null]) bad({ on: true, hour: 7, tz }, "bad-tz");
  for (const zone of ["Mars/Olympus", "", "America/Chicago ", "../etc", "EST5EDT\n", 5, {}, "x".repeat(65)]) bad({ on: true, hour: 7, zone }, "bad-zone");
});

test("a zone follows daylight saving; an offset doesn't", () => {
  const sub = { tz: -300, zone: "America/Chicago" };
  // 08:00 in Chicago is 14:00 UTC in January (CST, UTC-6) and 13:00 UTC in July (CDT, UTC-5).
  assert.equal(m.subscriberHour(sub, new Date("2026-01-15T14:00:00Z")), 8);
  assert.equal(m.subscriberHour(sub, new Date("2026-07-15T13:00:00Z")), 8);
  // The fixed offset (-300, CDT) is an hour off in January.
  assert.equal(m.subscriberHour({ tz: -300 }, new Date("2026-01-15T14:00:00Z")), 9);
  // The switch itself: 2026-03-08, Chicago springs forward at 08:00 UTC.
  assert.equal(m.subscriberHour(sub, new Date("2026-03-08T07:00:00Z")), 1);
  assert.equal(m.subscriberHour(sub, new Date("2026-03-08T08:00:00Z")), 3);
  // Half-hour zones round down, as the offset did.
  assert.equal(m.subscriberHour({ tz: 330, zone: "Asia/Kolkata" }, new Date("2026-01-15T02:00:00Z")), 7);
  assert.equal(m.localHour(2, 330), 7);
});

test("a stored zone that isn't valid falls back to the offset", () => {
  assert.equal(m.subscriberHour({ tz: 60, zone: "Not/AZone" }, new Date("2026-01-15T06:00:00Z")), 7);
});

// The route itself, through the Worker with signed Telegram launch data.
const kv = new Map();
const env = {
  BOT_TOKEN: TOKEN, PRIVACY_KEY: "subscribe-test",
  SUBS: { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); }, list: async () => ({ keys: [...kv.keys()].map((name) => ({ name })), list_complete: true }) },
};
const auth = async () => `tma ${await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: 4242, first_name: "Test" } }, TOKEN)}`;
const subscribe = async (body) => m.worker.fetch(new Request("https://test/api/subscribe", { method: "POST", headers: { authorization: await auth(), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }), env, { waitUntil() {} });
const stored = async () => { const [name] = [...kv.keys()].filter((k) => k.startsWith("sub:")); return name ? m.open(env, name, kv.get(name)) : null; };

test("POST /api/subscribe stores the zone and answers 400 for bad input", async () => {
  let r = await subscribe({ on: true, hour: 7, tz: -300, zone: "America/Chicago" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { subscribed: true, hour: 7, zone: "America/Chicago" });
  assert.deepEqual(await stored(), { chatId: 4242, hour: 7, tz: -300, zone: "America/Chicago" });

  r = await subscribe({ on: true, hour: 6, tz: 60 });
  assert.equal(r.status, 200);
  assert.deepEqual(await stored(), { chatId: 4242, hour: 6, tz: 60 });

  for (const [body, error] of [[{ on: true, hour: 24 }, "bad-hour"], [{ on: true, hour: 7, tz: 9999 }, "bad-tz"], [{ on: true, hour: 7, zone: "Mars/Olympus" }, "bad-zone"], ["{not json", "bad-json"], [null, "bad-json"]]) {
    const res = await subscribe(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { error }, JSON.stringify(body));
  }
  // A refused request leaves the subscription as it was.
  assert.deepEqual(await stored(), { chatId: 4242, hour: 6, tz: 60 });

  r = await subscribe({ on: false });
  assert.deepEqual(await r.json(), { subscribed: false });
  assert.equal(await stored(), null);
});
