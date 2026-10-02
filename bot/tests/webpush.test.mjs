import { test } from "node:test";
import assert from "node:assert/strict";
import { b64u, fromB64u, sendPush, validSubscription, vapidAuthorization } from "../src/webpush.mjs";

async function keys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { pair, publicKey: b64u(raw), privateKey: jwk.d, subject: "mailto:admin@example.org" };
}
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };

test("the VAPID token is ES256-signed for the push service's origin and verifies with the public key", async () => {
  const k = await keys();
  const now = Date.UTC(2026, 6, 1);
  const h = await vapidAuthorization(SUB.endpoint, k, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, h);
  assert.equal(m[4], k.publicKey);
  const claims = JSON.parse(new TextDecoder().decode(fromB64u(m[2])));
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:admin@example.org" });
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.pair.publicKey, fromB64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(ok, true);
});

test("a push carries no payload, only the wake-up", async () => {
  const k = await keys();
  let seen;
  const status = await sendPush(SUB, k, { fetchImpl: async (url, init) => { seen = { url, init }; return new Response(null, { status: 201 }); } });
  assert.equal(status, 201);
  assert.equal(seen.url, SUB.endpoint);
  assert.equal(seen.init.body, undefined);
  assert.equal(seen.init.headers["content-length"], "0");
  assert.match(seen.init.headers.authorization, /^vapid t=/);
});

test("only real push services are accepted as endpoints", () => {
  assert.equal(validSubscription(SUB), true);
  assert.equal(validSubscription({ ...SUB, endpoint: "https://web.push.apple.com/QGx" }), true);
  assert.equal(validSubscription({ ...SUB, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x" }), true);
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com.evil.example/x", "https://169.254.169.254/latest", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) {
    assert.equal(validSubscription({ ...SUB, endpoint }), false, endpoint);
  }
  assert.equal(validSubscription({ endpoint: SUB.endpoint }), false, "keys are required");
});

test("a refused endpoint is never fetched", async () => {
  const k = await keys();
  let called = false;
  const status = await sendPush({ ...SUB, endpoint: "https://evil.example/x" }, k, { fetchImpl: async () => { called = true; return new Response(null, { status: 201 }); } });
  assert.equal(status, 404);
  assert.equal(called, false);
});
