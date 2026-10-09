import { importPKCS8, SignJWT } from "jose";
import type { Env } from "./env";
import { telegramFirebaseUid } from "./firebase-auth";

const PROJECT = "cyberjudah-app";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
/** Every Firestore collection account sync writes under users/{uid} (app/src/sync/reader.ts). Revision history
 * for notes and studies lives in a `revisions` subcollection under each document; the other collections keep
 * their history as sibling `revision-*` documents, so a plain list of the collection already includes it. */
const SYNC_COLLECTIONS = ["highlights", "notes", "links", "bookmarks", "tags", "relations", "studies", "wordAnnotations"] as const;
const HAS_REVISIONS_SUBCOLLECTION = new Set<string>(["notes", "studies"]);

type FirestoreValue = Record<string, unknown>;
type RawDocument = { name: string; fields?: Record<string, FirestoreValue> };
export type SyncDocument = { name: string; id: string; fields: Record<string, unknown> };

/** Only honored for the loopback host the end-to-end tests start (app/firebase/firebase.json), the same
 * pattern as TELEGRAM_API_ROOT and PUSH_TEST_ORIGIN: never set in a deployed environment. */
function emulatorHost(env: Env): string | undefined {
  const host = env.FIRESTORE_EMULATOR_HOST;
  return host && /^(127\.0\.0\.1|localhost):\d+$/.test(host) ? host : undefined;
}

function databasePath(env: Env): { documentsUrl: string; emulator: boolean } {
  const host = emulatorHost(env);
  if (host) return { documentsUrl: `http://${host}/v1/projects/demo-cyberjudah/databases/(default)/documents`, emulator: true };
  return { documentsUrl: `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`, emulator: false };
}

let mintedToken: { token: string; expires: number } | undefined;
/** The emulator does not check the token's value (`Authorization: Bearer owner` is its documented admin
 * bypass); production mints a real Google access token from the signing secret, cached for its lifetime. */
async function accessToken(env: Env): Promise<string> {
  if (emulatorHost(env)) return "owner";
  if (mintedToken && mintedToken.expires > Date.now()) return mintedToken.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Account sync is not configured on this Worker.");
  let account: { type?: unknown; project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new Error("Invalid signing configuration"); }
  if (account.type !== "service_account" || account.project_id !== PROJECT ||
    typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) ||
    typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
  const key = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email).setSubject(account.client_email).setAudience(TOKEN_URL)
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("Firestore access is unavailable.");
  const result = await response.json() as { access_token: string; expires_in: number };
  // A minute of slack keeps a long export or deletion from minting mid-call.
  mintedToken = { token: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1000 };
  return result.access_token;
}

function decodeValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("mapValue" in value) return decodeFields((value.mapValue as { fields?: Record<string, FirestoreValue> }).fields ?? {});
  if ("arrayValue" in value) return ((value.arrayValue as { values?: FirestoreValue[] }).values ?? []).map(decodeValue);
  return null;
}
function decodeFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

/** Every document directly in one collection (not a recursive descendant), paginated. 404 (the reader has
 * never written to this collection) is an empty collection, not a failure. */
async function listCollection(env: Env, path: string): Promise<SyncDocument[]> {
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const documents: SyncDocument[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${documentsUrl}/${path}?${params}`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) break;
    if (!response.ok) throw new Error("Firestore read failed.");
    const body = await response.json() as { documents?: RawDocument[]; nextPageToken?: string };
    for (const doc of body.documents ?? []) documents.push({ name: doc.name, id: doc.name.split("/").pop()!, fields: decodeFields(doc.fields ?? {}) });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return documents;
}

/** Whether this Worker can reach Firestore at all: a real signing secret, or the test emulator. */
function syncConfigured(env: Env): boolean {
  return !!env.FIREBASE_SERVICE_ACCOUNT || !!emulatorHost(env);
}

/**
 * Everything account sync has written for this reader under users/tg_<id>, grouped by collection, with
 * each note's or study's revision history attached. null when this Worker has no Firestore access
 * configured (production sync stays off until FIREBASE_SERVICE_ACCOUNT is set).
 */
export async function exportAccountSyncMarks(env: Env, uid: number): Promise<Record<string, unknown[]> | null> {
  if (!syncConfigured(env)) return null;
  const firebaseUid = telegramFirebaseUid(uid);
  const out: Record<string, unknown[]> = {};
  for (const name of SYNC_COLLECTIONS) {
    const documents = await listCollection(env, `users/${firebaseUid}/${name}`);
    if (!documents.length) continue;
    const rows: Record<string, unknown>[] = [];
    for (const doc of documents) {
      const row: Record<string, unknown> = { id: doc.id, ...doc.fields };
      if (HAS_REVISIONS_SUBCOLLECTION.has(name)) {
        const revisions = await listCollection(env, `users/${firebaseUid}/${name}/${doc.id}/revisions`);
        if (revisions.length) row.revisions = revisions.map((r) => ({ id: r.id, ...r.fields }));
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Deletes every document account sync has written for this reader under users/tg_<id>, across every
 * collection and revision history, and returns how many documents were removed. A no-op (0) when this
 * Worker has no Firestore access configured. Throws, like every other store in mydata.ts, when a step
 * fails, so the caller reports an incomplete deletion rather than acknowledging one.
 */
export async function deleteAccountSyncMarks(env: Env, uid: number): Promise<number> {
  if (!syncConfigured(env)) return 0;
  const firebaseUid = telegramFirebaseUid(uid);
  const names: string[] = [];
  for (const name of SYNC_COLLECTIONS) {
    const documents = await listCollection(env, `users/${firebaseUid}/${name}`);
    for (const doc of documents) {
      if (HAS_REVISIONS_SUBCOLLECTION.has(name)) {
        const revisions = await listCollection(env, `users/${firebaseUid}/${name}/${doc.id}/revisions`);
        for (const revision of revisions) names.push(revision.name);
      }
      names.push(doc.name);
    }
  }
  if (!names.length) return 0;
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const base = documentsUrl.slice(0, -"/documents".length);
  // batchWrite applies each delete independently (no transaction across documents), which is what a
  // deletion of many unrelated marks needs; the REST API bounds a single call at 500 writes.
  for (let i = 0; i < names.length; i += 300) {
    const chunk = names.slice(i, i + 300);
    const response = await fetch(`${base}/documents:batchWrite`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: chunk.map((name) => ({ delete: name })) }),
    });
    if (!response.ok) throw new Error("Firestore deletion failed.");
  }
  return names.length;
}
