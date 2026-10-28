import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import type { Env } from "./env";
import { keyedHash } from "./privacy.mjs";
import { IdentityError, linkedTelegram, verifyFirebaseIdentity } from "./account-links";
import { mintFirebaseToken } from "./firebase-auth";

const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
const valid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function schema(env: Env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS device_signins (code TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, firebase_uid TEXT)").run();
}
/** System-browser login for native apps. The public code cannot redeem a session; the
 * 256-bit device secret stays in webview memory and is consumed exactly once. */
export const deviceAuth = new Hono<{ Bindings: Env }>();
deviceAuth.use("*", bodyLimit({ maxSize: 1024, onError: c => c.json({ error: "invalid_sign_in_request" }, 413) }));
deviceAuth.use("*", async (c, next) => {
  c.header("cache-control", "no-store"); c.header("referrer-policy", "no-referrer");
  if (!c.env.FIREBASE_AUTH_LIMIT || !c.env.PRIVACY_KEY || !c.env.FIREBASE_SERVICE_ACCOUNT) return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  const key = await keyedHash(c.env, "device-signin-ip", c.req.header("cf-connecting-ip") ?? "unknown");
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key })).success) return c.json({ error: "sign_in_rate_limited" }, 429);
  if (Number(c.req.header("content-length") ?? 0) > 1024) return c.json({ error: "invalid_sign_in_request" }, 400);
  try { await schema(c.env); await next(); }
  catch (error) { return c.json({ error: error instanceof IdentityError ? error.reason : "sign_in_unavailable" }, error instanceof IdentityError ? error.status : 503); }
});
deviceAuth.post("/start", async c => {
  if ((await c.req.text()).length) return c.json({ error: "invalid_sign_in_request" }, 400);
  const code = random(), secret = random(), expires = Date.now() + 600_000;
  await c.env.DB.prepare("DELETE FROM device_signins WHERE expires<=?").bind(Date.now()).run();
  await c.env.DB.prepare("INSERT INTO device_signins (code,secret_hash,expires) VALUES (?,?,?)")
    .bind(code, await keyedHash(c.env, "device-signin-secret", secret), expires).run();
  return c.json({ code, secret, expires, match: code.slice(0, 6).toUpperCase() });
});
deviceAuth.post("/approve", async c => {
  const token = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: "firebase_sign_in_required" }, 401);
  const raw = await c.req.text();
  if (raw.length > 1024) return c.json({ error: "invalid_sign_in_request" }, 400);
  let body: { code?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid_sign_in_request" }, 400); }
  if (!valid(body?.code)) return c.json({ error: "invalid_sign_in_request" }, 400);
  const identity = await verifyFirebaseIdentity(token, true);
  if (!await linkedTelegram(c.env, identity.uid)) return c.json({ error: "telegram_link_required" }, 409);
  const result = await c.env.DB.prepare("UPDATE device_signins SET firebase_uid=? WHERE code=? AND firebase_uid IS NULL AND expires>? RETURNING code")
    .bind(identity.uid, body.code, Date.now()).first();
  return result ? c.json({ ok: true }) : c.json({ error: "sign_in_expired" }, 409);
});
deviceAuth.post("/exchange", async c => {
  const raw = await c.req.text();
  if (raw.length > 1024) return c.json({ error: "invalid_sign_in_request" }, 400);
  let body: { secret?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid_sign_in_request" }, 400); }
  if (!valid(body?.secret)) return c.json({ error: "invalid_sign_in_request" }, 400);
  const hash = await keyedHash(c.env, "device-signin-secret", body.secret);
  const row = await c.env.DB.prepare("DELETE FROM device_signins WHERE secret_hash=? AND firebase_uid IS NOT NULL AND expires>? RETURNING firebase_uid")
    .bind(hash, Date.now()).first<{ firebase_uid: string }>();
  if (!row) {
    const pending = await c.env.DB.prepare("SELECT code FROM device_signins WHERE secret_hash=? AND expires>?").bind(hash, Date.now()).first();
    return pending ? c.json({ pending: true }, 202) : c.json({ error: "sign_in_expired" }, 401);
  }
  if (!await linkedTelegram(c.env, row.firebase_uid)) return c.json({ error: "telegram_link_required" }, 401);
  return c.json({ token: await mintFirebaseToken(c.env, row.firebase_uid) });
});
