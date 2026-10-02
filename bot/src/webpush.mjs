/**
 * Web Push from the Worker, without a payload: the push only wakes the app's service worker,
 * which asks /api/push/today what to show. With no payload there is nothing to encrypt, so
 * all that is needed is VAPID (RFC 8292): a short ES256-signed token naming the push
 * service, made with WebCrypto from the VAPID_PRIVATE_KEY secret.
 *
 * Keys are base64url: the public key is the 65-byte uncompressed P-256 point the browser is
 * given (applicationServerKey); the private key is its 32-byte scalar.
 */

/** The push services browsers use. A subscription naming any other host is refused, so the Worker cannot be made to post to arbitrary URLs. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

export function validSubscription(sub) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string" || sub.endpoint.length > 1024) return false;
  let u;
  try { u = new URL(sub.endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  if (!PUSH_HOSTS.some((h) => h.test(u.hostname))) return false;
  const k = sub.keys;
  return !!k && typeof k.p256dh === "string" && typeof k.auth === "string" && /^[A-Za-z0-9_-]{20,200}=*$/.test(k.p256dh) && /^[A-Za-z0-9_-]{8,100}=*$/.test(k.auth);
}

const enc = new TextEncoder();
export function b64u(bytes) {
  const b = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The Authorization header for one push service: `vapid t=<jwt>, k=<public key>`. */
export async function vapidAuthorization(endpoint, keys, now = Date.now()) {
  const pub = fromB64u(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 key");
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/**
 * The push topic (RFC 8030 §5.4, at most 32 base64url characters): a reminder still waiting
 * at the push service is replaced by the next, so an offline device never gets a stack of them.
 */
export const TOPIC = "daily-reading";

/** Wake one subscription. Resolves to the push service's HTTP status (201 when accepted). */
export async function sendPush(sub, keys, { ttl = 6 * 3600, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!validSubscription(sub)) return 404;
  const res = await fetchImpl(sub.endpoint, { method: "POST", headers: { authorization: await vapidAuthorization(sub.endpoint, keys, now), ttl: String(ttl), urgency: "normal", topic: TOPIC, "content-length": "0" } });
  return res.status;
}
