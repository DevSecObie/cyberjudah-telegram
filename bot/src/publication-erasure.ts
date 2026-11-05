import type { Env } from "./env";
import { unlinkDeletingFirebaseAccount, validFirebaseUid } from "./account-links";
import { blockAccountIdentities } from "./account-deletion-state";
import { deletePublishedStudiesForIdentities } from "./published-studies";

export type PublicationStore = "production" | "staging";
export type PublicationReceipt = { version: 1; store: PublicationStore; phase: "blocked" | "deleted" | "native-unlinked"; identities: string[] };
export type PublicationErasurePeer = {
  describe(): Promise<{ version: 1; store: PublicationStore; nativeUnlink?: 1 }>;
  block(identities: string[]): Promise<PublicationReceipt>;
  erase(identities: string[]): Promise<PublicationReceipt>;
  unlinkNative(uid: string): Promise<PublicationReceipt>;
};

export function publicationStore(env: Env): PublicationStore {
  if (env.PUBLICATION_STORE_ID !== "production" && env.PUBLICATION_STORE_ID !== "staging") throw new Error("Publication store is not configured.");
  return env.PUBLICATION_STORE_ID;
}
export function publicationIdentities(identities: readonly string[]): string[] {
  if (!Array.isArray(identities) || !identities.length || identities.length > 4 || !identities.every(validFirebaseUid)) throw new Error("Invalid publication identities.");
  return [...new Set(identities)].sort();
}

/** Resolve the exact two-store contract before barriers or deletion. A missing, unavailable,
 * incompatible or self-bound peer cannot silently narrow an erasure to one database. */
export async function publicationErasurePeer(env: Env, nativeUnlink = false): Promise<PublicationErasurePeer> {
  const local = publicationStore(env), peer = env.PUBLICATION_ERASURE_PEER;
  if (!peer) throw new Error("Publication peer is unavailable.");
  const info = await peer.describe();
  const expected = local === "production" ? "staging" : "production";
  if (info?.version !== 1 || info.store !== expected) throw new Error("Publication peer contract mismatch.");
  if (nativeUnlink && info.nativeUnlink !== 1) throw new Error("Native unlink peer is unavailable.");
  return peer;
}

/** Establish durable intent in both stores before severing either link. Repeating this after
 * any partial failure is safe: neither step depends on remembering the Telegram identity. */
export async function unlinkNativeAcrossStores(env: Env, peer: PublicationErasurePeer, uid: string): Promise<void> {
  if (!validFirebaseUid(uid) || uid.startsWith("tg_")) throw new Error("Native account required.");
  await blockAccountIdentities(env, [uid]);
  assertReceipt(env, await peer.block([uid]), "blocked", [uid]);
  await unlinkDeletingFirebaseAccount(env, uid);
  assertReceipt(env, await peer.unlinkNative(uid), "native-unlinked", [uid]);
}

export async function unlinkLocalNativeAccount(env: Env, uid: string): Promise<PublicationReceipt> {
  const store = publicationStore(env);
  await unlinkDeletingFirebaseAccount(env, uid);
  return { version: 1, store, phase: "native-unlinked", identities: [uid] };
}

function assertReceipt(env: Env, receipt: PublicationReceipt, phase: PublicationReceipt["phase"], identities: string[]) {
  const expected = publicationStore(env) === "production" ? "staging" : "production";
  if (receipt?.version !== 1 || receipt.store !== expected || receipt.phase !== phase ||
      JSON.stringify(receipt.identities) !== JSON.stringify(identities)) throw new Error("Publication cleanup was not acknowledged.");
}

/** Both SQL barriers are acknowledged before either cleanup. Each Writer consults its local
 * barrier atomically; a delayed publication can therefore commit only before its cleanup. */
export async function erasePublicationsAcrossStores(env: Env, peer: PublicationErasurePeer, input: readonly string[]): Promise<void> {
  const identities = publicationIdentities(input);
  await blockAccountIdentities(env, identities);
  assertReceipt(env, await peer.block(identities), "blocked", identities);
  await deletePublishedStudiesForIdentities(env, identities);
  assertReceipt(env, await peer.erase(identities), "deleted", identities);
}

/** Internal RPC operations use THIS Worker's own key and DB. No shared key export, public
 * deletion URL, cross-database SQL or inferred equality of privacy keys is required. */
export async function blockLocalPublications(env: Env, input: string[]): Promise<PublicationReceipt> {
  const store = publicationStore(env), identities = publicationIdentities(input);
  await blockAccountIdentities(env, identities);
  return { version: 1, store, phase: "blocked", identities };
}
export async function eraseLocalPublications(env: Env, input: string[]): Promise<PublicationReceipt> {
  const store = publicationStore(env), identities = publicationIdentities(input);
  await deletePublishedStudiesForIdentities(env, identities);
  return { version: 1, store, phase: "deleted", identities };
}
