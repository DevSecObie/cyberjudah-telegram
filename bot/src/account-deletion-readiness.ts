import type { Env } from "./env";

export class AccountDeletionNotReadyError extends Error {
  constructor() { super("account_deletion_not_ready"); }
}

/** Shared by native, browser and Telegram deletion. Historical ownership and the deployed
 * write-exclusion contract must be verified before any channel can acknowledge erasure. */
export function assertAccountDeletionReady(env: Env): void {
  const localTest = /^(127\.0\.0\.1|localhost):\d+$/.test(env.FIRESTORE_EMULATOR_HOST ?? "");
  if (env.ACCOUNT_DATA_DELETION_READY !== "true" || (!env.FIREBASE_SERVICE_ACCOUNT && !localTest)) {
    throw new AccountDeletionNotReadyError();
  }
}

export const accountDeletionUnavailableMessage = "Deletion is temporarily unavailable because complete removal cannot yet be verified. Your account has not been deleted. Contact privacy@cyberjudah.io for help completing your request.";
