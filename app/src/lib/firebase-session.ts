import { auth } from "./firebase-client";
/** Firebase owns token persistence and refresh. Never store bearer tokens ourselves. */
export async function firebaseAuthorization(): Promise<string | undefined> {
  await auth.authStateReady();
  return auth.currentUser ? `Bearer ${await auth.currentUser.getIdToken()}` : undefined;
}
