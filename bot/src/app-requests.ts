import { Hono } from "hono";
import type { Env, Exec } from "./env";
import { IdentityError, linkedTelegram } from "./account-links";
import { appReader } from "./app-identity";
import { CONTENT_REPO } from "./cms-github";
import { tellAdmins } from "./health";
import { forgetReady, takeReady } from "./notes-ready";
import { keyedHash, pid } from "./privacy.mjs";
import { syncRequestIssue } from "./request-issues";
import { askedBy, getRequest, requestNotes, tellersOf, validVideo, withoutReader, type NoteRequest } from "./requests";
import { loadTranscript } from "./teachings";

/**
 * A class asked for often enough to be heard (requests.ts MILESTONES): the class is queued for the
 * notes job (an issue, written from the class's own transcript) and the admins are told.
 */
export function announceRequest(env: Env, exec: Exec, video: string, r: NoteRequest) {
  exec.waitUntil((async () => {
    const t = await loadTranscript(env, video, exec).catch(() => null);
    const issue = t && "file" in t && t.kind === "class"
      ? await syncRequestIssue(env, r, { title: t.file.cleanTitle || t.file.title || "", date: t.file.date ?? "" }).catch(() => null)
      : null;
    await tellAdmins(env, `Notes requested ${r.count === 1 ? "for the first time" : `${r.count} times`}: ${r.title || video}\nhttps://www.youtube.com/watch?v=${video}\n${issue ? `Queued for the notes job: https://github.com/${CONTENT_REPO}/issues/${issue}` : `Not queued (no class transcript, or GitHub refused). Video id: ${video}`}`);
  })());
}

/**
 * "Request notes" in the CyberJudah phone app, for any verified app sign-in, linked to Telegram or
 * not (like Said in Class, app-teachings.ts). A reader whose sign-in is linked to Telegram counts
 * as the same reader in both apps; any other is filed under a keyed hash of their sign-in. A reader
 * who asks to be told hears in the app: the notes wait for them at /ready until it next opens.
 */
type AppRequests = { Bindings: Env; Variables: { reader: { pid: string; name: string } } };
export const appRequests = new Hono<AppRequests>();

appRequests.use("*", async (c, next) => {
  try {
    const identity = await appReader(c.req.raw, c.env);
    if (!identity) return c.json({ error: "sign_in_required" }, 401);
    const linked = await linkedTelegram(c.env, identity.uid).catch(() => null);
    const reader = linked ? await pid(c.env, linked) : await keyedHash(c.env, "note-request", identity.uid);
    // A first name is enough for the admins' list; the sign-in's full name is not kept.
    const first = identity.name === "CyberJudah reader" ? "" : (identity.name ?? "").trim().split(/\s+/)[0] ?? "";
    c.set("reader", { pid: reader as string, name: first });
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "sign_in_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
  return next();
});

// The notes this reader asked for that came out since the app last looked (notes-ready.ts).
appRequests.get("/ready", async (c) => c.json({ ok: true, ready: await takeReady(c.env, c.get("reader").pid) }));

appRequests.get("/:video", async (c) => {
  const video = c.req.param("video");
  if (!validVideo(video)) return c.json({ ok: false, error: "bad-video" }, 400);
  const r = await getRequest(c.env, video);
  const me = c.get("reader").pid;
  return c.json({ ok: true, count: r?.count ?? 0, mine: await askedBy(c.env, r, me), tell: (await tellersOf(c.env, r)).some((t) => t.pid === me) });
});

appRequests.post("/:video", async (c) => {
  const video = c.req.param("video");
  if (!validVideo(video)) return c.json({ ok: false, error: "bad-video" }, 400);
  const body = await c.req.json().catch(() => ({})) as { title?: unknown; tell?: unknown };
  const title = typeof body.title === "string" ? body.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) : "";
  const { pid: me, name } = c.get("reader");
  const res = await requestNotes(c.env, video, { pid: me, name, via: "app" }, title, new Date(),
    (r) => announceRequest(c.env, c.executionCtx, video, r), body.tell === true);
  return c.json({ ok: true, ...res });
});

// Account deletion in the app: this reader's asks, name and waiting notes go.
appRequests.delete("/", async (c) => {
  const me = c.get("reader").pid;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await c.env.SUBS.list({ prefix: "notereq:", cursor });
    for (const k of page.keys) {
      const r = await getRequest(c.env, k.name.slice("notereq:".length));
      if (!r || !(await askedBy(c.env, r, me))) continue;
      const rest = await withoutReader(c.env, r, me);
      if (rest) await c.env.SUBS.put(k.name, JSON.stringify(rest), { metadata: { title: rest.title, count: rest.count, last: rest.last } });
      else await c.env.SUBS.delete(k.name);
      removed++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  await forgetReady(c.env, me);
  return c.json({ ok: true, removed });
});
