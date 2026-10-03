import { GrammyError } from "grammy";
import type { Env } from "./env";
import { openButton } from "./bot";
import { isAdmin } from "./edit";
import { ownerOfUser, wallet } from "./credits";
import { fmtUsd, MC_PER_USD } from "../../shared/credits.mjs";
import { eveOfHolyDay, fullDarkIn, localHour, zoneOf } from "../../shared/holy-days.mjs";
import { open, seal } from "./privacy.mjs";
import { telegramApi } from "./telegram-api";

/**
 * "Remind me to top up before the Sabbath and feast days": an opt-in Telegram message at midday,
 * in the reader's own time zone, on the day before a Sabbath, feast day or New Moon (when top-ups
 * pause from full dark, shared/holy-days.mjs), sent only if their balance is under $1.
 *
 * One row per reader in D1, filed under their pseudonymous ID; the chat to write to (their
 * Telegram ID) is sealed for them (privacy.mjs). `last_day` is the local date it last went out (or
 * was found not needed), so each eve is handled once. It runs from the reading reminders' cron,
 * every quarter hour (index.ts scheduled), so midday is reached in every time zone.
 */
const TABLE = "CREATE TABLE IF NOT EXISTS topup_reminders (user_id TEXT PRIMARY KEY, chat TEXT NOT NULL, tz TEXT NOT NULL, last_day TEXT NOT NULL DEFAULT '')";
let ready = false;
async function ensure(env: Env) { if (!ready) { await env.DB.prepare(TABLE).run(); ready = true; } }
const sealKey = (owner: string) => `topup:${owner}`;

export async function getTopupReminder(env: Env, uid: number): Promise<{ on: boolean; tz: string | null }> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT tz FROM topup_reminders WHERE user_id = ?").bind(await ownerOfUser(env, uid)).first<{ tz: string }>();
  return { on: !!r, tz: r?.tz ?? null };
}

/** On (with the reader's zone, kept up to date each time it is set) or off. */
export async function setTopupReminder(env: Env, uid: number, on: boolean, tz: unknown): Promise<{ on: boolean; tz: string | null }> {
  await ensure(env);
  const owner = await ownerOfUser(env, uid);
  if (!on) { await env.DB.prepare("DELETE FROM topup_reminders WHERE user_id = ?").bind(owner).run(); return { on: false, tz: null }; }
  const zone = zoneOf(tz);
  await env.DB.prepare("INSERT INTO topup_reminders (user_id, chat, tz) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET chat = excluded.chat, tz = excluded.tz")
    .bind(owner, await seal(env, sealKey(owner), uid), zone).run();
  return { on: true, tz: zone };
}

/** Delete my data: the reminder goes. */
export async function forgetTopupReminder(env: Env, uid: number): Promise<boolean> {
  await ensure(env);
  const r = await env.DB.prepare("DELETE FROM topup_reminders WHERE user_id = ?").bind(await ownerOfUser(env, uid)).run();
  return Number(r.meta.changes ?? 0) > 0;
}

const FOR = { sabbath: "the Sabbath", feast: "the feast day", newmoon: "the New Moon" } as const;

/** Every reader whose midday before a holy day it is now: claimed once for that day, then written to if their balance is under $1. */
export async function sendTopupReminders(env: Env, now = Date.now()): Promise<{ sent: number; checked: number }> {
  await ensure(env);
  const rows = await env.DB.prepare("SELECT user_id, chat, tz, last_day FROM topup_reminders LIMIT 5000").all<{ user_id: string; chat: string; tz: string; last_day: string }>();
  let sent = 0, checked = 0;
  for (const r of rows.results ?? []) {
    const eve = eveOfHolyDay(now, r.tz);
    // Midday on the eve, and only until the pause begins at full dark: after that a reminder would be too late.
    if (!eve || r.last_day === eve.date || localHour(now, r.tz) < 12 || now >= fullDarkIn(eve.date, r.tz)) continue;
    const claimed = await env.DB.prepare("UPDATE topup_reminders SET last_day = ? WHERE user_id = ? AND last_day = ?").bind(eve.date, r.user_id, r.last_day).run();
    if (!Number(claimed.meta.changes ?? 0)) continue;
    checked++;
    const chat = await open<number>(env, sealKey(r.user_id), r.chat);
    if (!Number.isSafeInteger(chat) || isAdmin(env, chat!)) continue;
    const left = (await wallet(env, r.user_id, now)).total_mc;
    if (left >= MC_PER_USD) continue;
    try {
      await telegramApi(env).sendMessage(chat!, `Top-ups pause for ${FOR[eve.kind]} from full dark this evening until after dark tomorrow. Your Ask CyberJudah balance is ${fmtUsd(left, { floor: true })}: top up before then if you will want to ask with a paid model. The free model stays free.`, { reply_markup: openButton(env, env.WORKER_URL, "private", "ask", "Top up") });
      sent++;
    } catch (e) {
      // The reader blocked the bot: there is no one to remind.
      if (e instanceof GrammyError && e.error_code === 403) await env.DB.prepare("DELETE FROM topup_reminders WHERE user_id = ?").bind(r.user_id).run();
      else console.error(JSON.stringify({ event: "topup_reminder_failed", code: e instanceof GrammyError ? e.error_code : 0 }));
    }
  }
  return { sent, checked };
}
