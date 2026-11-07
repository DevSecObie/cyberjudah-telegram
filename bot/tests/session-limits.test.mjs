import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// app-identity.ts bundled on its own (as the other TypeScript tests do), with the sign-in check stubbed.
const out = await build({ entryPoints: [new URL("../src/app-identity.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false, platform: "neutral",
  plugins: [{ name: "stub", setup(b) { b.onResolve({ filter: /account-links$/ }, () => ({ path: "stub", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `
    export class IdentityError extends Error { constructor(status, reason) { super(reason); this.status = status; this.reason = reason; } }
    export async function verifyFirebaseIdentity(token) { return { uid: token }; }` })); } }] });
const { appReader, limitPerson } = await import(`data:text/javascript,${encodeURIComponent(out.outputFiles[0].text)}`);

function limiter(max) { const n = new Map(); const keys = []; return { keys, limit: async ({ key }) => { keys.push(key); n.set(key, (n.get(key) ?? 0) + 1); return { success: n.get(key) <= max }; } }; }
const request = (uid, ip = "203.0.113.7") => new Request("https://cyberjudah.io/api/app/ask", { headers: { authorization: `Bearer ${uid}`, "cf-connecting-ip": ip } });

test("thirty people on one Wi-Fi are each limited on their own, not as one address", async () => {
  const env = { PRIVACY_KEY: "k".repeat(32), FIREBASE_SESSION_LIMIT: limiter(600), FIREBASE_UID_LIMIT: limiter(60) };
  for (let person = 0; person < 30; person++) for (let i = 0; i < 5; i++) assert.equal((await appReader(request(`uid${person}`), env)).uid, `uid${person}`);
});

test("one person past 60 a minute is stopped, and the per-person key never holds the account ID", async () => {
  const env = { PRIVACY_KEY: "k".repeat(32), FIREBASE_SESSION_LIMIT: limiter(600), FIREBASE_UID_LIMIT: limiter(60) };
  for (let i = 0; i < 60; i++) await appReader(request("busy"), env);
  await assert.rejects(appReader(request("busy"), env), e => e.status === 429 && e.reason === "sign_in_rate_limited");
  assert.ok(env.FIREBASE_UID_LIMIT.keys.every(k => !k.includes("busy")));
});

test("behind the Mini App relay, each signed reader address has its own sign-in backstop", async () => {
  const { createHmac } = await import("node:crypto");
  const env = { PRIVACY_KEY: "k".repeat(32), MINIAPP_CLIENT_IP_KEY: "relay-key", FIREBASE_SESSION_LIMIT: limiter(1) };
  const signed = (uid, ip) => { const ts = Math.floor(Date.now() / 1000); const r = request(uid, "203.0.113.9"); r.headers.set("x-cj-client-ip", ip); r.headers.set("x-cj-client-ts", String(ts)); r.headers.set("x-cj-client-sig", createHmac("sha256", "relay-key").update(`${ip}|${ts}|GET|/api/app/ask`).digest("hex")); return r; };
  await appReader(signed("a", "198.51.100.1"), env);
  await appReader(signed("b", "198.51.100.2"), env);
  await appReader(request("c", "203.0.113.9"), env);
  await assert.rejects(appReader(request("d", "203.0.113.9"), env), e => e.status === 429, "unsigned requests share the relay's backstop");
  assert.equal(new Set(env.FIREBASE_SESSION_LIMIT.keys).size, 3);
});

test("the per-address backstop still applies, and a missing per-person limiter is not an error", async () => {
  const env = { PRIVACY_KEY: "k".repeat(32), FIREBASE_SESSION_LIMIT: limiter(2) };
  await appReader(request("a"), env); await appReader(request("b"), env);
  await assert.rejects(appReader(request("c"), env), e => e.status === 429);
  await limitPerson({ PRIVACY_KEY: "k".repeat(32) }, "x");
});
