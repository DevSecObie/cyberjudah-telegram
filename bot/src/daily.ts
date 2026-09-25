import { Api, GrammyError, InlineKeyboard } from "grammy";
import type { Env, Sub } from "./env";
import { todaysVerse, openButton } from "./bot";

/** The subscriber's hour of the day for a UTC hour: tz is their offset in minutes (half-hour zones round down). */
export const localHour = (utcHour: number, tz: number) => Math.floor((((utcHour * 60 + tz) % 1440) + 1440) % 1440 / 60);

/**
 * Runs every hour: every subscriber whose local hour is now gets today's verse, with a
 * button that opens the chapter in the app. A person who blocked the bot (403) is dropped so
 * the list stays clean; other failures are logged and tried again tomorrow.
 */
export async function sendDaily(env: Env, now = new Date()): Promise<{ sent: number; dropped: number; failed: number }> {
  const hour = now.getUTCHours();
  const verse = await todaysVerse(env);
  const out = { sent: 0, dropped: 0, failed: 0 };
  if (!verse.text) { console.error(JSON.stringify({ event: "daily_no_verse" })); return out; }
  const api = new Api(env.BOT_TOKEN);
  const html = `<b>Verse of the day</b>\n\n${verse.html}`;
  const reply_markup: InlineKeyboard = openButton(env, env.WORKER_URL, "private", verse.param, "Read in CyberJudah");
  let cursor: string | undefined;
  do {
    const page = await env.SUBS.list({ prefix: "sub:", cursor });
    cursor = page.list_complete ? undefined : page.cursor;
    for (let i = 0; i < page.keys.length; i += 20) {
      const chunk = page.keys.slice(i, i + 20);
      const results = await Promise.allSettled(chunk.map(async ({ name }) => {
        const sub = await env.SUBS.get<Sub>(name, "json");
        if (!sub || localHour(hour, sub.tz) !== sub.hour) return "skip";
        try {
          await api.sendMessage(sub.chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup });
          return "sent";
        } catch (e) {
          if (e instanceof GrammyError && e.error_code === 403) { await env.SUBS.delete(name); return "dropped"; }
          throw e;
        }
      }));
      for (const r of results) {
        if (r.status === "rejected") out.failed++;
        else if (r.value === "sent") out.sent++;
        else if (r.value === "dropped") out.dropped++;
      }
    }
  } while (cursor);
  console.log(JSON.stringify({ event: "daily", hour, ...out }));
  return out;
}
