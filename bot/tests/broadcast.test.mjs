import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { GrammyError } from "grammy/web";

const out = new URL("./.build/broadcast.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/broadcast.ts"; export { sendDaily } from "./src/daily.ts"; export { seal } from "./src/privacy.mjs";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", alias: { grammy: "grammy/web" }, outfile: out, logLevel: "error" });
const { createBroadcastSender, withBroadcastLease, BROADCAST_LEASE_KEY, BROADCAST_LEASE_SECONDS, sendDaily, seal } = await import(out);

function fakeClock() {
  let now = 0;
  const timers = [];
  return {
    now: () => now,
    sleep: (ms) => new Promise(resolve => timers.push({ at: now + ms, resolve })),
    async finish(promise) {
      let done = false, value, error;
      promise.then(v => { value = v; done = true; }, e => { error = e; done = true; });
      for (let i = 0; !done && i < 10000; i++) {
        // Let promise continuations and the mocked Response bodies complete before advancing time.
        await new Promise(resolve => setImmediate(resolve));
        if (!done && timers.length) {
          timers.sort((a, b) => a.at - b.at); now = timers[0].at;
          while (timers.length && timers[0].at <= now) timers.shift().resolve();
        }
      }
      assert.ok(done, "fake clock drained");
      if (error) throw error;
      return value;
    },
  };
}
const flood = (seconds) => new GrammyError("fixture flood", { ok: false, error_code: 429, description: "fixture flood", parameters: seconds === undefined ? {} : { retry_after: seconds } }, "sendMessage", {});

test("one budget spaces daily, reading and top-up attempts at no more than 25/s", async () => {
  const time = fakeClock(), sender = createBroadcastSender(time), starts = [];
  await time.finish(Promise.all(Array.from({ length: 80 }, (_, i) => sender.send(async () => { starts.push({ at: time.now(), kind: ["daily", "reading", "topup"][i % 3] }); }))));
  assert.equal(starts.length, 80);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].at - starts[i - 1].at >= 40);
  for (const start of starts) assert.ok(starts.filter(x => x.at >= start.at && x.at < start.at + 1000).length <= 25);
});

test("a 429 pauses every queued sender for the full retry_after, including values above 60s", async () => {
  const time = fakeClock(), sender = createBroadcastSender(time), starts = [];
  let tries = 0;
  const first = sender.send(async () => { starts.push(time.now()); if (++tries === 1) throw flood(90); return "ok"; });
  const others = Array.from({ length: 30 }, () => sender.send(async () => { starts.push(time.now()); }));
  await time.finish(Promise.all([first, ...others]));
  assert.equal(tries, 2);
  assert.equal(starts[0], 0);
  assert.ok(starts.slice(1).every(t => t >= 90000), "queued turns recheck a cooldown extended while asleep");
  for (let i = 2; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 40);
});

test("a repeated 429 still cools down the queue; other failures neither retry nor poison it", async () => {
  const time = fakeClock(), sender = createBroadcastSender(time);
  let tries = 0;
  await assert.rejects(time.finish(sender.send(async () => { tries++; throw flood(70); })), e => e.error_code === 429);
  assert.equal(tries, 2);
  const lastFailure = time.now();
  let started;
  await time.finish(sender.send(async () => { started = time.now(); }));
  assert.ok(started >= lastFailure + 70000);
  let refused = 0;
  await assert.rejects(time.finish(sender.send(async () => { refused++; throw new Error("fixture refusal"); })), /fixture refusal/);
  assert.equal(refused, 1);
  assert.equal(await time.finish(sender.send(async () => "next")), "next");
});

test("missing or invalid retry_after uses a safe one-second cooldown", async () => {
  for (const seconds of [undefined, -1, "bad"]) {
    const time = fakeClock(), sender = createBroadcastSender(time), starts = [];
    await time.finish(sender.send(async () => { starts.push(time.now()); if (starts.length === 1) throw flood(seconds); }));
    assert.deepEqual(starts, [0, 1000]);
  }
});

function leaseKV() {
  const values = new Map(), ttls = [];
  return {
    values, ttls,
    get: async (key) => values.has(key) ? JSON.parse(values.get(key)) : null,
    put: async (key, value, options) => { values.set(key, value); ttls.push(options.expirationTtl); },
    delete: async key => { values.delete(key); },
  };
}

test("a still-running broadcast leases out the next cron; completion releases it", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10000 });
  const kv = leaseKV(); let release;
  const first = withBroadcastLease(kv, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  let second = false;
  t.mock.timers.tick(15 * 60000);
  assert.equal(await withBroadcastLease(kv, async () => { second = true; }), false);
  assert.equal(second, false);
  assert.deepEqual(kv.ttls, [BROADCAST_LEASE_SECONDS]);
  release(); assert.equal(await first, true);
  assert.equal(kv.values.has(BROADCAST_LEASE_KEY), false);
});

