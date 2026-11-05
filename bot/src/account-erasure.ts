import { linkedFirebase, linkedTelegram, telegramFirebaseUid, validFirebaseUid } from "./account-links";
import { blockAccountIdentities } from "./account-deletion-state";
import { freezeAccountSyncWrites } from "./firestore-admin";
import { erasePublicationsAcrossStores, publicationErasurePeer } from "./publication-erasure";
import type { Env } from "./env";

/** Lock the verified seed before reading its link. Link mutations consult the same D1 barrier
 * atomically, so a concurrent link either precedes this snapshot or is rejected. */
export async function beginFirebaseErasure(env: Env, uid: string): Promise<string[]> {
  if (!validFirebaseUid(uid)) throw new Error("Invalid account identity.");
  const peer = await publicationErasurePeer(env);
  await blockAccountIdentities(env, [uid]);
  const telegramId = await linkedTelegram(env, uid);
  const identities = [...new Set([uid, ...(telegramId === null ? [] : [telegramFirebaseUid(telegramId)])])];
  await blockAccountIdentities(env, identities);
  await freezeAccountSyncWrites(env, identities);
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
