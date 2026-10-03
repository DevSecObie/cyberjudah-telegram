import type { Env } from "./env";

/**
 * A browser's identity, for readers outside Telegram: a random id and secret the Worker hands
 * out once and the browser keeps (the `x-cj-device` header, "<id>.<secret>"). Only the hash of
 * the secret is stored (SUBS `remdev:<id>`, with the record it points to). Reading reminders
 * made these first; Ask in a browser uses the same credential, so a browser has one identity.
 *
 * Making one is limited per address (the rate-limit binding per minute, CREATE_PER_DAY a day),
 * since a browser has nothing else to be known by. Unused for 180 days, it is forgotten.
 */
export const IDLE_TTL = 180 * 86400;
/** New browser credentials one address may make in a day (beside the per-minute rate limit). */
export const CREATE_PER_DAY = 100;
const CREDENTIAL = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

export type Device = { dev: string; rid: string };
type Saved = { h: string; rid: string; t?: string };

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
import { b64u } from "./webpush.mjs";

/** Equal strings, compared in constant time (the credential check). */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Abuse protection (OWASP API4), by the Workers Rate Limiting binding. The binding counts per
 * Cloudflare location, so it bounds abuse rather than counting exactly. Without the binding (a
 * local run), nothing is limited.
 */
export async function overLimit(env: Env, key: string): Promise<boolean> {
  if (!env.REMIND_LIMIT) return false;
  try { return !(await env.REMIND_LIMIT.limit({ key })).success; } catch { return false; }
}
/** The caller's address, as Cloudflare saw it. */
export const clientIp = (c: { req: { header: (name: string) => string | undefined } }) => c.req.header("cf-connecting-ip") ?? "unknown";

/** The browser a request's `x-cj-device` header names, if its secret is right. */
export async function deviceOf(env: Env, header: string | undefined): Promise<Device | null> {
  const d = CREDENTIAL.exec(header ?? "");
  if (!d) return null;
  const saved = await env.SUBS.get<Saved>(`remdev:${d[1]}`, "json");
  if (!saved || !same(saved.h, await sha256(d[2]))) return null;
  // Used today: the 180 days start again (written at most once a day).
  const today = new Date().toISOString().slice(0, 10);
  if (saved.t !== today) await env.SUBS.put(`remdev:${d[1]}`, JSON.stringify({ ...saved, t: today }), { expirationTtl: IDLE_TTL });
  return { dev: d[1], rid: saved.rid };
}

/** Points a browser's credential at another record (linking it to a Telegram reader). */
export async function repointDevice(env: Env, dev: string, rid: string): Promise<void> {
  const saved = await env.SUBS.get<Saved>(`remdev:${dev}`, "json");
  if (saved) await env.SUBS.put(`remdev:${dev}`, JSON.stringify({ ...saved, rid }), { expirationTtl: IDLE_TTL });
}
export const forgetDevice = (env: Env, dev: string) => env.SUBS.delete(`remdev:${dev}`);

/**
 * A new credential for a browser, or why not: "rate-limited" (too many from this address).
 * The returned `credential` is shown to the browser once and never stored in the clear.
 */
export async function issueDevice(env: Env, ip: string): Promise<{ ok: true; device: Device; credential: string } | { ok: false; error: "rate-limited" }> {
  if (await overLimit(env, `create:${ip}`)) return { ok: false, error: "rate-limited" };
  const dayKey = `remcreate:${await sha256(ip)}:${new Date().toISOString().slice(0, 10)}`;
  const made = Number(await env.SUBS.get(dayKey)) || 0;
  if (made >= CREATE_PER_DAY) return { ok: false, error: "rate-limited" };
  await env.SUBS.put(dayKey, String(made + 1), { expirationTtl: 2 * 86400 });
  const id = randomHex(16), secret = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const device = { dev: id, rid: `dev:${id}` };
  await env.SUBS.put(`remdev:${id}`, JSON.stringify({ h: await sha256(secret), rid: device.rid, t: new Date().toISOString().slice(0, 10) }), { expirationTtl: IDLE_TTL });
  return { ok: true, device, credential: `${id}.${secret}` };
}
