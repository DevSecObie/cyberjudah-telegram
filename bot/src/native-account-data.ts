import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { IdentityError, verifyFirebaseIdentity } from "./account-links";
import { limitPerson, limitSession } from "./app-identity";
import { deleteFirebaseAccountSyncMarks } from "./firestore-admin";
import type { Env } from "./env";
import { AccountDeletionNotReadyError, assertNativeAccountDeletionReady } from "./account-deletion-readiness";
import { beginFirebaseErasure } from "./account-erasure";

/** Native account erasure, including unlinked Firebase accounts. The client deletes Auth only after
 * this acknowledgment and publication cleanup. No client-supplied UID, path or scope is accepted. */
export const nativeAccountData = new Hono<{ Bindings: Env }>();
nativeAccountData.use("*", bodyLimit({ maxSize: 1024, onError: c => c.json({ error: "unexpected_deletion_parameters" }, 413) }));
nativeAccountData.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  await next();
});
nativeAccountData.delete("/", async c => {
  if (Object.keys(c.req.query()).length || (await c.req.text()).length) return c.json({ error: "unexpected_deletion_parameters" }, 400);
  try {
    const token = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    if (!token) throw new IdentityError(401, "invalid_firebase_identity");
    await limitSession(c.req.raw, c.env);
    const identity = await verifyFirebaseIdentity(token, true);
    await limitPerson(c.env, identity.uid);
    // Recursive queries cannot infer the owner of historical top-level orphan studies. Keep this
    // closed until their reconciliation and the deployed deletion contract have been verified.
    assertNativeAccountDeletionReady(c.env);
    await beginFirebaseErasure(c.env, identity.uid);
    const removed = await deleteFirebaseAccountSyncMarks(c.env, identity.uid);
    return c.json({ version: 2, uid: identity.uid, firestoreDeleted: true, publicationsDeleted: true, writesBlocked: true, removed });
  } catch (error) {
    if (error instanceof AccountDeletionNotReadyError) return c.json({ error: "account_deletion_not_ready" }, 503);
    if (error instanceof IdentityError) return c.json({ error: error.reason }, error.status);
    // Never expose private paths, token material or signing configuration.
    return c.json({ error: "account_deletion_incomplete" }, 503);
  }
});
