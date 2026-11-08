import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { signInitData } from "../src/initdata.mjs";

// The daily verse's subscription: POST /api/subscribe checks what it's sent (a 400, never a quiet
// default), keeps an IANA zone when the app sends one, and the daily send finds the subscriber's
// local hour from that zone (right across daylight saving) or, for older apps, the minutes offset.
const out = new URL("./.build/subscribe.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/subscribe.ts"; export { open, seal } from "./src/privacy.mjs"; export { default as worker } from "./src/index.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const m = await import(out);
// The daily send as it runs on the Worker: grammy's web build, which calls the global fetch (stubbed below).
const outDaily = new URL("./.build/subscribe-daily.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { sendDaily } from "./src/daily.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", alias: { grammy: "grammy/web" }, outfile: outDaily, logLevel: "error" });
const { sendDaily } = await import(outDaily);

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
  for (const hour of [-1, 24, 7.5, "7", Number.NaN]) bad({ on: true, hour }, "bad-hour");
  for (const tz of [841, -841, 30.5, "60"]) bad({ on: true, hour: 7, tz }, "bad-tz");
  // null is absent, as the older handler treated it: the default.
  assert.deepEqual(m.parseSubscribe({ on: true, hour: null, tz: null }), { ok: true, on: true, hour: 8, tz: 0 });
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
  assert.equal(m.offsetHour(2, 330), 7);
});

test("a subscriber at local midnight is due at hour 0, even where Intl says 24", () => {
  // 00:00 in Chicago is 06:00 UTC in January.
  const at = new Date("2026-01-15T06:00:00Z");
  assert.equal(m.subscriberHour({ tz: -360, zone: "America/Chicago" }, at), 0);
  assert.equal(m.isDue({ on: true, hour: 0, tz: -360, zone: "America/Chicago" }, at), true);
  // A runtime that ignores hourCycle "h23" and gives midnight as "24" (a zone not yet cached).
  const real = Intl.DateTimeFormat.prototype.formatToParts;
  Intl.DateTimeFormat.prototype.formatToParts = function (d) { return real.call(this, d).map((p) => (p.type === "hour" && p.value === "0" ? { ...p, value: "24" } : p)); };
  try {
    assert.equal(m.subscriberHour({ tz: 60, zone: "Europe/Berlin" }, new Date("2026-01-14T23:00:00Z")), 0);
  } finally { Intl.DateTimeFormat.prototype.formatToParts = real; }
});

test("shared localHour gives midnight as 0 even where Intl says 24", async () => {
  const { localHour } = await import("../../shared/holy-days.mjs");
  const real = Intl.DateTimeFormat.prototype.formatToParts;
  Intl.DateTimeFormat.prototype.formatToParts = function (d) { return real.call(this, d).map((p) => (p.type === "hour" && p.value === "0" ? { ...p, value: "24" } : p)); };
  try { assert.equal(localHour(Date.parse("2026-01-15T05:00:00Z"), "America/New_York"), 0); }
  finally { Intl.DateTimeFormat.prototype.formatToParts = real; }
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
    assert.deepEqual(await res.json(), { error, reason: error }, JSON.stringify(body));
  }
  // A refused request leaves the subscription as it was.
  assert.deepEqual(await stored(), { chatId: 4242, hour: 6, tz: 60 });

  const [name] = [...kv.keys()].filter((k) => k.startsWith("sub:"));
  kv.set(m.sentKeyOf(name), "2026-11-07");
  r = await subscribe({ on: false });
  assert.deepEqual(await r.json(), { subscribed: false });
  assert.equal(await stored(), null);
  // Turning it off also deletes the date it last went out.
  assert.equal(kv.has(m.sentKeyOf(name)), false);
});

test("the night clocks fall back, a repeated hour sends the verse once", async () => {
  // Chicago, 2026-11-01: 01:00 local happens at 06:00 UTC (CDT) and again at 07:00 UTC (CST).
  const sub = { chatId: 1, hour: 1, tz: -300, zone: "America/Chicago" };
  const first = new Date("2026-11-01T06:00:00Z"), again = new Date("2026-11-01T07:00:00Z");
  assert.equal(m.subscriberHour(sub, first), 1);
  assert.equal(m.subscriberHour(sub, again), 1);
  assert.equal(m.subscriberDate(sub, first), "2026-11-01");
  assert.equal(m.isDue(sub, first), true);
  assert.equal(m.isDue(sub, again, "2026-11-01"), false);
  // The next day it's due again.
  assert.equal(m.isDue(sub, new Date("2026-11-02T07:00:00Z"), "2026-11-01"), true);
  assert.equal(m.sentKeyOf("sub:abc"), "sent:abc");
  // A subscription still keyed by the raw Telegram ID (not yet migrated) gets no sent key.
  assert.equal(m.sentKeyOf("sub:12345678"), null);
  // An offset-only subscriber's date is taken at their offset.
  assert.equal(m.subscriberDate({ tz: -300 }, new Date("2026-11-01T03:00:00Z")), "2026-10-31");
});