test("expired leases recover, errors release, and a replacement owner is never deleted", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10000 });
  const kv = leaseKV();
  kv.values.set(BROADCAST_LEASE_KEY, JSON.stringify({ owner: "expired", until: 9999 }));
  await assert.rejects(withBroadcastLease(kv, async () => { throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(kv.values.size, 0);
  await withBroadcastLease(kv, async () => { kv.values.set(BROADCAST_LEASE_KEY, JSON.stringify({ owner: "replacement", until: 999999 })); });
  assert.equal((await kv.get(BROADCAST_LEASE_KEY)).owner, "replacement");
});

test("lost lease ownership or a KV read failure prevents delivery", async () => {
  const kv = leaseKV(); let ran = false;
  const put = kv.put;
  kv.put = async (...args) => { await put(...args); kv.values.set(BROADCAST_LEASE_KEY, JSON.stringify({ owner: "other", until: Date.now() + 1000 })); };
  assert.equal(await withBroadcastLease(kv, async () => { ran = true; }), false);
  assert.equal(ran, false);
  await assert.rejects(withBroadcastLease({ ...kv, get: async () => { throw new Error("KV unavailable"); } }, async () => { ran = true; }), /KV unavailable/);
  assert.equal(ran, false);
});

test("daily delivery batches sealed subscriptions and due sent dates, retaining pagination and failure handling", async (t) => {
  const when = new Date("2026-11-07T12:00:00Z"), values = new Map(), bulk = [], single = [], checkpoints = [];
  const names = Array.from({ length: 257 }, (_, i) => `sub:reader-${i}`);
  const token = ["fixture", "not-a-credential"].join("-");
  const env = { BOT_TOKEN: token, PRIVACY_KEY: token, DATA_ORIGIN: "https://data.invalid", WORKER_URL: "https://bot.invalid", SUBS: {
    get: async (key, type) => {
      if (Array.isArray(key)) { bulk.push([...key]); return new Map(key.map(k => [k, values.get(k) ?? null])); }
      single.push(key); const value = values.get(key); return value == null ? null : type === "json" ? JSON.parse(value) : value;
    },
    put: async (key, value) => { values.set(key, value); if (key.startsWith("daily:")) checkpoints.push(JSON.parse(value)); },
    delete: async key => { values.delete(key); },
    list: async ({ cursor }) => ({ keys: (cursor ? names.slice(175) : names.slice(0, 175)).map(name => ({ name })), list_complete: !!cursor, ...(cursor ? {} : { cursor: "next" }) }),
  } };
  values.set("daily:2026-11-07:11", JSON.stringify({ done: true }));
  for (let i = 0; i < names.length; i++) values.set(names[i], JSON.stringify({ chatId: i + 10000, hour: 12, tz: 0 }));
  values.set(names[6], await seal(env, names[6], { chatId: 10006, hour: 12, tz: 0 }));
  const sealed = values.get(names[6]);
  values.set("sent:reader-0", "2026-11-07"); values.delete(names[1]); values.set(names[2], "{invalid");
  values.set(names[3], JSON.stringify({ chatId: 10003, hour: 13, tz: 0 }));
  values.set("sent:reader-4", "2026-11-06");
  const realCaches = globalThis.caches;
  t.after(() => { globalThis.caches = realCaches; });
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const time = fakeClock(), attempts = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/sendMessage")) {
      const msg = JSON.parse(init.body); attempts.push(time.now());
      const code = msg.chat_id === 10004 ? 403 : msg.chat_id === 10005 ? 500 : 0;
      return Response.json(code ? { ok: false, error_code: code, description: "fixture refusal" } : { ok: true, result: { message_id: attempts.length } }, { status: code || 200 });
    }
    if (url.startsWith("https://data.invalid/api/kjv/")) return Response.json({ verses: Array.from({ length: 200 }, (_, i) => ({ verse: i + 1, text: "Fixture content" })) });
    throw new Error("Unexpected outbound request");
  });
  const result = await time.finish(sendDaily(env, when, createBroadcastSender(time)));
  assert.deepEqual(result, { sent: 251, dropped: 1, failed: 1 });
  assert.equal(bulk.length, 6, "3 subscription batches + 3 sent-date batches, not one call per reader");
  assert.ok(bulk.every(keys => keys.length > 0 && keys.length <= 100));
  assert.ok(single.every(key => key.startsWith("daily:")), "no individual subscriber or sent-date reads");
  assert.ok(checkpoints.some(s => s.cursor === "next" && !s.done));
  assert.equal(checkpoints.at(-1).done, true);
  assert.equal(values.has(names[4]), false); assert.equal(values.has("sent:reader-4"), false);
  assert.equal(values.get(names[6]), sealed, "delivery never rewrites a sealed subscription");
  assert.equal(values.get("sent:reader-6"), "2026-11-07");
  for (let i = 1; i < attempts.length; i++) assert.ok(attempts[i] - attempts[i - 1] >= 40);
});
