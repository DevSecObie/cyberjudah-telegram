import { linkedFirebase, linkedTelegram, telegramFirebaseUid, validFirebaseUid } from "./account-links";
import { importPKCS8, SignJWT } from "jose";
import type { Env } from "./env";

const PROJECT = "cyberjudah-app";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";
const AUTH_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
/** Every Firestore collection account sync writes under users/{uid} (app/src/sync/reader.ts). Revision history
 * for notes and studies lives in a `revisions` subcollection under each document; the other collections keep
 * their history as sibling `revision-*` documents, so a plain list of the collection already includes it. */
const SYNC_COLLECTIONS = ["highlights", "notes", "links", "bookmarks", "tags", "relations", "studies", "wordAnnotations"] as const;
const HAS_REVISIONS_SUBCOLLECTION = new Set<string>(["notes", "studies"]);

type FirestoreValue = Record<string, unknown>;
type RawDocument = { name: string; fields?: Record<string, FirestoreValue>; createTime?: string; updateTime?: string };
export type SyncDocument = { name: string; id: string; fields: Record<string, unknown>; updateTime?: string };
type DeletionDocuments = Map<string, { name: string; updateTime: string }>;
type StudyFence = { document: RawDocument; parent: RawDocument | null };

function remember(documents: DeletionDocuments, document: { name: string; updateTime?: string }): void {
  if (!document.updateTime || (documents.has(document.name) && documents.get(document.name)!.updateTime !== document.updateTime)) throw new Error("Firestore deletion snapshot changed.");
  documents.set(document.name, { name: document.name, updateTime: document.updateTime });
}

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

const mintedTokens = new Map<string, { token: string; expires: number }>();
/** The emulator does not check the token's value (`Authorization: Bearer owner` is its documented admin
 * bypass); production mints a real Google access token from the signing secret, cached for its lifetime. */
