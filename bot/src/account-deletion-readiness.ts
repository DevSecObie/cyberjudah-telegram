import type { Env } from "./env";

export class AccountDeletionNotReadyError extends Error {
  constructor() { super("account_deletion_not_ready"); }
}

/** Each release owns its gate. A legacy/shared flag must never enable another channel. */
function assertReady(env: Env, ready: string | undefined): void {
  const localTest = /^(127\.0\.0\.1|localhost):\d+$/.test(env.FIRESTORE_EMULATOR_HOST ?? "");
  if (ready !== "true" || (!env.FIREBASE_SERVICE_ACCOUNT && !localTest)) {
    throw new AccountDeletionNotReadyError();
  }
}

export function assertNativeAccountDeletionReady(env: Env): void {
  assertReady(env, env.NATIVE_ACCOUNT_DELETION_READY);
}

/** Browser Delete my data is the Telegram account-data flow, not native Firebase deletion. */
export function assertTelegramAccountDeletionReady(env: Env): void {
  assertReady(env, env.TELEGRAM_ACCOUNT_DELETION_READY);
}

export const accountDeletionUnavailableMessage = "Deletion is temporarily unavailable because complete removal cannot yet be verified. Your account has not been deleted. Contact privacy@cyberjudah.io for help completing your request.";
