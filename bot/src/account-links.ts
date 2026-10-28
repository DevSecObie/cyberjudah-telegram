import { decodeJwt } from "jose";
import type { Env } from "./env";
import { open, pid, seal } from "./privacy.mjs";

export const FIREBASE_PROJECT = "cyberjudah-app";
// Firebase client API keys identify a project; they are not an administrator credential.
const API_KEY = "AIzaSyAqCIfm78KkoFq0UOszT5YJdpvD6jWqG9U";
export type FirebaseIdentity = { uid: string; name: string; authTime: number };
export class IdentityError extends Error {
  constructor(public status: 401 | 409 | 429 | 503, public reason: string) { super(reason); }
}
/** Only call with a verified Telegram identity. Never accept a UID from the client. */
export function telegramFirebaseUid(id: unknown): string {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid Telegram identity");
  return `tg_${id}`;
}
export const validFirebaseUid = (uid: unknown): uid is string => typeof uid === "string" && uid.length > 0 && uid.length <= 128 && uid !== "." && uid !== ".." && !/[\u0000-\u001f/]/.test(uid);

/** Google verifies the complete ID token over HTTPS. Decoding alone NEVER authenticates it.
 * accounts:lookup also supplies disabled/validSince state, so revoked tokens fail closed. */
export async function verifyFirebaseIdentity(token: string, recent = false): Promise<FirebaseIdentity> {
  if (!token || token.length > 16384) throw new IdentityError(401, "invalid_firebase_identity");
  let claims;
  try { claims = decodeJwt(token); } catch { throw new IdentityError(401, "invalid_firebase_identity"); }
  const now = Math.floor(Date.now() / 1000), time = claims.auth_time;
  if (claims.aud !== FIREBASE_PROJECT || claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` ||
      !validFirebaseUid(claims.sub) || typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now || typeof time !== "number" || time > now || time <= 0 ||
      (claims.firebase as { sign_in_provider?: string } | undefined)?.sign_in_provider === "anonymous") throw new IdentityError(401, "invalid_firebase_identity");
  if (recent && now - time > 300) throw new IdentityError(401, "recent_sign_in_required");
  let response: Response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: token }),
      // Workers does not implement redirect:"error". Reject manual redirect responses
      // below so the identity token can never be forwarded to another endpoint.
      signal: AbortSignal.timeout(10_000), redirect: "manual",
    });
  } catch { throw new IdentityError(503, "identity_service_unavailable"); }
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) throw new IdentityError(401, "firebase_sign_in_required");
    throw new IdentityError(503, "identity_service_unavailable");
  }
  let result: { users?: { localId?: string; disabled?: boolean; validSince?: string; displayName?: string }[] };
  try { result = await response.json(); }
  catch { throw new IdentityError(503, "identity_service_unavailable"); }
  const user = result.users?.length === 1 ? result.users[0] : undefined;
  const validSince = Number(user?.validSince);
  if (!user || user.localId !== claims.sub || user.disabled || !Number.isFinite(validSince) || time < validSince) throw new IdentityError(401, "firebase_sign_in_required");
  return { uid: claims.sub, name: typeof user.displayName === "string" ? user.displayName.slice(0, 120) : "CyberJudah reader", authTime: time };
}

async function schema(env: Env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_links (firebase_uid TEXT PRIMARY KEY, telegram_owner TEXT NOT NULL UNIQUE, sealed TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
}
type Link = { firebase_uid: string; telegram_owner: string; sealed: string };
export async function linkedTelegram(env: Env, uid: string): Promise<number | null> {
  await schema(env);
  const row = await env.DB.prepare("SELECT firebase_uid,telegram_owner,sealed FROM account_links WHERE firebase_uid=?").bind(uid).first<Link>();
  if (!row) return null;
  const value = await open(env, row.telegram_owner, row.sealed) as { id?: number } | null;
  if (!value?.id || !Number.isSafeInteger(value.id) || value.id <= 0 || await pid(env, value.id) !== row.telegram_owner) throw new IdentityError(503, "account_link_unavailable");
  return value.id;
}
export async function linkedFirebase(env: Env, id: number): Promise<string | null> {
  await schema(env);
  return (await env.DB.prepare("SELECT firebase_uid FROM account_links WHERE telegram_owner=?").bind(await pid(env, id)).first<{ firebase_uid: string }>())?.firebase_uid ?? null;
}
/** Both identities must already have been verified. UNIQUE constraints arbitrate concurrent links.
 * Never merge on email/name, move credits, replace a real provider account or trust a client UID. */
export async function linkAccounts(env: Env, id: number, firebaseUid: string): Promise<void> {
  if (!Number.isSafeInteger(id) || id <= 0 || !validFirebaseUid(firebaseUid) || (/^tg_/.test(firebaseUid) && firebaseUid !== `tg_${id}`)) throw new IdentityError(409, "account_link_conflict");
  await schema(env);
  const owner = await pid(env, id), sealed = await seal(env, owner, { id });
  // The reserved Telegram-only bridge may acquire an existing provider UID. No user-created
  // Firebase account is replaced; old tokens cease resolving when this reserved alias changes.
  await env.DB.prepare("UPDATE OR IGNORE account_links SET firebase_uid=? WHERE telegram_owner=? AND firebase_uid=?")
    .bind(firebaseUid, owner, `tg_${id}`).run();
  await env.DB.prepare("INSERT OR IGNORE INTO account_links (firebase_uid,telegram_owner,sealed,created_at) VALUES (?,?,?,?)")
    .bind(firebaseUid, owner, sealed, Date.now()).run();
  if (await linkedTelegram(env, firebaseUid) !== id || await linkedFirebase(env, id) !== firebaseUid) throw new IdentityError(409, "account_link_conflict");
}
export async function removeAccountLink(env: Env, id: number) {
  await schema(env);
  await env.DB.prepare("DELETE FROM account_links WHERE telegram_owner=?").bind(await pid(env, id)).run();
}
