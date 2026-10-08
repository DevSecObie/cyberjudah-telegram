import { Hono } from "hono";
import { importPKCS8, SignJWT } from "jose";
import type { Env } from "./env";
import { SENSITIVE_MAX_AGE, validateInitData } from "./initdata.mjs";

const AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
const PROJECT = "cyberjudah-app";

/** Only call with a verified Telegram identity. Never accept a UID from the client. */
export function telegramFirebaseUid(id: unknown): string {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid Telegram identity");
  return `tg_${id}`;
}

export const firebaseAuth = new Hono<{ Bindings: Env; Variables: { firebaseUid: string } }>();
firebaseAuth.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  const raw = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i)?.[1];
  if (!raw || raw.length > 16384) return c.json({ error: "telegram_sign_in_required" }, 401);
  const params = new URLSearchParams(raw);
  // The common parser accepts URLSearchParams; the identity bridge additionally rejects
  // repeated fields so a parser difference can never choose another identity.
  if (new Set(params.keys()).size !== [...params].length) return c.json({ error: "invalid_telegram_identity" }, 401);
  const data = await validateInitData(raw, c.env.BOT_TOKEN, SENSITIVE_MAX_AGE);
  try { c.set("firebaseUid", telegramFirebaseUid(data?.user?.id)); }
  catch { return c.json({ error: "invalid_telegram_identity", message: "Reopen the app from Telegram to sign in." }, 401); }
  await next();
});

// Session restoration can verify identity without minting another custom token.
firebaseAuth.post("/identity", c => c.json({ uid: c.get("firebaseUid") }));
firebaseAuth.post("/token", async c => {
  // No client UID, claims or account-linking parameters are accepted.
  if (Object.keys(c.req.query()).length || c.req.raw.body !== null) return c.json({ error: "unexpected_sign_in_parameters" }, 400);
  if (!c.env.FIREBASE_SERVICE_ACCOUNT || !c.env.FIREBASE_AUTH_LIMIT) return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  const uid = c.get("firebaseUid");
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key: uid })).success) return c.json({ error: "sign_in_rate_limited", message: "Please wait a minute and try again." }, 429);
  try {
    const account = JSON.parse(c.env.FIREBASE_SERVICE_ACCOUNT);
    if (account.type !== "service_account" || account.project_id !== PROJECT ||
      typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) ||
      typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
    const key = await importPKCS8(account.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ uid }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(account.client_email).setSubject(account.client_email).setAudience(AUDIENCE)
      .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
    return c.json({ uid, token });
  } catch {
    // Never expose key material, launch data or custom tokens in errors or logs.
    return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  }
});
