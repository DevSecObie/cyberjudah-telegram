import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { IdentityError, verifyFirebaseIdentity } from "./account-links";
import { limitPerson, limitSession } from "./app-identity";
import { deleteOwnedStudy, StudyDeletionError } from "./firestore-admin";
import type { Env } from "./env";

export const nativeStudyDeletion = new Hono<{ Bindings: Env }>();
nativeStudyDeletion.use("*", bodyLimit({ maxSize: 1024, onError: c => c.json({ error: "unexpected_deletion_parameters" }, 413) }));
nativeStudyDeletion.use("*", async (c, next) => { c.header("cache-control", "no-store"); await next(); });
nativeStudyDeletion.delete("/:scope/:id", async c => {
  if (Object.keys(c.req.query()).length || (await c.req.text()).length) return c.json({ error: "unexpected_deletion_parameters" }, 400);
  try {
    const token = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    if (!token) throw new IdentityError(401, "invalid_firebase_identity");
    await limitSession(c.req.raw, c.env);
    // Ordinary deletion retains the existing signed-in study-edit semantics; account erasure
    // separately requires recent authentication. Neither accepts a caller-selected owner.
    const identity = await verifyFirebaseIdentity(token);
    await limitPerson(c.env, identity.uid);
    if (c.env.NATIVE_STUDY_DELETION_READY !== "true") return c.json({ error: "study_deletion_not_ready" }, 503);
    const scope = c.req.param("scope"), studyId = c.req.param("id");
    await deleteOwnedStudy(c.env, identity.uid, scope, studyId);
    return c.json({ version: 1, uid: identity.uid, scope, studyId, deleted: true });
  } catch (error) {
    if (error instanceof IdentityError || error instanceof StudyDeletionError) return c.json({ error: error.reason }, error.status);
    return c.json({ error: "study_deletion_incomplete" }, 503);
  }
});