test("the night clocks spring forward, a skipped hour is due at the next hour that exists", () => {
  // Chicago, 2026-03-08: at 08:00 UTC the clock goes from 01:59 to 03:00, so 02:00 never happens.
  const sub = { chatId: 1, hour: 2, tz: -360, zone: "America/Chicago" };
  assert.equal(m.isDue(sub, new Date("2026-03-08T07:00:00Z")), false); // 01:00
  assert.equal(m.isDue(sub, new Date("2026-03-08T08:00:00Z")), true); // 03:00, the first hour after 02:00
  assert.equal(m.isDue(sub, new Date("2026-03-08T08:00:00Z"), "2026-03-08"), false);
  // A 03:00 subscriber is due at 03:00 as usual.
  assert.equal(m.isDue({ ...sub, hour: 3 }, new Date("2026-03-08T08:00:00Z")), true);
  // The next day 02:00 exists again.
  assert.equal(m.isDue(sub, new Date("2026-03-09T07:00:00Z")), true);
  assert.equal(m.isDue(sub, new Date("2026-03-09T08:00:00Z")), false);
  // The fall-back night repeats an hour; no other hour becomes due.
  for (const hour of [0, 2, 3, 5, 12, 23]) assert.equal(m.isDue({ ...sub, hour }, new Date("2026-11-01T07:00:00Z")), false, String(hour));
  // An offset-only subscriber has no skipped hours.
  assert.equal(m.isDue({ chatId: 1, hour: 2, tz: -360 }, new Date("2026-03-08T09:00:00Z")), false);
});

test("changing the hour leaves the date the verse was last sent", async () => {
  await subscribe({ on: true, hour: 7, tz: -360, zone: "America/Chicago" });
  const [name] = [...kv.keys()].filter((k) => k.startsWith("sub:"));
  kv.set(m.sentKeyOf(name), "2026-11-07");
  await subscribe({ on: true, hour: 20, tz: -360, zone: "America/Chicago" });
  assert.equal(kv.get(m.sentKeyOf(name)), "2026-11-07");
  // So the new hour, later the same local day, doesn't send a second verse.
  assert.equal(m.isDue(await stored(), new Date("2026-11-08T02:00:00Z"), kv.get(m.sentKeyOf(name))), false);
  await subscribe({ on: false });
  kv.delete(m.sentKeyOf(name));
});

test("sendDaily sends once across the fall-back night and notes the local date beside the subscription", async () => {
  const store = new Map(), ttls = new Map();
  const daily = {
    BOT_TOKEN: TOKEN, PRIVACY_KEY: "subscribe-test", DATA_ORIGIN: "https://data.invalid", WORKER_URL: "https://bot.invalid",
    SUBS: {
      get: async (k, type) => Array.isArray(k) ? new Map(k.map(key => [key, store.get(key) ?? null])) : (store.has(k) ? (type === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v, o) => { store.set(k, v); ttls.set(k, o?.expirationTtl); }, delete: async (k) => { store.delete(k); },
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    },
  };
  const name = "sub:fallback";
  store.set(name, await m.seal(daily, name, { chatId: 77, hour: 1, tz: -300, zone: "America/Chicago" }));
  const sent = [];
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/sendMessage")) {
      const msg = JSON.parse(init?.body ?? "{}");
      if (msg.chat_id === 88) return Response.json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, { status: 403 });
      sent.push(msg); return Response.json({ ok: true, result: { message_id: sent.length } });
    }
    if (url.startsWith("https://data.invalid/api/kjv/")) return Response.json({ verses: Array.from({ length: 200 }, (_, i) => ({ verse: i + 1, text: `Verse ${i + 1}` })) });
    return new Response("not found", { status: 404 });
  };
  try {
    await sendDaily(daily, new Date("2026-11-01T06:00:00Z"));
    assert.equal(sent.length, 1);
    assert.equal(store.get("sent:fallback"), "2026-11-01");
    assert.equal(ttls.get("sent:fallback"), 2 * 86400);
    // The subscription itself is never rewritten by the send.
    const sealed = store.get(name);
    await sendDaily(daily, new Date("2026-11-01T07:00:00Z"));
    assert.equal(sent.length, 1, "01:00 again after the clocks fell back: not sent twice");
    await sendDaily(daily, new Date("2026-11-02T07:00:00Z"));
    assert.equal(sent.length, 2, "the next day's 01:00 sends again");
    assert.equal(store.get("sent:fallback"), "2026-11-02");
    assert.equal(store.get(name), sealed);
    assert.deepEqual(await m.open(daily, name, store.get(name)), { chatId: 77, hour: 1, tz: -300, zone: "America/Chicago" });
    // Turned off while the send runs: nothing brings the subscription back.
    store.delete(name);
    await sendDaily(daily, new Date("2026-11-03T07:00:00Z"));
    assert.equal(store.has(name), false);
    assert.equal(sent.length, 2);
    // A person who blocked the bot is dropped, with the date the verse last went out.
    store.set("sub:blocked", await m.seal(daily, "sub:blocked", { chatId: 88, hour: 1, tz: -360, zone: "America/Chicago" }));
    store.set("sent:blocked", "2026-11-02");
    await sendDaily(daily, new Date("2026-11-04T07:00:00Z"));
    assert.equal(store.has("sub:blocked"), false);
    assert.equal(store.has("sent:blocked"), false);
    // A subscription not yet migrated off the raw Telegram ID: sent, but no key names that ID.
    store.set("sub:12345678", JSON.stringify({ chatId: 99, hour: 1, tz: -360, zone: "America/Chicago" }));
    const before = sent.length;
    await sendDaily(daily, new Date("2026-11-05T07:00:00Z"));
    assert.equal(sent.length, before + 1);
    assert.ok(![...store.keys()].some((k) => k.startsWith("sent:") && k.includes("12345678")));
  } finally {
    globalThis.fetch = realFetch; globalThis.caches = realCaches;
  }
});
