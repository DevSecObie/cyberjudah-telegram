import { IdentityError, verifyFirebaseIdentity } from "./account-links";
import type { Env } from "./env";
import { keyedHash } from "./privacy.mjs";

/**
 * Signed-in requests are limited twice. Per internet address, generously (FIREBASE_SESSION_LIMIT),
 * as a backstop against unsigned floods: a class on one Wi-Fi or a phone carrier that shares
 * addresses must not lock its people out. Then per person (FIREBASE_UID_LIMIT), once the sign-in
 * is verified, which is the limit an ordinary reader can actually reach.
 */
export async function limitSession(request: Request, env: Env) {
  if (!env.FIREBASE_SESSION_LIMIT || !env.PRIVACY_KEY) throw new IdentityError(503, "firebase_sign_in_unavailable");
  const key = await keyedHash(env, "firebase-session-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
  if (!(await env.FIREBASE_SESSION_LIMIT.limit({ key })).success) throw new IdentityError(429, "sign_in_rate_limited");
}

export async function limitPerson(env: Env, uid: string) {
  if (!env.FIREBASE_UID_LIMIT) return;
  const key = await keyedHash(env, "firebase-session-uid", uid);
  if (!(await env.FIREBASE_UID_LIMIT.limit({ key })).success) throw new IdentityError(429, "sign_in_rate_limited");
}

/**
 * A verified Firebase sign-in from the CyberJudah app, linked to Telegram or not, rate limited like
 * every Bearer request (firebase-auth.ts firebaseAccount). Only the app's free Ask accepts
 * an unlinked account (index.ts /api/app/ask); everything else still needs the Telegram link.
 */
export async function appReader(request: Request, env: Env) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  await limitSession(request, env);
  const identity = await verifyFirebaseIdentity(header.slice(7));
  await limitPerson(env, identity.uid);
  return identity;
}
