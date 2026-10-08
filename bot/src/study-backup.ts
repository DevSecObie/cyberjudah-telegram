import { archiveSchema } from "../../shared/studies";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";
import type { InitData } from "./initdata.mjs";
import { open, pid, seal } from "./privacy.mjs";

async function schema(env: Env) { await env.DB.prepare("CREATE TABLE IF NOT EXISTS study_backups (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, sealed TEXT NOT NULL, updated TEXT NOT NULL)").run(); }
export async function readStudyBackup(env: Env, uid: number) {
  await schema(env); const owner = await pid(env, uid);
  const record = await env.DB.prepare("SELECT revision,sealed,updated FROM study_backups WHERE owner=?").bind(owner).first<{ revision: number; sealed: string; updated: string }>();
  return record ? { revision: record.revision, updated: record.updated, archive: await open(env, owner, record.sealed) } : { revision: 0, updated: null, archive: null };
}
export async function deleteStudyBackup(env: Env, uid: number) { await schema(env); await env.DB.prepare("DELETE FROM study_backups WHERE owner=?").bind(await pid(env, uid)).run(); }
export const studyBackup = new Hono<{ Bindings: Env; Variables: { tma: InitData } }>();
studyBackup.use("*", bodyLimit({ maxSize: 1_000_000 }));
studyBackup.use("*", async (c, next) => { c.header("cache-control", "no-store"); await next(); });
studyBackup.get("/", async c => c.json(await readStudyBackup(c.env, c.get("tma").user!.id)));
studyBackup.put("/", async c => {
  const payload = await c.req.json().catch(() => null) as { revision?: number; archive?: { app?: string; version?: number; studies?: unknown[]; annotations?: unknown[] } } | null;
  if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision! < 0 || payload.archive?.app !== "cyberjudah-studies" || payload.archive.version !== 1 || !Array.isArray(payload.archive.studies) || !Array.isArray(payload.archive.annotations)) return c.json({ error: "Invalid study backup" }, 400);
  const checked = archiveSchema.safeParse(payload.archive);
  if (!checked.success) return c.json({ error: "Invalid study archive" }, 400);
  if (!c.env.PRIVACY_KEY) return c.json({ error: "Cloud study backups are unavailable" }, 503);
  await schema(c.env);
  const owner = await pid(c.env, c.get("tma").user!.id), revision = payload.revision! + 1, updated = new Date().toISOString();
  const sealed = await seal(c.env, owner, checked.data);
  const result = payload.revision === 0
    ? await c.env.DB.prepare("INSERT INTO study_backups(owner,revision,sealed,updated) VALUES(?,?,?,?) ON CONFLICT(owner) DO NOTHING").bind(owner, revision, sealed, updated).run()
    : await c.env.DB.prepare("UPDATE study_backups SET revision=?,sealed=?,updated=? WHERE owner=? AND revision=?").bind(revision, sealed, updated, owner, payload.revision).run();
  if (!result.meta.changes) return c.json({ error: "The cloud backup changed on another device. Reload before saving.", reason: "conflict" }, 409);
  return c.json({ revision, updated });
});
