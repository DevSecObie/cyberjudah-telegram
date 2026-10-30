import { IdentityError, verifyFirebaseIdentity } from "./account-links";
import type { Env } from "./env";
import { keyedHash } from "./privacy.mjs";

/**
 * A verified Firebase sign-in from the CyberJudah app, linked to Telegram or not, rate limited per
 * IP like every Bearer request (firebase-auth.ts firebaseAccount). Only the app's free Ask accepts
 * an unlinked account (index.ts /api/app/ask); everything else still needs the Telegram link.
 */
export async function appReader(request: Request, env: Env) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  if (!env.FIREBASE_SESSION_LIMIT || !env.PRIVACY_KEY) throw new IdentityError(503, "firebase_sign_in_unavailable");
  const key = await keyedHash(env, "firebase-session-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
  if (!(await env.FIREBASE_SESSION_LIMIT.limit({ key })).success) throw new IdentityError(429, "sign_in_rate_limited");
  return verifyFirebaseIdentity(header.slice(7));
}
