import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { build } from "esbuild";

const out = new URL("./.build/class-alerts.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/class-alerts.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error", plugins: [{ name: "fixtures", setup(b) {
  b.onResolve({ filter: /^\.\/live$/ }, () => ({ path: "live", namespace: "fixture" }));
  b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents:
    `export async function recentVideos(env) { return env.recent }
     export async function liveNow(env) { return env.live }` }));
}}] });
const { sendClassAlerts } = await import(out);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = JSON.stringify({ type: "service_account", project_id: "cyberjudah-app", client_email: "fcm@cyberjudah-app.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const kv = () => { const m = new Map(); return { m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } }; };
const off = { live: false, upcoming: false, video: null, title: null, starts: null, checked: "" };
const now = Date.parse("2026-11-07T20:00:00Z");
const feed = (videos) => ({ ok: true, videos: videos.map(([video, title]) => ({ video, title, published: "2026-11-07T19:00:00Z", views: null })) });

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    return new Response("{}", { status: 200 });
  };
  return calls;
}

test("off without a topic or without the credential", async () => {
  const calls = mockFetch();
  assert.equal((await sendClassAlerts({ SUBS: kv(), recent: feed([]), live: off }, now)).skipped, "off");
  assert.equal((await sendClassAlerts({ SUBS: kv(), CLASS_ALERTS_TOPIC: "new-classes", recent: feed([]), live: off }, now)).skipped, "no_credentials");
  assert.equal(calls.length, 0);
});

test("first run remembers, a later upload is sent once to the topic", async () => {
  const calls = mockFetch();
  const env = { SUBS: kv(), CLASS_ALERTS_TOPIC: "new-classes", FIREBASE_SERVICE_ACCOUNT: account, recent: feed([["AAAAAAAAAAA", "Old"]]), live: off };
  assert.equal((await sendClassAlerts(env, now)).seeded, true);
  assert.equal(calls.length, 0);
  env.recent = feed([["BBBBBBBBBBB", "New class title"], ["AAAAAAAAAAA", "Old"]]);
  const run = await sendClassAlerts(env, now);
  assert.equal(run.sent, 1);
  const send = calls.find((c) => c.url.includes("fcm.googleapis.com"));
  assert.match(send.url, /projects\/cyberjudah-app\/messages:send$/);
  const body = JSON.parse(send.init.body);
  assert.equal(body.message.topic, "new-classes");
  assert.equal(body.message.data.video, "BBBBBBBBBBB");
  assert.equal((await sendClassAlerts(env, now)).sent, 0);
});

test("a feed outage sends nothing and keeps the memory", async () => {
  const calls = mockFetch();
  const env = { SUBS: kv(), CLASS_ALERTS_TOPIC: "new-classes", FIREBASE_SERVICE_ACCOUNT: account, recent: { ok: false, videos: [] }, live: off };
  assert.equal((await sendClassAlerts(env, now)).skipped, "feed_down");
  assert.equal(env.SUBS.m.size, 0);
  assert.equal(calls.length, 0);
});

test("a credential for another project is refused", async () => {
  mockFetch();
  const other = JSON.stringify({ ...JSON.parse(account), project_id: "someone-else" });
  const env = { SUBS: kv(), CLASS_ALERTS_TOPIC: "new-classes", FIREBASE_SERVICE_ACCOUNT: other, recent: feed([["AAAAAAAAAAA", "Old"]]), live: off };
  await sendClassAlerts(env, now);
  env.recent = feed([["BBBBBBBBBBB", "New"], ["AAAAAAAAAAA", "Old"]]);
  await assert.rejects(sendClassAlerts(env, now), /Invalid signing configuration/);
});
