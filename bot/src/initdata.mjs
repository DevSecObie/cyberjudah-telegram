/**
 * Telegram Mini App launch data. The client sends WebApp.initData as it received it; the
 * bot token proves it came from Telegram: secret = HMAC_SHA256(key "WebAppData", token),
 * hash = HMAC_SHA256(key secret, every field but `hash` as key=value, sorted, joined by \n).
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Same length, every char compared, no early exit: the hash must not leak by timing. */
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The parsed launch fields (user, receiver and chat as objects) when the signature holds and
 * auth_date is within maxAgeSec of now; null otherwise.
 */
/**
 * How old launch data the API accepts. Telegram keeps a Mini App open in the background for
 * weeks and makes new launch data only when it is opened again; at three days, a reader who
 * never closed the app lost Search and Ask together. The signature still proves who is asking;
 * the age only bounds a replay.
 */
export const LAUNCH_DATA_MAX_AGE = 30 * 86400;

export async function validateInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (typeof initData !== "string" || !initData || typeof botToken !== "string" || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch { return null; }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const lines = [];
  for (const [k, v] of params) if (k !== "hash") lines.push(`${k}=${v}`);
  lines.sort();
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const expected = hex(await hmac(secret, lines.join("\n")));
  if (!sameHex(expected, hash)) return null;
  const auth_date = Number(params.get("auth_date"));
  if (!Number.isFinite(auth_date) || auth_date <= 0) return null;
  const ageSec = now / 1000 - auth_date;
  if (ageSec < -30 || ageSec > maxAgeSec) return null;
  const out = { auth_date, hash };
  for (const [k, v] of params) {
    if (k === "hash" || k === "auth_date") continue;
    if (k === "user" || k === "receiver" || k === "chat") {
      try { out[k] = JSON.parse(v); } catch { return null; }
    } else out[k] = v;
  }
  return out;
}

/** Signs a set of launch fields with a bot token: the inverse of validateInitData, for tests. */
export async function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const lines = [];
  for (const [k, v] of params) lines.push(`${k}=${v}`);
  lines.sort();
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  params.set("hash", hex(await hmac(secret, lines.join("\n"))));
  return params.toString();
}
