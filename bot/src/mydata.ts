import type { Env } from "./env";
import { deleteAllChats, getChat, listChats } from "./chats";
import { billingRecord, deleteBilling } from "./billing";
import { forgetReminder, loadReminder, tgRid } from "./remind";
import { publicView } from "./reminders.mjs";
import { open, pid, seal } from "./privacy.mjs";
import type { NoteRequest } from "./requests";

/**
 * A reader's rights over what CyberJudah keeps about them (docs/PRIVACY.md; Telegram's Standard
 * Bot Privacy Policy 7.3; Apple's account-deletion requirements):
 * - Download my data: a copy of everything kept, as one JSON file sent to their Telegram chat.
 * - Delete my data: everything removed at once, in the app or with /deletemydata, confirmed
 *   when done. A payment record keeps only Telegram's charge ID, kind, amount and date, no
 *   longer linked to the person: Telegram's refund process and the owner's accounts need it.
 */
export type MyData = {
  generated: string;
  note: string;
  savedChats: unknown[];
  readingReminder: unknown;
  dailyVerse: { hour: number; tzOffsetMinutes: number } | null;
  ask: unknown;
  classNoteRequests: string[];
};

async function noteRequestsOf(env: Env, uid: number): Promise<{ video: string; r: NoteRequest; meta: unknown }[]> {
  const me = await pid(env, uid);
  const out: { video: string; r: NoteRequest; meta: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SUBS.list({ prefix: "notereq:", cursor });
    for (const k of page.keys) {
      const got = await env.SUBS.getWithMetadata(k.name);
      const r = got.value ? (JSON.parse(got.value) as NoteRequest) : null;
      if (r?.users.some((u) => u === me || u === uid)) out.push({ video: k.name.slice("notereq:".length), r, meta: got.metadata });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function exportData(env: Env, uid: number): Promise<MyData> {
  const chats = [];
  for (const c of await listChats(env, uid)) { const chat = await getChat(env, uid, c.id); if (chat) chats.push(chat); }
  const rec = await loadReminder(env, await tgRid(env, uid));
  const subKey = `sub:${await pid(env, uid)}`;
  const sub = await open<{ hour: number; tz: number }>(env, subKey, await env.SUBS.get(subKey));
  return {
    generated: new Date().toISOString(),
    note: "Everything CyberJudah keeps about you. Your highlights, notes, bookmarks and reading history stay on your device and in your Telegram backups, not on CyberJudah's servers.",
    savedChats: chats,
    readingReminder: rec ? publicView(rec) : null,
    dailyVerse: sub ? { hour: sub.hour, tzOffsetMinutes: sub.tz } : null,
    ask: await billingRecord(env, uid).catch(() => null),
    classNoteRequests: (await noteRequestsOf(env, uid)).map((x) => x.video),
  };
}

export type Deleted = { savedChats: number; readingReminder: boolean; dailyVerse: boolean; classNoteRequests: number; askCredits: number; askPlanUntil: string | null };

export async function deleteData(env: Env, uid: number): Promise<Deleted> {
  const me = await pid(env, uid);
  const savedChats = await deleteAllChats(env, uid);
  const readingReminder = await forgetReminder(env, uid);
  const subKey = `sub:${me}`;
  const dailyVerse = !!(await env.SUBS.get(subKey));
  await env.SUBS.delete(subKey);
  const reqs = await noteRequestsOf(env, uid);
  for (const { video, r, meta } of reqs) {
    const users = r.users.filter((u) => u !== me && u !== uid);
    const count = Math.max(0, r.count - 1);
    if (!count) { await env.SUBS.delete(`notereq:${video}`); continue; }
    await env.SUBS.put(`notereq:${video}`, JSON.stringify({ ...r, users, count }), { metadata: { ...(meta as object), count } });
  }
  const billing = await deleteBilling(env, uid).catch(() => ({ credits: 0, planUntil: null }));
  await env.DB.prepare("DELETE FROM rate_counts WHERE key LIKE ?").bind(`%:${me}:%`).run().catch(() => null);
  return { savedChats, readingReminder, dailyVerse, classNoteRequests: reqs.length, askCredits: billing.credits, askPlanUntil: billing.planUntil ? new Date(billing.planUntil).toISOString() : null };
}

/** A confirmation for Delete my data, kept 10 minutes, so a deletion asked for in the bot is confirmed with one tap. */
export async function deletionToken(env: Env, uid: number): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key = `privacydel:${token}`;
  await env.SUBS.put(key, await seal(env, key, { uid }), { expirationTtl: 600 });
  return token;
}
export async function useDeletionToken(env: Env, token: string, uid: number): Promise<boolean> {
  if (!/^[a-f0-9]{16}$/.test(token)) return false;
  const key = `privacydel:${token}`;
  const t = await open<{ uid: number }>(env, key, await env.SUBS.get(key));
  await env.SUBS.delete(key);
  return t?.uid === uid;
}
