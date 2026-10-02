/**
 * Reading reminders: the rules, with no I/O, so they can be tested without a Worker.
 *
 * A reminder is opt-in and off by default. It names an hour in the reader's own time zone
 * (an IANA name such as "America/Chicago", so summer time is followed), and the channels it
 * goes to: Telegram (the bot's chat), push (Web Push to a browser), or both. Each channel
 * gets at most one reminder a local day. The hourly cron sends at the reader's hour; a run
 * that was missed is caught up once in the next hours (CATCH_UP_HOURS), never twice, because
 * the day it was sent is kept per channel. "Done" in either place marks the day done, which
 * stops the other channel for that day too.
 *
 * What is reminded is the reader's own place: today's portion of their reading plan when
 * they have one, else the chapter they last read ("continue where you left off"). Only the
 * book, chapter and plan day are kept; no verse text is ever sent.
 */

/** A missed hour is made up within this many hours of the reader's time, once. */
export const CATCH_UP_HOURS = 3;
/** "Pause" from the reminder skips this many days. */
export const PAUSE_DAYS = 7;
/** Push responses that mean this subscription will never deliver again (expired, unsubscribed, or bound to another key). */
export const PUSH_GONE = new Set([400, 401, 403, 404, 410]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the runtime knows this IANA time zone. */
export function validTz(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** The reader's local calendar date (YYYY-MM-DD) and hour (0-23) at an instant. */
export function localNow(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: validTz(tz) ? tz : "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** A calendar date moved by n days. */
export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A new reminder: everything off. */
export function blank(tz = "UTC") {
  return { v: 1, on: false, hour: 7, tz: validTz(tz) ? tz : "UTC", channels: { telegram: false, push: false }, sent: {}, pending: [] };
}

/**
 * The reader's settings applied to a record, from untrusted input: unknown fields are
 * ignored, a bad hour or time zone keeps the old value. Turning it on, or moving the hour,
 * starts it from the next time that hour comes round, so a change made after today's hour
 * does not send at once.
 */
export function applySettings(rec, input, now = new Date()) {
  const next = { ...rec, channels: { ...rec.channels }, sent: { ...rec.sent } };
  if (!input || typeof input !== "object") return next;
  if (typeof input.on === "boolean") next.on = input.on;
  if (Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23) next.hour = input.hour;
  if (validTz(input.tz)) next.tz = input.tz;
  if (input.channels && typeof input.channels === "object") {
    if (typeof input.channels.telegram === "boolean") next.channels.telegram = input.channels.telegram;
    if (typeof input.channels.push === "boolean") next.channels.push = input.channels.push;
  }
  if (input.paused === false) delete next.pausedUntil;
  if (input.paused === true) next.pausedUntil = addDays(localNow(next.tz, now).date, PAUSE_DAYS);
  if (next.on && (!rec.on || next.hour !== rec.hour || next.tz !== rec.tz)) {
    const { date, hour } = localNow(next.tz, now);
    next.from = hour < next.hour ? date : addDays(date, 1);
  }
  if (!next.channels.telegram && !next.channels.push) next.on = false;
  return next;
}

/** The reader's place, from the app: the plan's day and pace, and the last chapter read. Anything malformed is dropped. */
export function applyContent(rec, content) {
  const next = { ...rec };
  if (!content || typeof content !== "object") return next;
  const p = content.plan;
  if (p === null) next.plan = null;
  else if (p && Number.isInteger(p.day) && p.day >= 0 && p.day < 5000 && Number.isInteger(p.perDay) && p.perDay >= 1 && p.perDay <= 50) next.plan = { day: p.day, perDay: p.perDay };
  const l = content.last;
  if (l === null) next.last = null;
  else if (l && typeof l.slug === "string" && /^[a-z0-9-]{1,40}$/.test(l.slug) && Number.isInteger(l.chapter) && l.chapter >= 1 && l.chapter <= 200) next.last = { slug: l.slug, chapter: l.chapter };
  return next;
}

/** A channel can be sent to when it is chosen and has somewhere to go. */
export function reachable(rec, ch) {
  if (!rec.channels?.[ch]) return false;
  return ch === "telegram" ? Number.isInteger(rec.chatId) : !!rec.push?.endpoint;
}

/**
 * The channels to remind on now: on, not paused, today not marked done, the reader's hour
 * reached within the catch-up window, and that channel not yet reminded today.
 */
export function dueChannels(rec, now = new Date()) {
  if (!rec?.on) return [];
  const { date, hour } = localNow(rec.tz, now);
  if (rec.from && date < rec.from) return [];
  if (rec.pausedUntil && date < rec.pausedUntil) return [];
  if (rec.done === date) return [];
  const late = hour - rec.hour;
  if (late < 0 || late >= CATCH_UP_HOURS) return [];
  return ["telegram", "push"].filter((ch) => reachable(rec, ch) && rec.sent?.[ch] !== date);
}

/** Record that a channel was reminded on the reader's date. */
export function markSent(rec, ch, now = new Date()) {
  return { ...rec, sent: { ...rec.sent, [ch]: localNow(rec.tz, now).date } };
}

/**
 * The Apocrypha in the 1611 order, with the names the app shows: the same list as
 * APOCRYPHA in app/src/api/data.ts (a test keeps the two equal), so the plan days counted
 * here are the app's plan days.
 */
export const APOCRYPHA = [
  ["1-esdras", "1 Esdras"], ["2-esdras", "2 Esdras"], ["tobit", "Tobit"], ["judith", "Judith"],
  ["esther-greek", "Rest of Esther"], ["wisdom-of-solomon", "Wisdom of Solomon"], ["sirach", "Ecclesiasticus"],
  ["baruch", "Baruch"], ["epistle-of-jeremiah", "Epistle of Jeremiah"], ["song-of-the-three-children", "Song of the Three Holy Children"],
  ["susanna", "History of Susanna"], ["bel-and-the-dragon", "Bel and the Dragon"], ["prayer-of-manasseh", "Prayer of Manasses"],
  ["1-maccabees", "1 Maccabees"], ["2-maccabees", "2 Maccabees"],
];
/** The books in the app's order (orderApocrypha in app/src/api/data.ts). */
export function orderBooks(books) {
  const list = books ?? [];
  const rest = list.filter((b) => b.testament !== "Apocrypha");
  const by = new Map(list.map((b) => [b.slug, b]));
  const apoc = APOCRYPHA.flatMap(([slug, name]) => { const b = by.get(slug); return b ? [{ ...b, book: name }] : []; });
  const known = new Set(APOCRYPHA.map(([s]) => s));
  return [...rest, ...apoc, ...list.filter((b) => b.testament === "Apocrypha" && !known.has(b.slug))];
}

/** Every chapter of the library in the app's order, the same list its plan walks (app/src/lib/plan.ts flatChapters). */
export function flatChapters(books) {
  const out = [];
  for (const b of orderBooks(books)) for (const c of b.chapterIds ?? Array.from({ length: b.chapters ?? 0 }, (_, i) => i + 1)) out.push({ slug: b.slug, book: b.book, chapter: c });
  return out;
}

/** The start param that opens a chapter in the app (shared/links.mjs reads it back). */
export const chapterParam = (slug, chapter) => `bible_${slug}_${chapter}`;

/**
 * What to remind: today's plan portion (its label as the Plan screen writes it), or the
 * last chapter read. Null when the reader has neither, or the plan is finished.
 */
export function portion(rec, books) {
  const all = flatChapters(books);
  if (rec.plan) {
    const per = rec.plan.perDay;
    const slice = all.slice(rec.plan.day * per, rec.plan.day * per + per);
    if (slice.length) {
      const first = slice[0], last = slice[slice.length - 1];
      const label = first.slug === last.slug ? `${first.book} ${first.chapter}${last.chapter > first.chapter ? `–${last.chapter}` : ""}` : `${first.book} ${first.chapter} – ${last.book} ${last.chapter}`;
      return { kind: "plan", day: rec.plan.day, label, slug: first.slug, chapter: first.chapter, chapters: slice.map(({ slug, chapter }) => ({ slug, chapter })), param: chapterParam(first.slug, first.chapter) };
    }
  }
  if (rec.last) {
    const hit = all.find((c) => c.slug === rec.last.slug && c.chapter === rec.last.chapter);
    if (hit) return { kind: "last", label: `${hit.book} ${hit.chapter}`, slug: hit.slug, chapter: hit.chapter, chapters: [{ slug: hit.slug, chapter: hit.chapter }], param: chapterParam(hit.slug, hit.chapter) };
  }
  return null;
}

/**
 * "Done" from either reminder: the day is done everywhere. The chapters are queued for the
 * app to mark read (it keeps the reader's progress), and the reader's place moves on: the
 * plan to its next day, or the last chapter to the one after it. Done twice the same day
 * changes nothing.
 */
export function markDone(rec, books, now = new Date()) {
  const { date } = localNow(rec.tz, now);
  if (rec.done === date) return rec;
  const next = { ...rec, done: date, pending: [...(rec.pending ?? [])] };
  const p = portion(rec, books);
  if (p?.kind === "plan") {
    next.pending.push({ day: p.day, chapters: p.chapters, date });
    next.plan = { ...rec.plan, day: rec.plan.day + 1 };
  } else if (p?.kind === "last") {
    next.pending.push({ chapters: p.chapters, date });
    const all = flatChapters(books);
    const i = all.findIndex((c) => c.slug === p.slug && c.chapter === p.chapter);
    if (i >= 0 && i + 1 < all.length) next.last = { slug: all[i + 1].slug, chapter: all[i + 1].chapter };
  }
  next.pending = next.pending.slice(-30);
  return next;
}

/** Pause from the reminder: no reminders for PAUSE_DAYS, then they resume by themselves. */
export function pause(rec, now = new Date()) {
  return { ...rec, pausedUntil: addDays(localNow(rec.tz, now).date, PAUSE_DAYS) };
}
/** Stop from the reminder: off, as if switched off in the app. */
export function stop(rec) {
  return { ...rec, on: false };
}

/**
 * A push the push service refused. A gone subscription is dropped and push is switched off;
 * when the reader also has Telegram, today's reminder goes there instead (unless Telegram
 * already had it) and the app shows the notice once. Any other failure is left to retry on
 * the next hour, inside the catch-up window.
 */
export function pushFailed(rec, status, now = new Date()) {
  if (!PUSH_GONE.has(status)) return { rec, gone: false, sendTelegram: false };
  const next = { ...rec, channels: { ...rec.channels, push: false } };
  delete next.push;
  const tg = Number.isInteger(rec.chatId);
  if (tg) { next.channels.telegram = true; next.notice = "push-fallback"; }
  if (!next.channels.telegram) next.on = false;
  const date = localNow(rec.tz, now).date;
  return { rec: next, gone: true, sendTelegram: tg && rec.sent?.telegram !== date && rec.done !== date };
}

/** Telegram refused the chat (the reader blocked the bot): Telegram is switched off. */
export function telegramGone(rec) {
  const next = { ...rec, channels: { ...rec.channels, telegram: false } };
  if (!reachable(next, "push")) next.on = false;
  return next;
}

/** The pending marks the app has applied are cleared, by the dates it confirms. */
export function ackPending(rec, dates) {
  const set = new Set((Array.isArray(dates) ? dates : []).filter((d) => typeof d === "string" && DATE.test(d)));
  return { ...rec, pending: (rec.pending ?? []).filter((p) => !set.has(p.date)) };
}

/** The KV metadata kept beside a record: what the cron filters on and the admin counts read, without opening every record. */
export function meta(rec) {
  return { o: rec.on ? 1 : 0, h: rec.hour, z: rec.tz, t: reachable(rec, "telegram") ? 1 : 0, p: reachable(rec, "push") ? 1 : 0, u: rec.pausedUntil ?? "" };
}

/** Whether the cron needs to open this record now, from its metadata alone. */
export function mayBeDue(m, now = new Date()) {
  if (!m || !m.o || !(m.t || m.p)) return false;
  const { date, hour } = localNow(m.z, now);
  if (m.u && date < m.u) return false;
  const late = hour - m.h;
  return late >= 0 && late < CATCH_UP_HOURS;
}

/** Reminder counts by channel, for the admin usage page. */
export function countByChannel(metas) {
  const out = { telegram: 0, push: 0, both: 0, paused: 0, off: 0 };
  const today = new Date().toISOString().slice(0, 10);
  for (const m of metas) {
    if (!m || !m.o || !(m.t || m.p)) { out.off++; continue; }
    if (m.u && today < m.u) out.paused++;
    if (m.t && m.p) out.both++; else if (m.t) out.telegram++; else out.push++;
  }
  return out;
}

/** What the settings screen is told: the record without the push keys or the chat id. */
export function publicView(rec) {
  return {
    on: !!rec.on, hour: rec.hour, tz: rec.tz,
    channels: { telegram: !!rec.channels?.telegram, push: !!rec.channels?.push },
    telegramLinked: Number.isInteger(rec.chatId), pushEndpoint: rec.push?.endpoint ?? null,
    pausedUntil: rec.pausedUntil ?? null, done: rec.done ?? null,
    pending: rec.pending ?? [], notice: rec.notice ?? null,
    plan: rec.plan ?? null, last: rec.last ?? null,
  };
}
