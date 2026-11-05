import { IdentityError, linkedFirebase, telegramFirebaseUid, validFirebaseUid } from "./account-links";
import { blockAccountIdentities } from "./account-deletion-state";
import { freezeAccountSyncWrites } from "./firestore-admin";
import { erasePublicationsAcrossStores, publicationErasurePeer, unlinkNativeAcrossStores } from "./publication-erasure";
import type { Env } from "./env";

/** Native erasure never expands through a link. Durable UID barriers precede unlinking and
 * cleanup; retries need no retained Telegram identity and cannot remove a newer app link. */
export async function beginFirebaseErasure(env: Env, uid: string): Promise<string[]> {
  if (!validFirebaseUid(uid)) throw new Error("Invalid account identity.");
  if (uid.startsWith("tg_")) throw new IdentityError(409, "native_account_required");
  const peer = await publicationErasurePeer(env, true);
  await blockAccountIdentities(env, [uid]);
  const identities = [uid];
  await freezeAccountSyncWrites(env, identities);
  await unlinkNativeAcrossStores(env, peer, uid);
  await erasePublicationsAcrossStores(env, peer, identities);
  return identities;
}

export async function beginTelegramErasure(env: Env, id: number): Promise<string[]> {
  const peer = await publicationErasurePeer(env);
  const legacy = telegramFirebaseUid(id);
  await blockAccountIdentities(env, [legacy]);
  const canonical = await linkedFirebase(env, id);
  const identities = [...new Set([legacy, ...(canonical ? [canonical] : [])])];
  await blockAccountIdentities(env, identities);
  await freezeAccountSyncWrites(env, identities);
  await erasePublicationsAcrossStores(env, peer, identities);
  return identities;
}
