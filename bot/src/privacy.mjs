
/**
 * How CyberJudah keeps what it must keep about a person (docs/PRIVACY.md).
 *
 * - Pseudonymous keys. Records are filed under `pid`, a keyed hash of the Telegram ID, never
 *   the ID itself, so browsing the storage does not show who anyone is. Where the bot must
 *   message someone (a reminder, the daily verse) the chat ID is kept inside the record, for
 *   that purpose only.
 * - Sealed content. A person's saved conversations are encrypted (AES-GCM) with a key derived
 *   for that person alone, so their questions and answers cannot be read from the storage.
 *
 * Both come from one secret, PRIVACY_KEY (a Worker secret, set by the deploy from the
 * repository secret of the same name). It must never change: records filed or sealed under
 * one key cannot be found or opened under another. Without it, the bot token stands in, which
 * is why PRIVACY_KEY should be set before the first deploy that stores anything.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64url = (b) => {
  const bytes = new Uint8Array(b); let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const rootOf = (env) => env.PRIVACY_KEY || env.BOT_TOKEN || "";
const roots = new Map();
function root(env) {
  const secret = rootOf(env);
  if (!secret) throw new Error("No PRIVACY_KEY or BOT_TOKEN to derive keys from");
  let k = roots.get(secret);
  if (!k) { k = crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey", "deriveBits"]); roots.set(secret, k); }
  return k;
}
const salt = enc.encode("cyberjudah-privacy-v1");

/** The pseudonymous ID a person's records are filed under: 22 characters, the same every time for the same person. */
const pids = new Map();
export async function pid(env, uid) {
  const cacheKey = JSON.stringify([rootOf(env), String(uid)]);
  const hit = pids.get(cacheKey);
  if (hit) return hit;
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`pid:tg:${uid}`) }, await root(env), 128);
  const id = b64url(bits);
  if (pids.size > 5000) pids.clear();
  pids.set(cacheKey, id);
  return id;
}

/**
 * A keyed hash (HMAC-SHA-256, hex) of a value that must be counted but not kept, such as a
 * network address: without PRIVACY_KEY it cannot be reversed by hashing every address.
 * `purpose` keeps one use's hashes apart from another's.
 */
const macKeys = new Map();
export async function keyedHash(env, purpose, value) {
  const cacheKey = JSON.stringify([rootOf(env), purpose]);
  let k = macKeys.get(cacheKey);
  if (!k) {
    k = crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`mac:${purpose}`) }, await root(env), { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    macKeys.set(cacheKey, k);
  }
  const sig = await crypto.subtle.sign("HMAC", await k, enc.encode(String(value)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sealKey(env, owner) {
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`seal:${owner}`) }, await root(env), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A value encrypted for one person: "s1.<iv>.<ciphertext>". */
export async function seal(env, owner, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env, owner), enc.encode(JSON.stringify(value)));
  return `s1.${b64url(iv)}.${b64url(ct)}`;
}

/** Opens a sealed value (null if it cannot be opened). Plain JSON written before sealing is read as it is. */
export async function open(env, owner, stored) {
  if (stored == null) return null;
  if (!stored.startsWith("s1.")) { try { return JSON.parse(stored) ; } catch { return null; } }
  const [, iv, ct] = stored.split(".");
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await sealKey(env, owner), fromB64url(ct)))) ; }
  catch { return null; }
}