async function accessToken(env: Env, scope = SCOPE): Promise<string> {
  if (emulatorHost(env)) return "owner";
  const minted = mintedTokens.get(scope);
  if (minted && minted.expires > Date.now()) return minted.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Account sync is not configured on this Worker.");
  let account: { type?: unknown; project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new Error("Invalid signing configuration"); }
  if (account.type !== "service_account" || account.project_id !== PROJECT ||
    typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) ||
    typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
  const key = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email).setSubject(account.client_email).setAudience(TOKEN_URL)
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const response = await fetch(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("Google access is unavailable.");
  const result = await response.json() as { access_token: string; expires_in: number };
  // A minute of slack keeps a long export or deletion from minting mid-call.
  mintedTokens.set(scope, { token: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1000 });
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
async function listCollection(env: Env, path: string, showMissing = false, fieldPaths: readonly string[] = [], inventoryToken?: () => Promise<string>): Promise<(SyncDocument & { missing?: boolean })[]> {
  const { documentsUrl } = databasePath(env);
  const token = inventoryToken ? await inventoryToken() : await accessToken(env);
  const documents: (SyncDocument & { missing?: boolean })[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    if (pageToken) params.set("pageToken", pageToken);
    // A "missing" document has no fields of its own but still holds subcollections.
    if (showMissing) params.set("showMissing", "true");
    for (const field of fieldPaths) params.append("mask.fieldPaths", field);
    const response = await fetch(`${documentsUrl}/${path}?${params}`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) break;
    if (!response.ok) throw new Error("Firestore read failed.");
    const body = await response.json() as { documents?: RawDocument[]; nextPageToken?: string };
    for (const doc of body.documents ?? []) documents.push({ name: doc.name, id: doc.name.split("/").pop()!, fields: decodeFields(doc.fields ?? {}), updateTime: doc.updateTime, ...(showMissing && !doc.createTime ? { missing: true } : {}) });
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
  const canonical = await linkedFirebase(env, uid) ?? telegramFirebaseUid(uid);
  const identities = [...new Set([canonical, telegramFirebaseUid(uid)])].map(encodeURIComponent);
  const out: Record<string, unknown[]> = {};
  for (const firebaseUid of identities) for (const name of SYNC_COLLECTIONS) {
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
    out[firebaseUid === encodeURIComponent(canonical) ? name : `legacyTelegram.${name}`] = rows;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Whether a Firebase login still exists, asked of Firebase Authentication with the signing secret. Signing a
 * custom token for a deleted UID would silently create that account again, so a failed answer throws and
 * the caller fails closed. The emulator has no Authentication service: its test logins always exist.
 */
export async function firebaseUserExists(env: Env, firebaseUid: string): Promise<boolean> {
  if (emulatorHost(env)) return true;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Account sync is not configured on this Worker.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${await accessToken(env, AUTH_SCOPE)}`, "content-type": "application/json" },
    body: JSON.stringify({ localId: [firebaseUid] }),
  });
  if (!response.ok) throw new Error("Firebase Authentication is unavailable.");
  const body = await response.json() as { users?: { localId?: string }[] };
  return !!body.users?.some((user) => user.localId === firebaseUid);
}

/** The account documents and collections a Firebase login owns beside users/{uid}/…: Bible Strong keeps its
 * profile and every study collection under users/{uid}, its studies at the top level (owned by `user.id`), its
 * sync state under users-status/{uid}, and staging keeps the same layout under `staging_` names. */
const ACCOUNT_ROOTS = ["users", "staging_users", "users-status", "staging_users-status"] as const;
const STUDY_ROOTS = ["studies", "staging_studies"] as const;
const STUDY_OWNERS = "study_deletion_owners";
const MAX_DEPTH = 8;

/** Commit and acknowledge every UID barrier before enumerating data. Rules deny client writes
 * while these server-only records exist, including old sessions and offline queue replay.
 * The markers are deliberately outside the erased roots and contain no study content. */
export async function freezeAccountSyncWrites(env: Env, identities: readonly string[]): Promise<void> {
  if (!syncConfigured(env) || !identities.length || !identities.every(validFirebaseUid)) throw new Error("Account deletion is unavailable.");
  const { documentsUrl } = databasePath(env);
  const nameRoot = documentsUrl.slice(documentsUrl.indexOf("projects/"));
  const writes = [...new Set(identities)].map(uid => ({ update: {
    name: `${nameRoot}/account_deletion_blocks/${uid}`,
    fields: { version: { integerValue: "1" } },
  } }));
  const response = await fetch(`${documentsUrl}:commit`, {
    method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error("Account deletion barrier failed.");
  const result = await response.json() as { writeResults?: unknown[] };
  if (!Array.isArray(result.writeResults) || result.writeResults.length !== writes.length) throw new Error("Account deletion barrier failed.");
}
const validStudyId = (id: string) => id.length > 0 && new TextEncoder().encode(id).length < 1400 && id !== "." && id !== ".." && !/[\u0000-\u001f/]/.test(id);

export class StudyDeletionError extends Error {
  constructor(public status: 403 | 409 | 503, public reason: string) { super(reason); }
}

const studyOwner = (document: RawDocument | null) => (decodeFields(document?.fields ?? {}).user as { id?: unknown } | undefined)?.id;
const documentPath = (name: string) => name.slice(name.indexOf("/documents/") + "/documents/".length);
const urlPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function ledgerStudy(document: RawDocument, uid: string): { root: string; id: string } {
  const fields = decodeFields(document.fields ?? {});
  if (studyOwner(document) !== uid || (fields.state !== undefined && fields.state !== "deleting") || fields.version !== 1 || !STUDY_ROOTS.includes(fields.studyRoot as typeof STUDY_ROOTS[number]) || typeof fields.studyId !== "string" || !validStudyId(fields.studyId) || documentPath(document.name) !== `${STUDY_OWNERS}/${fields.studyRoot}:${fields.studyId}`)
    throw new StudyDeletionError(409, "study_ownership_unresolved");
  return { root: fields.studyRoot as string, id: fields.studyId };
}

/** Fences ownership in a server-only ledger before removing descendants or the parent. It deliberately
 * survives ordinary deletion so late histories and retries remain attributable. No client writes
 * to this collection may be allowed by deployed rules. */
export async function deleteOwnedStudy(env: Env, uid: string, scope: string, id: string): Promise<void> {
  if (!validFirebaseUid(uid) || !validStudyId(id) || !["production", "staging"].includes(scope)) throw new StudyDeletionError(409, "invalid_study_deletion");
  if (!syncConfigured(env)) throw new StudyDeletionError(503, "study_deletion_unavailable");
  const root = scope === "staging" ? "staging_studies" : "studies";
  const path = `${root}/${id}`, ledgerPath = `${STUDY_OWNERS}/${root}:${id}`;
  const parent = await readDocument(env, urlPath(path));
  const ledger = await readDocument(env, urlPath(ledgerPath));
  if (parent && studyOwner(parent) !== uid) throw new StudyDeletionError(403, "study_not_owned");
  if (ledger) ledgerStudy(ledger, uid);
  if (!parent && !ledger) {
    const unknown: DeletionDocuments = new Map();
    await descendants(env, urlPath(path), unknown, ["revisions"]);
    if (unknown.size) throw new StudyDeletionError(409, "study_ownership_unresolved");
    return; // Already absent, and no data exists to remove. Never invent ownership.
  }
  const fence = await acquireStudyFence(env, uid, root, id, parent, ledger);
  await eraseFencedStudy(env, path, fence);
}

/** Every eraser claims the same server-only document using compare-and-swap. Claiming advances
 * its version, fencing older requests. Parent and fence acquisition are one atomic commit. */
async function acquireStudyFence(env: Env, uid: string, root: string, id: string, parent: RawDocument | null, ledger: RawDocument | null): Promise<StudyFence> {
  if (parent && studyOwner(parent) !== uid) throw new StudyDeletionError(403, "study_not_owned");
  if (ledger) ledgerStudy(ledger, uid);
  if (!parent && !ledger) throw new StudyDeletionError(409, "study_ownership_unresolved");
  if ((parent && !parent.updateTime) || (ledger && !ledger.updateTime)) throw new Error("Firestore deletion snapshot changed.");
  const { documentsUrl } = databasePath(env);
  const nameRoot = documentsUrl.slice(documentsUrl.indexOf("projects/"));
  const document: RawDocument = { name: `${nameRoot}/${STUDY_OWNERS}/${root}:${id}`, fields: {
    generation: { stringValue: crypto.randomUUID() }, state: { stringValue: "deleting" },
    version: { integerValue: "1" }, user: { mapValue: { fields: { id: { stringValue: uid } } } },
    studyRoot: { stringValue: root }, studyId: { stringValue: id },
  } };
  const writes = [
    { update: document, currentDocument: ledger ? { updateTime: ledger.updateTime } : { exists: false } },
    // Update only the existing owner field to itself. This preserves all content and fences a
    // concurrent replacement/edit without removing the parent before its descendants succeed.
    ...(parent ? [{ update: { name: parent.name, fields: { user: { mapValue: { fields: { id: { stringValue: uid } } } } } }, updateMask: { fieldPaths: ["user.id"] }, currentDocument: { updateTime: parent.updateTime } }] : []),
  ];
  const results = await commitDeletionWrites(env, writes);
  document.updateTime = results[0].updateTime;
  return { document, parent: parent ? { ...parent, updateTime: results[1].updateTime } : null };
}

async function commitDeletionWrites(env: Env, writes: unknown[]): Promise<{ updateTime: string }[]> {
  const { documentsUrl } = databasePath(env);
  const response = await fetch(`${documentsUrl}:commit`, {
    method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error("Firestore deletion failed.");
  const result = await response.json() as { writeResults?: { updateTime?: string }[] };
  if (!Array.isArray(result.writeResults) || result.writeResults.length !== writes.length || !result.writeResults[0]?.updateTime) throw new Error("Firestore deletion failed.");
  return result.writeResults as { updateTime: string }[];
}

async function eraseFencedStudy(env: Env, path: string, fence: StudyFence): Promise<number> {
  let count = 0;
  const children: DeletionDocuments = new Map();
  await descendants(env, urlPath(path), children, ["revisions"]);
  count += await deleteDocumentNames(env, children, fence);
  if (fence.parent) {
    const parent: DeletionDocuments = new Map(); remember(parent, fence.parent);
    count += await deleteDocumentNames(env, parent, fence);
    fence.parent = null;
  }
  // A privileged late writer still has an attributable path until this pass succeeds.
  const remaining: DeletionDocuments = new Map();
  await descendants(env, urlPath(path), remaining, ["revisions"]);
  count += await deleteDocumentNames(env, remaining, fence);
  return count;
}

async function finishStudyErasure(env: Env, fence: StudyFence): Promise<void> {
  // Reserve the ID permanently without retaining the deleted account's UID. Removing this
  // record would permit ID reuse while an older erasure still holds a stale deletion plan.
  const { version, studyRoot, studyId } = fence.document.fields!;
  const fields = { version, studyRoot, studyId };
  const results = await commitDeletionWrites(env, [{ update: { name: fence.document.name, fields: { ...fields, state: { stringValue: "erased" } } }, currentDocument: { updateTime: fence.document.updateTime } }]);
  fence.document.updateTime = results[0].updateTime;

}

/** Read-only reconciliation input, deliberately not exposed as a public route. Projection avoids
 * reading study content. A missing top-level parent proves surviving descendants, not their owner.
 * Never use this inventory alone as deletion authorization or a readiness-gate override. */
export async function inventoryOrphanedStudyParents(env: Env, inventoryToken?: () => Promise<string>): Promise<{ version: 1; orphanParents: string[]; ownershipResolved: false }> {
  if (!syncConfigured(env) && !inventoryToken) throw new Error("Account inventory is unavailable.");
  const orphanParents: string[] = [];
  for (const root of STUDY_ROOTS) {
    for (const document of await listCollection(env, root, true, ["user.id"], inventoryToken)) {
      if (document.missing) orphanParents.push(document.name);
    }
  }
  return { version: 1, orphanParents, ownershipResolved: false };
}

async function readDocument(env: Env, path: string): Promise<RawDocument | null> {
  const { documentsUrl } = databasePath(env);
  const response = await fetch(`${documentsUrl}/${path}`, { headers: { authorization: `Bearer ${await accessToken(env)}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Firestore read failed.");
  return await response.json() as RawDocument;
}

/** The ids of every subcollection directly under one document, paginated. 404 is none. */
async function listCollectionIds(env: Env, path: string): Promise<string[]> {
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const response = await fetch(`${documentsUrl}/${path}:listCollectionIds`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) }),
    });
    if (response.status === 404) break;
    if (!response.ok) throw new Error("Firestore read failed.");
    const body = await response.json() as { collectionIds?: string[]; nextPageToken?: string };
    ids.push(...(body.collectionIds ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return ids;
}

/** Every document below one document (not the document itself), deepest first. */
async function descendants(env: Env, path: string, names: DeletionDocuments, known: readonly string[] = [], depth = 0): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error("Firestore deletion failed.");
  for (const collection of new Set([...known, ...await listCollectionIds(env, path)])) {
    for (const doc of await listCollection(env, `${path}/${encodeURIComponent(collection)}`, true)) {
      const child = `${path}/${encodeURIComponent(collection)}/${encodeURIComponent(doc.id)}`;
      await descendants(env, child, names, HAS_REVISIONS_SUBCOLLECTION.has(collection) && depth === 0 ? ["revisions"] : [], depth + 1);
      if (!doc.missing) remember(names, doc);
    }
  }
}

/** The documents of the studies one login owns, found by owner rather than by path. */
async function ownedStudies(env: Env, root: string, firebaseUid: string): Promise<string[]> {
  const { documentsUrl } = databasePath(env);
  const response = await fetch(`${documentsUrl}:runQuery`, {
    method: "POST", headers: { authorization: `Bearer ${await accessToken(env)}`, "content-type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: root }], where: { fieldFilter: { field: { fieldPath: "user.id" }, op: "EQUAL", value: { stringValue: firebaseUid } } } } }),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Firestore read failed.");
  const rows = await response.json() as { document?: RawDocument }[];
  if (!Array.isArray(rows)) throw new Error("Firestore read failed.");
  return rows.flatMap((row) => row.document ? [row.document.name] : []);
}

/**
 * Deletes discoverable account data: all descendants of the known UID roots, including missing
 * intermediate documents, and top-level studies whose existing parent identifies this login as owner.
 * A top-level study whose parent was already removed cannot be attributed by this owner query; its
 * orphan history requires trusted ownership evidence before cleanup. This is not proof of complete
 * historical account erasure. Counts removed content documents and UID-bearing ledgers anonymized. A no-op (0) when this
 * Worker has no Firestore access configured. Throws, like every other store in mydata.ts, when a step
 * fails, so the caller reports an incomplete deletion rather than acknowledging one.
 */
export async function deleteAccountSyncMarks(env: Env, uid: number): Promise<number> {
  if (!syncConfigured(env)) return 0;
  const canonical = await linkedFirebase(env, uid) ?? telegramFirebaseUid(uid);
  return deleteIdentityDocuments(env, [canonical, telegramFirebaseUid(uid)]);
}

/** Call only after verifying a recent Firebase identity. Unlike the optional Telegram sync cleanup,
 * native account deletion must fail closed when Firestore is unavailable. A legacy identity comes
 * exclusively from the server's authenticated account-link record, never from request parameters. */
export async function deleteFirebaseAccountSyncMarks(env: Env, firebaseUid: string): Promise<number> {
  if (!validFirebaseUid(firebaseUid) || !syncConfigured(env)) throw new Error("Account deletion is unavailable.");
  const telegramId = await linkedTelegram(env, firebaseUid);
  return deleteIdentityDocuments(env, [firebaseUid, ...(telegramId === null ? [] : [telegramFirebaseUid(telegramId)])]);
}

async function deleteIdentityDocuments(env: Env, identities: string[]): Promise<number> {
  if (!identities.every(validFirebaseUid)) throw new Error("Invalid account identity.");
  const found: DeletionDocuments = new Map();
  const studies = new Map<string, { uid: string; root: string; id: string; parent: RawDocument | null; ledger: RawDocument | null }>();
  const inspectStudy = async (uid: string, root: string, id: string) => {
    const path = `${root}/${id}`;
    if (!validStudyId(id) || studies.has(path)) return;
    const parent = await readDocument(env, urlPath(path));
    const ledger = await readDocument(env, urlPath(`${STUDY_OWNERS}/${root}:${id}`));
    if (parent && studyOwner(parent) !== uid) throw new Error("Study ownership changed during deletion.");
    if (ledger) ledgerStudy(ledger, uid);
    if (!parent && !ledger) throw new Error("Study ownership changed during deletion.");
    studies.set(path, { uid, root, id, parent, ledger });
  };
  for (const firebaseUid of new Set(identities)) {
    const id = encodeURIComponent(firebaseUid);
    for (const root of ACCOUNT_ROOTS) {
      await descendants(env, `${root}/${id}`, found, root === "users" ? SYNC_COLLECTIONS : []);
      const own = await readDocument(env, `${root}/${id}`);
      if (own) remember(found, own);
    }
    for (const root of STUDY_ROOTS) for (const name of await ownedStudies(env, root, firebaseUid)) {
      const path = documentPath(name), studyId = path.slice(root.length + 1);
      if (!validStudyId(studyId) || path !== `${root}/${studyId}`) throw new Error("Invalid study path.");
      await inspectStudy(firebaseUid, root, studyId);
    }
    for (const name of await ownedStudies(env, STUDY_OWNERS, firebaseUid)) {
      const ledger = await readDocument(env, urlPath(documentPath(name)));
      if (!ledger) throw new Error("Study ownership changed during deletion.");
      const study = ledgerStudy(ledger, firebaseUid);
      await inspectStudy(firebaseUid, study.root, study.id);
    }
  }
  // Validate all ownership/quarantine records before the first content delete. Acquire every
  // fence before proceeding; a newer erasure invalidates any older holder atomically.
  const fenced: { path: string; fence: StudyFence }[] = [];
  for (const [path, study] of studies) fenced.push({ path, fence: await acquireStudyFence(env, study.uid, study.root, study.id, study.parent, study.ledger) });
  let count = await deleteDocumentNames(env, found);
  for (const { path, fence } of fenced) {
    count += await eraseFencedStudy(env, path, fence);
    await finishStudyErasure(env, fence);
    count++; // The UID-bearing ledger was replaced with an owner-free ID reservation.
  }
  return count;
}

async function deleteDocumentNames(env: Env, documents: DeletionDocuments, fence?: StudyFence): Promise<number> {
  const names = [...documents.keys()];
  if (!names.length) return 0;
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const base = documentsUrl.slice(0, -"/documents".length);
  // batchWrite is independent and unordered. Acknowledge every deeper level first,
  // keeping a study discoverable by its owner while any descendant deletion is unconfirmed.
  const levels = new Map<number, string[]>();
  for (const name of names) {
    const depth = name.split("/").length;
    const level = levels.get(depth) ?? [];
    level.push(name);
    levels.set(depth, level);
  }
  for (const [, level] of [...levels].sort(([a], [b]) => b - a)) {
    for (let i = 0; i < level.length; i += 300) {
      const chunk = level.slice(i, i + 300);
      const writes = chunk.map(name => ({ delete: name, currentDocument: { updateTime: documents.get(name)!.updateTime } }));
      if (fence) {
        const fields = { ...fence.document.fields, generation: { stringValue: crypto.randomUUID() } };
        const results = await commitDeletionWrites(env, [
          { update: { name: fence.document.name, fields }, currentDocument: { updateTime: fence.document.updateTime } },
          ...writes,
        ]);
        fence.document.updateTime = results[0].updateTime;
        fence.document.fields = fields;
        continue;
      }
      const response = await fetch(`${base}/documents:batchWrite`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ writes }),
      });
      if (!response.ok) throw new Error("Firestore deletion failed.");
      // batchWrite can return HTTP 200 with failures for individual writes. Protobuf JSON
      // may omit code for OK (0), but there must be one status object for every delete.
      const result = await response.json() as { status?: { code?: number }[] } | null;
      if (!Array.isArray(result?.status) || result.status.length !== chunk.length ||
        result.status.some(status => !status || typeof status !== "object" || Array.isArray(status) ||
          (status.code !== undefined && status.code !== 0))) {
        throw new Error("Firestore deletion failed.");
      }
    }
  }
  return names.length;
}
