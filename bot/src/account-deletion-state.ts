import type { Env } from "./env";

/** Minimal server-only barriers survive cleanup and lost responses. Never clear them during
 * retry: old tokens/devices must not recreate erased content or attach a different login. */
export async function accountDeletionSchema(env: Env): Promise<void> {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_deletion_blocks (firebase_uid TEXT PRIMARY KEY)").run();
}

export async function blockAccountIdentities(env: Env, identities: readonly string[]): Promise<void> {
  await accountDeletionSchema(env);
  const writes = [...new Set(identities)].map(uid => env.DB.prepare("INSERT OR IGNORE INTO account_deletion_blocks (firebase_uid) VALUES (?)").bind(uid));
  const result = await env.DB.batch(writes);
  if (result.length !== writes.length) throw new Error("Account deletion barrier failed.");
}

export async function accountDeletionBlocked(env: Env, uid: string): Promise<boolean> {
  await accountDeletionSchema(env);
  return !!await env.DB.prepare("SELECT 1 AS blocked FROM account_deletion_blocks WHERE firebase_uid=?").bind(uid).first();
}
