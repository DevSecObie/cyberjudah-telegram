import { GrammyError } from "grammy";
import type { Env } from "./env";
import type { BroadcastSender } from "./broadcast";
import { openButton } from "./bot";
import { dataJson, escapeHtml } from "./data";
import { tellAdmins } from "./health";
import { pid } from "./privacy.mjs";
import { closeRequestIssue } from "./request-issues";
import { closeRequest, getRequest, listRequests, tellersOf } from "./requests";
import { telegramApi } from "./telegram-api";

/**
 * Requested notes, delivered. Each hour the open requests are checked against the published
 * notes (the site's notes index); a class whose notes are out has its request closed, its issue
 * closed, and each reader who asked to be told is told once: in Telegram by the bot, in the phone
 * app the next time it opens (an entry kept for them until then, `notesready:<pid>`).
 */
type NoteRow = { kind?: string; title?: string; teacher?: string; videoId?: string | null };
export type ReadyNote = { video: string; title: string; teacher?: string };
export type NotesReadyRun = { ready: number; told: number; failed: number; skipped?: string };

const readyKey = (p: string) => `notesready:${p}`;
const NOTE_KINDS = new Set(["class", "captains", "history"]);
/** Kept for a reader who has not opened the app since: long enough for a reader who opens it monthly. */
const READY_TTL = 60 * 24 * 3600;

/** The admins' one message for a run: as many lines as fit in Telegram's limit, then how many more. */
export function adminSummary(done: string[], limit = 4000): string {
  let text = `Requested notes are out (${done.length}):`;
  for (let i = 0; i < done.length; i++) {
    const more = `\n…and ${done.length - i} more.`;
    if (text.length + 1 + done[i].length + (i < done.length - 1 ? more.length : 0) > limit) return text + more;
    text += `\n${done[i]}`;
  }
  return text;
}

/** The message a Telegram reader gets. */
export const readyMessage = (n: ReadyNote) =>
  `<b>Your notes are ready</b>\n${escapeHtml(n.title)}${n.teacher ? `\n${escapeHtml(n.teacher)}` : ""}`;

async function keepForApp(env: Env, p: string, note: ReadyNote): Promise<void> {
  const cur = (await env.SUBS.get(readyKey(p), "json").catch(() => null)) as ReadyNote[] | null;
  const list = [...(Array.isArray(cur) ? cur : []).filter((x) => x.video !== note.video), note].slice(-20);
  await env.SUBS.put(readyKey(p), JSON.stringify(list), { expirationTtl: READY_TTL });
}

/** The notes that came out for this reader since the app last asked; handed over once. */
export async function takeReady(env: Env, who: number | string): Promise<ReadyNote[]> {
  const k = readyKey(typeof who === "number" ? await pid(env, who) : who);
  const list = (await env.SUBS.get(k, "json").catch(() => null)) as ReadyNote[] | null;
  if (!Array.isArray(list) || !list.length) return [];
  await env.SUBS.delete(k);
  return list;
}

/** Forget what was waiting for this reader (Delete my data). */
export async function forgetReady(env: Env, who: number | string): Promise<boolean> {
  const k = readyKey(typeof who === "number" ? await pid(env, who) : who);
  const had = !!(await env.SUBS.get(k));
  await env.SUBS.delete(k);
  return had;
}

export async function deliverReadyNotes(env: Env, sender: BroadcastSender): Promise<NotesReadyRun> {
  const open = await listRequests(env);
  if (!open.length) return { ready: 0, told: 0, failed: 0, skipped: "none" };
  const rows = await dataJson<NoteRow[]>(env, "/api/notes/index.json").catch(() => null);
  if (!Array.isArray(rows)) return { ready: 0, told: 0, failed: 0, skipped: "index_down" };
  const published = new Map<string, NoteRow>();
  // Only class notes count as published, as the class-notes search reads them (app-study-research.ts).
  for (const row of rows) if (row.videoId && NOTE_KINDS.has(row.kind ?? "") && !published.has(row.videoId)) published.set(row.videoId, row);
  const api = telegramApi(env);
  const run: NotesReadyRun = { ready: 0, told: 0, failed: 0 };
  const done: string[] = [];
  try {
    for (const { video } of open) {
      const row = published.get(video);
      if (!row) continue;
      const r = await getRequest(env, video);
      if (!r) continue;
      const tellers = await tellersOf(env, r);
      // Closed before anyone is told: told at most once is better than twice when a run is cut short.
      await closeRequest(env, video);
      run.ready++;
      const note: ReadyNote = { video, title: row.title || r.title || video, ...(row.teacher ? { teacher: row.teacher } : {}) };
      let told = 0;
      for (const t of tellers) {
        try {
          if (t.via === "telegram" && t.chat) {
            await sender.send(() => api.sendMessage(t.chat!, readyMessage(note), {
              parse_mode: "HTML", link_preview_options: { is_disabled: true },
              reply_markup: openButton(env, env.WORKER_URL, "private", `watch_${video}`, "Open the notes"),
            }));
          } else await keepForApp(env, t.pid, note);
          told++;
        } catch (e) {
          // 403: the reader blocked the bot or never let it write to them. Nothing more to do.
          if (!(e instanceof GrammyError && e.error_code === 403)) run.failed++;
        }
      }
      run.told += told;
      if (r.issue) await closeRequestIssue(env, r.issue).catch(() => false);
      done.push(`${note.title.slice(0, 120)}: ${r.count} ${r.count === 1 ? "reader" : "readers"} asked; ${told} told.`);
    }
  } finally {
    // One summary per run, however many requests closed, so a first run does not flood the admins.
    // Sent even when the run stops partway, for the requests it closed; kept within Telegram's 4096.
    if (done.length) await tellAdmins(env, adminSummary(done)).catch(() => 0);
  }
  return run;
}
