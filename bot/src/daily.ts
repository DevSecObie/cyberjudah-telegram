import { Api, GrammyError, InlineKeyboard } from "grammy";
import type { Env, Sub } from "./env";
import { todaysVerse, openButton } from "./bot";
import { open } from "./privacy.mjs";
import { isDue, isDueHour, offsetHour, SENT_TTL, sentKeyOf, subscriberDate } from "./subscribe";

/** The subscriber's hour of the day for a UTC hour: tz is their offset in minutes (half-hour zones round down). */
export const localHour = offsetHour;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Telegram allows roughly 30 messages a second to distinct users; the broadcast stays under it. */
export const SENDS_PER_SECOND = 25;
export const CHUNK = 20;
/** A slot's counts live three days: the health check reads the last finished slot. */
export const SLOT_TTL = 3 * 86400;

type Counts = { sent: number; dropped: number; failed: number };

const slotKey = (when: Date) => `daily:${when.toISOString().slice(0, 10)}:${String(when.getUTCHours()).padStart(2, "0")}`;

/**
 * Runs every hour: every subscriber whose local hour is now gets today's verse, with a
 * button that opens the chapter in the app. A person who blocked the bot (403) is dropped so
 * the list stays clean; other failures are logged and tried again tomorrow.
 *
 * Built for a large list: sends are paced under Telegram's broadcast limit, 429s are
 * retried after the server's own backoff, progress is checkpointed per slot so an
 * interrupted run resumes where it stopped, and the previous hour's unfinished slot is
 * finished first (a very long send can outlive its hour).
 */
export async function sendDaily(env: Env, now = new Date()): Promise<Counts> {
  const out: Counts = { sent: 0, dropped: 0, failed: 0 };
  for (const t of [new Date(now.getTime() - 3600000), now]) await sendSlot(env, t, out);
  return out;
}

/** Notes the local date the verse went out, in its own key: the subscription is never rewritten. */
async function markSent(env: Env, name: string, date: string): Promise<void> {
  try {
    await env.SUBS.put(sentKeyOf(name), date, { expirationTtl: SENT_TTL });
  } catch (e) {
    console.error(JSON.stringify({ event: "daily_mark_failed", message: e instanceof Error ? e.message : String(e) }));
  }
}

/** A person who blocked the bot: their subscription and its sent date go. */
async function dropSub(env: Env, name: string): Promise<void> {
  await env.SUBS.delete(name);
  await env.SUBS.delete(sentKeyOf(name));
}

async function sendSlot(env: Env, when: Date, out: Counts): Promise<void> {
  const key = slotKey(when);
  const saved = (await env.SUBS.get(key, "json")) as { cursor?: string; done?: boolean } | null;
  if (saved?.done) return;
  const verse = await todaysVerse(env);
  if (!verse.text) { console.error(JSON.stringify({ event: "daily_no_verse", slot: key })); return; }
  const api = new Api(env.BOT_TOKEN);
  const html = `<b>Verse of the day</b>\n\n${verse.html}`;
  const reply_markup: InlineKeyboard = openButton(env, env.WORKER_URL, "private", verse.param, "Read in CyberJudah");
  const slot: Counts = { sent: 0, dropped: 0, failed: 0 };
  const drop = (name: string) => dropSub(env, name);
  const send = async (name: string): Promise<"sent" | "dropped" | "skip"> => {
    // Sealed at rest (privacy.mjs); subscriptions from before sealing read as they are.
    const sub = await open<Sub>(env, name, await env.SUBS.get(name));
    // Their hour in their zone when the app sent one (right across daylight saving), else at their
    // fixed offset; and not twice on one local date (the night clocks fall back).
    // The sent date is read only at the subscriber's hour (one read, not one per hour).
    if (!sub || !isDueHour(sub, when) || !isDue(sub, when, await env.SUBS.get(sentKeyOf(name)))) return "skip";
    const date = subscriberDate(sub, when);
    const attempt = async (): Promise<void> => {
      await api.sendMessage(sub.chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup });
      await markSent(env, name, date);
    };
    try {
      await attempt();
      return "sent";
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) { await drop(name); return "dropped"; }
      if (e instanceof GrammyError && e.error_code === 429) {
        const wait = Math.min(60, Number((e as { parameters?: { retry_after?: number } }).parameters?.retry_after ?? 1));
        await sleep(wait * 1000);
        try { await attempt(); return "sent"; } catch (e2) {
          if (e2 instanceof GrammyError && e2.error_code === 403) { await drop(name); return "dropped"; }
          throw e2;
        }
      }
      throw e;
    }
  };
  let cursor: string | undefined = saved?.cursor;
  try {
    do {
      const page = await env.SUBS.list({ prefix: "sub:", cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (let i = 0; i < page.keys.length; i += CHUNK) {
        const chunk = page.keys.slice(i, i + CHUNK);
        const t0 = Date.now();
        const results = await Promise.allSettled(chunk.map(({ name }) => send(name)));
        for (const r of results) {
          if (r.status === "rejected") slot.failed++;
          else if (r.value === "sent") slot.sent++;
          else if (r.value === "dropped") slot.dropped++;
        }
        // Pace the broadcast under Telegram's per-second limit.
        const budget = (chunk.length / SENDS_PER_SECOND) * 1000;
        const elapsed = Date.now() - t0;
        if (elapsed < budget) await sleep(budget - elapsed);
      }
      // Checkpoint: an interrupted run resumes from here instead of starting over.
      if (cursor) await env.SUBS.put(key, JSON.stringify({ cursor, done: false }), { expirationTtl: SLOT_TTL });
    } while (cursor);
    await env.SUBS.put(key, JSON.stringify({ ...slot, done: true }), { expirationTtl: SLOT_TTL });
  } finally {
    out.sent += slot.sent; out.dropped += slot.dropped; out.failed += slot.failed;
    console.log(JSON.stringify({ event: "daily", slot: key, ...slot }));
  }
}
