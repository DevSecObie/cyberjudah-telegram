import type { Env } from "./env";
import { keyedHash } from "./privacy.mjs";
import { takeQuotaKey } from "./ai";

/**
 * The reader's own address when the request came through the Mini App's Worker (tg.cyberjudah.io,
 * /api/cj), which reaches us from one Cloudflare address for every reader. That Worker sends the
 * reader's address it saw with a timestamp and an HMAC under the shared MINIAPP_CLIENT_IP_KEY:
 *   x-cj-client-ip, x-cj-client-ts (unix seconds), x-cj-client-sig = lowercase hex
 *   HMAC-SHA256(key as UTF-8, `${ip}|${ts}|${METHOD}|${pathname}`), pathname without the query.
 * Anything missing, stale, malformed or unsigned is ignored and the connecting address is used,
 * so a caller can never choose its own address. Only for per-address limits; never stored beyond them.
 */
export const CLIENT_IP_SKEW_S = 60;
const IP = /^[0-9A-Fa-f:.]{2,45}$/;
const HEX = /^[0-9a-f]{64}$/;
const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (secret: string) => {
  let k = keys.get(secret);
  if (!k) { k = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]); keys.set(secret, k); }
  return k;
};

export async function signedClientIp(req: Request, env: Env, now = Date.now()): Promise<string | undefined> {
  // During a rotation MINIAPP_CLIENT_IP_KEY_PREVIOUS is accepted too, so the two Workers need not change at once.
  const secrets = [env.MINIAPP_CLIENT_IP_KEY, env.MINIAPP_CLIENT_IP_KEY_PREVIOUS].filter((k): k is string => !!k);
  if (!secrets.length) return undefined;
  const ip = req.headers.get("x-cj-client-ip") ?? "", ts = req.headers.get("x-cj-client-ts") ?? "", sig = req.headers.get("x-cj-client-sig") ?? "";
  if (!IP.test(ip) || !/^\d{1,12}$/.test(ts) || !HEX.test(sig)) return undefined;
  if (Math.abs(now / 1000 - Number(ts)) > CLIENT_IP_SKEW_S) return undefined;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(sig.slice(i * 2, i * 2 + 2), 16);
  const message = new TextEncoder().encode(`${ip}|${ts}|${req.method.toUpperCase()}|${new URL(req.url).pathname}`);
  // crypto.subtle.verify compares in constant time.
  for (const secret of secrets) {
    try { if (await crypto.subtle.verify("HMAC", await keyFor(secret), bytes, message)) return ip; } catch { /* next key */ }
  }
  return undefined;
}

/** The address a per-address limit should count: the signed reader's address, else the connecting one. */
export async function clientIp(req: Request, env: Env): Promise<string | undefined> {
  return (await signedClientIp(req, env)) ?? req.headers.get("cf-connecting-ip")?.slice(0, 45) ?? undefined;
}

/** The day's per-address Ask counter key in rate_counts: a keyed hash of the address (PRIVACY_KEY,
 *  purpose "ask_ip"), never the address itself. Swept with the other counters after the next day. */
export async function askIpKey(env: Env, ip: string, now = Date.now()): Promise<string> {
  return `ask_ip:${await keyedHash(env, "ask_ip", ip)}:${new Date(now).toISOString().slice(0, 10)}`;
}

/** The per-address Ask backstop (ASK_IP_DAILY_LIMIT, at least 100, 1000 by default) for both Ask
 *  endpoints: false when this address has used the day's allowance. No address, no check. */
export async function takeAskIpQuota(req: Request, env: Env): Promise<boolean> {
  const ip = await clientIp(req, env);
  return !ip || await takeQuotaKey(env, await askIpKey(env, ip), Math.max(100, Number(env.ASK_IP_DAILY_LIMIT ?? 1000)));
}
