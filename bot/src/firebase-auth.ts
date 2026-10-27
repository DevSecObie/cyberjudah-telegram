import { bodyLimit } from "hono/body-limit";
import { keyedHash } from "./privacy.mjs";
import { IdentityError, linkAccounts, linkedFirebase, linkedTelegram, verifyFirebaseIdentity } from "./account-links";
import { Hono } from "hono";
import { importPKCS8, SignJWT } from "jose";
import type { Env } from "./env";
import { browserSession } from "./browser-auth";
import { SENSITIVE_MAX_AGE, validateInitData } from "./initdata.mjs";

const AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const PROJECT = "cyberjudah-app";

/** Only call with a verified Telegram identity. Never accept a UID from the client. */
export function telegramFirebaseUid(id: unknown): string {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid Telegram identity");
  return `tg_${id}`;
}

export const firebaseAuth = new Hono<{ Bindings: Env; Variables: { firebaseUid: string; telegramId: number; telegramAuthTime: number } }>();
firebaseAuth.use("/link", bodyLimit({ maxSize: 18000, onError: c => c.json({ error: "invalid_link_request" }, 413) }));
firebaseAuth.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  const raw = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i)?.[1];
  if (raw && raw.length > 16384) return c.json({ error: "telegram_sign_in_required" }, 401);
  const params = new URLSearchParams(raw ?? "");
  // The common parser accepts URLSearchParams; the identity bridge additionally rejects
  // repeated fields so a parser difference can never choose another identity.
  if (new Set(params.keys()).size !== [...params].length) return c.json({ error: "invalid_telegram_identity" }, 401);
  const data = raw ? await validateInitData(raw, c.env.BOT_TOKEN, SENSITIVE_MAX_AGE) : await browserSession(c.req.raw, c.env);
  let fallback: string;
  try { fallback = telegramFirebaseUid(data?.user?.id); }
  catch { return c.json({ error: "invalid_telegram_identity", message: "Reopen the app from Telegram to sign in." }, 401); }
  c.set("telegramId", data!.user!.id); c.set("telegramAuthTime", data!.auth_date);
  try { c.set("firebaseUid", c.env.DB ? await linkedFirebase(c.env, data!.user!.id) ?? fallback : fallback); }
  catch { return c.json({ error: "account_link_unavailable" }, 503); }
  await next();
});

// Session restoration can verify identity without minting another custom token.
firebaseAuth.post("/identity", c => c.json({ uid: c.get("firebaseUid") }));
firebaseAuth.post("/token", async c => {
  // No client UID or claims are accepted.
  if (Object.keys(c.req.query()).length || (await c.req.text()).length > 0) return c.json({ error: "unexpected_sign_in_parameters" }, 400);
  if (!c.env.FIREBASE_SERVICE_ACCOUNT || !c.env.FIREBASE_AUTH_LIMIT) return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  const uid = c.get("firebaseUid");
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key: uid })).success) return c.json({ error: "sign_in_rate_limited", message: "Please wait a minute and try again." }, 429);
  try {
    const token = await mintFirebaseToken(c.env, uid);
    if (c.env.DB) await linkAccounts(c.env, c.get("telegramId"), uid);
    return c.json({ uid, token });
  } catch {
    // Never expose key material, launch data or custom tokens in errors or logs.
    return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  }
});

export async function mintFirebaseToken(env: Env, uid: string): Promise<string> {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new IdentityError(503, "firebase_sign_in_unavailable");
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (account.type !== "service_account" || account.project_id !== PROJECT ||
      typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) ||
      typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
    const key = await importPKCS8(account.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ uid }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email).setSubject(account.client_email).setAudience(AUDIENCE)
      .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
}

// Linking is an explicit action with fresh proof of BOTH accounts. Normal sign-in never links.
firebaseAuth.post("/link", async c => {
  if (Math.floor(Date.now() / 1000) - c.get("telegramAuthTime") > 300) return c.json({ error: "recent_telegram_sign_in_required" }, 401);
  if (!c.env.FIREBASE_AUTH_LIMIT || !c.env.PRIVACY_KEY) return c.json({ error: "account_link_unavailable" }, 503);
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key: `link:${c.get("telegramId")}` })).success) return c.json({ error: "sign_in_rate_limited" }, 429);
  if (Number(c.req.header("content-length") ?? 0) > 18000) return c.json({ error: "invalid_link_request" }, 400);
  const raw = await c.req.text();
  if (raw.length > 18000) return c.json({ error: "invalid_link_request" }, 400);
  let body: { idToken?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid_link_request" }, 400); }
  if (!body || typeof body.idToken !== "string" || Object.keys(body).some(k => k !== "idToken")) return c.json({ error: "invalid_link_request" }, 400);
  try {
    const identity = await verifyFirebaseIdentity(body.idToken, true);
    await linkAccounts(c.env, c.get("telegramId"), identity.uid);
    return c.json({ ok: true, uid: identity.uid });
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "account_link_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
});

/** Bearer requests resolve to the ORIGINAL Telegram owner, preserving its wallet and sealed chats. */
export async function firebaseAccount(request: Request, env: Env, recent = false) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  if (!env.FIREBASE_SESSION_LIMIT || !env.PRIVACY_KEY) throw new IdentityError(503, "firebase_sign_in_unavailable");
  const key = await keyedHash(env, "firebase-session-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
  if (!(await env.FIREBASE_SESSION_LIMIT.limit({ key })).success) throw new IdentityError(429, "sign_in_rate_limited");
  const identity = await verifyFirebaseIdentity(header.slice(7), recent);
  const id = await linkedTelegram(env, identity.uid);
  return { identity, user: id ? { id, first_name: identity.name } : null };
}
