import { Hono, type Context } from "hono";
import { Api, GrammyError, InlineKeyboard } from "grammy";
import type { Env } from "./env";
import { validateInitData } from "./initdata.mjs";
import { books, escapeHtml } from "./data";
import { openButton } from "./bot";
import { CHUNK, SENDS_PER_SECOND, SLOT_TTL, sleep } from "./daily";
import {
  ackPending, applyContent, applySettings, blank, countByChannel, dueChannels, localNow, markDone, markSent, mayBeDue, meta,
  pause, portion, publicView, pushFailed, stop, telegramGone, validTz,
  type Meta, type Portion, type Reminder,
} from "./reminders.mjs";
import { b64u, sendPush, validSubscription, type VapidKeys } from "./webpush.mjs";

/**
 * Reading reminders (rules in reminders.mjs). One record per reader in the SUBS namespace:
 *
 *   remind:tg:<user id>   a reader known through Telegram (the private chat id is the user id)
 *   remind:dev:<id>       a browser that has not been linked to Telegram (push only)
 *   remdev:<id>           a browser's credential: the hash of its secret, and the record it uses
 *   pushep:<hash>         a push subscription's record, so the service worker can ask by endpoint
 *   remlink:<code>        a one-time code (15 minutes) that links a browser to the bot's chat
 *
 * Each record carries its on/hour/zone/channels as KV metadata, so the hourly run lists them
 * without opening every one and the admin page counts them the same way.
 */

const PREFIX = "remind:";
const recKey = (rid: string) => `${PREFIX}${rid}`;
const LINK_TTL = 15 * 60;

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomHex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function loadReminder(env: Env, rid: string): Promise<Reminder | null> {
  return env.SUBS.get<Reminder>(recKey(rid), "json");
}
export async function saveReminder(env: Env, rid: string, rec: Reminder): Promise<void> {
  await env.SUBS.put(recKey(rid), JSON.stringify(rec), { metadata: meta(rec) });
}

export function vapidKeys(env: Env): VapidKeys | null {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null;
}

type Who = { kind: "telegram"; uid: number; rid: string } | { kind: "device"; dev: string; rid: string };

/** Who is asking: Telegram launch data (as the rest of the API), else a browser's device credential. */
async function who(c: Context<{ Bindings: Env }>): Promise<Who | null> {
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  if (m) {
    const data = await validateInitData(m[1], c.env.BOT_TOKEN, 30 * 86400);
    return data?.user ? { kind: "telegram", uid: data.user.id, rid: `tg:${data.user.id}` } : null;
  }
  const d = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(c.req.header("x-cj-device") ?? "");
  if (!d) return null;
  const saved = await c.env.SUBS.get<{ h: string; rid: string }>(`remdev:${d[1]}`, "json");
  if (!saved || saved.h !== (await sha256(d[2]))) return null;
  return { kind: "device", dev: d[1], rid: saved.rid };
}

/** Today's reminder in Telegram: the reading, and Open / Done / Pause / Stop. Never verse text. */
function telegramMessage(p: Portion) {
  return p.kind === "plan" ? `<b>Today's reading</b>\nDay ${(p.day ?? 0) + 1} of your plan: ${escapeHtml(p.label)}` : `<b>Continue where you left off</b>\n${escapeHtml(p.label)}`;
}
function telegramKeyboard(env: Env, p: Portion, done = false): InlineKeyboard {
  const kb = openButton(env, env.WORKER_URL, "private", p.param, "Open");
  if (done) return kb;
  return kb.text("Done", "rd:done").row().text("Pause for a week", "rd:pause").text("Stop", "rd:stop");
}

/** A Telegram send, retried once after the server's own backoff on 429. */
async function withBackoff<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    if (!(e instanceof GrammyError && e.error_code === 429)) throw e;
    await sleep(Math.min(60, Number((e as { parameters?: { retry_after?: number } }).parameters?.retry_after ?? 1)) * 1000);
    return f();
  }
}

/** The Telegram reminder of the day, when it was sent, is marked done in place. */
async function markTelegramDone(env: Env, rec: Reminder, before: Portion | null) {
  if (!before || !rec.tgMessage || !Number.isInteger(rec.chatId) || rec.tgMessage.date !== rec.done) return;
  try { await new Api(env.BOT_TOKEN).editMessageText(rec.chatId!, rec.tgMessage.id, `${telegramMessage(before)}\n\n✓ Done`, { parse_mode: "HTML", reply_markup: telegramKeyboard(env, before, true) }); }
  catch { /* already edited, or deleted by the reader */ }
}

/** Done from anywhere: the day is done on every channel, and the Telegram message says so. */
export async function doneFor(env: Env, rid: string, now = new Date()): Promise<Reminder | null> {
  const rec = await loadReminder(env, rid);
  if (!rec) return null;
  const list = (await books(env)) ?? [];
  const before = portion(rec, list);
  const next = markDone(rec, list, now);
  if (next === rec) return rec;
  await saveReminder(env, rid, next);
  await markTelegramDone(env, next, before);
  return next;
}

/** Remember a push subscription for a record (and forget the one it replaces). */
async function setPush(env: Env, rid: string, rec: Reminder, sub: unknown): Promise<Reminder> {
  const next = { ...rec };
  if (rec.push) await env.SUBS.delete(`pushep:${await sha256(rec.push.endpoint)}`);
  if (sub === null) { delete next.push; return next; }
  if (!validSubscription(sub)) return next;
  next.push = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  await env.SUBS.put(`pushep:${await sha256(sub.endpoint)}`, rid);
  return next;
}

/**
 * The bot's /start remind_<code>: the browser that made the code is linked to this chat. Its
 * push subscription and choices move onto the reader's Telegram record, which both now use.
 */
export async function linkDevice(env: Env, code: string, uid: number): Promise<boolean> {
  if (!/^[0-9a-f]{32}$/.test(code)) return false;
  const dev = await env.SUBS.get(`remlink:${code}`);
  if (!dev) return false;
  await env.SUBS.delete(`remlink:${code}`);
  const cred = await env.SUBS.get<{ h: string; rid: string }>(`remdev:${dev}`, "json");
  if (!cred) return false;
  const rid = `tg:${uid}`;
  const mine = cred.rid !== rid ? await loadReminder(env, cred.rid) : null;
  const theirs = await loadReminder(env, rid);
  let rec: Reminder = { ...(theirs?.on ? theirs : mine ?? theirs ?? blank()), chatId: uid };
  if (mine) {
    rec.channels = { telegram: rec.channels.telegram || mine.channels.telegram, push: rec.channels.push || mine.channels.push };
    if (mine.push) rec = await setPush(env, rid, rec, mine.push);
    await env.SUBS.delete(recKey(cred.rid));
  }
  await saveReminder(env, rid, rec);
  await env.SUBS.put(`remdev:${dev}`, JSON.stringify({ h: cred.h, rid }));
  return true;
}

/** The bot's Done / Pause / Stop buttons under a reminder. */
export async function reminderButton(env: Env, uid: number, action: "done" | "pause" | "stop"): Promise<string> {
  const rid = `tg:${uid}`;
  if (action === "done") return (await doneFor(env, rid)) ? "Marked done." : "This reminder is no longer on.";
  const rec = await loadReminder(env, rid);
  if (!rec) return "This reminder is no longer on.";
  await saveReminder(env, rid, action === "pause" ? pause(rec) : stop(rec));
  return action === "pause" ? "Paused for a week. Resume it in Settings." : "Reminders are off. Turn them on again in Settings.";
}

let botUsername: string | undefined;
async function botLink(env: Env, start: string) {
  botUsername ??= (await new Api(env.BOT_TOKEN).getMe()).username;
  return `https://t.me/${botUsername}?start=${start}`;
}

export const reminders = new Hono<{ Bindings: Env }>();

const view = (env: Env, rec: Reminder, extra: Record<string, unknown> = {}) => ({ ok: true, ...publicView(rec), publicKey: vapidKeys(env)?.publicKey ?? null, ...extra });

reminders.get("/", async (c) => {
  const w = await who(c);
  const tz = c.req.query("tz") ?? "UTC";
  if (!w) return c.json(view(c.env, blank(validTz(tz) ? tz : "UTC"), { identity: "none" }));
  const rec = (await loadReminder(c.env, w.rid)) ?? { ...blank(validTz(tz) ? tz : "UTC"), ...(w.kind === "telegram" ? { chatId: w.uid } : {}) };
  return c.json(view(c.env, rec, { identity: w.kind, linked: w.rid.startsWith("tg:") }));
});

/** Settings, the reader's place, and the push subscription, from the settings screen. A browser without a credential is given one. */
reminders.put("/", async (c) => {
  const body = await c.req.json<{ settings?: unknown; content?: unknown; push?: unknown; notice?: boolean }>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad-json" }, 400);
  if (body.push !== undefined && body.push !== null && !validSubscription(body.push)) return c.json({ ok: false, error: "bad-subscription" }, 400);
  let w = await who(c);
  let device: string | undefined;
  if (!w) {
    if (c.req.header("authorization") || c.req.header("x-cj-device")) return c.json({ ok: false, error: "unauthorized" }, 401);
    const id = randomHex(16), secret = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await c.env.SUBS.put(`remdev:${id}`, JSON.stringify({ h: await sha256(secret), rid: `dev:${id}` }));
    w = { kind: "device", dev: id, rid: `dev:${id}` };
    device = `${id}.${secret}`;
  }
  const now = new Date();
  let rec = (await loadReminder(c.env, w.rid)) ?? blank();
  if (w.kind === "telegram") rec.chatId = w.uid;
  rec = applySettings(rec, body.settings, now);
  rec = applyContent(rec, body.content);
  if (body.push !== undefined) rec = await setPush(c.env, w.rid, rec, body.push);
  if (body.notice === false) delete rec.notice;
  // A new browser that has chosen nothing yet gets its credential only: no record for the hourly run to list.
  if (!(device && !rec.on && !rec.push)) await saveReminder(c.env, w.rid, rec);
  return c.json(view(c.env, rec, { identity: w.kind, linked: w.rid.startsWith("tg:"), ...(device ? { device } : {}) }));
});

reminders.post("/done", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const rec = await doneFor(c.env, w.rid);
  return rec ? c.json(view(c.env, rec)) : c.json({ ok: false, error: "not-found" }, 404);
});

/** The app has marked these Done days read: they are cleared. */
reminders.post("/ack", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json<{ dates?: unknown }>().catch(() => null);
  const rec = await loadReminder(c.env, w.rid);
  if (!rec) return c.json({ ok: true });
  const next = ackPending(rec, body?.dates);
  await saveReminder(c.env, w.rid, next);
  return c.json(view(c.env, next));
});

/** A browser asks to be linked to the bot's chat: a one-time /start link. */
reminders.post("/link", async (c) => {
  const w = await who(c);
  if (!w || w.kind !== "device") return c.json({ ok: false, error: "unauthorized" }, 401);
  const code = randomHex(16);
  await c.env.SUBS.put(`remlink:${code}`, w.dev, { expirationTtl: LINK_TTL });
  try { return c.json({ ok: true, link: await botLink(c.env, `remind_${code}`) }); }
  catch { return c.json({ ok: false, error: "unavailable" }, 503); }
});

/** The service worker's calls: it knows only its own subscription's endpoint. */
export const push = new Hono<{ Bindings: Env }>();
push.get("/key", (c) => c.json({ publicKey: vapidKeys(c.env)?.publicKey ?? null }));
async function byEndpoint(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => null);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return null;
  return c.env.SUBS.get(`pushep:${await sha256(body.endpoint)}`);
}
push.post("/today", async (c) => {
  const rid = await byEndpoint(c);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  const p = rec ? portion(rec, (await books(c.env)) ?? []) : null;
  if (!rec || !p) return c.json({ ok: false }, 404);
  const done = rec.done === localNow(rec.tz).date;
  return c.json({ ok: true, done, title: p.kind === "plan" ? "Today's reading" : "Continue where you left off", body: p.kind === "plan" ? `Day ${(p.day ?? 0) + 1} of your plan: ${p.label}` : p.label, param: p.param });
});
push.post("/done", async (c) => {
  const rid = await byEndpoint(c);
  if (!rid || !(await doneFor(c.env, rid))) return c.json({ ok: false }, 404);
  return c.json({ ok: true });
});
push.post("/pause", async (c) => {
  const rid = await byEndpoint(c);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  if (!rid || !rec) return c.json({ ok: false }, 404);
  await saveReminder(c.env, rid, pause(rec));
  return c.json({ ok: true });
});

/** Reminder counts by channel, for the admin usage page. */
export async function reminderCounts(env: Env) {
  const metas: (Meta | null)[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SUBS.list<Meta>({ prefix: PREFIX, cursor });
    for (const k of page.keys) metas.push(k.metadata ?? null);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return countByChannel(metas);
}

type Counts = { telegram: number; push: number; fallback: number; failed: number };
const slotKey = (when: Date) => `remind-slot:${when.toISOString().slice(0, 10)}:${String(when.getUTCHours()).padStart(2, "0")}`;

/**
 * The hourly run, built like the daily verse's (daily.ts): paced under Telegram's broadcast
 * limit, 429s retried after the server's backoff, progress checkpointed per hour so an
 * interrupted run resumes, and the previous hour's unfinished run finished first. Each
 * channel's sent day is saved on the record, so a resumed or repeated run never sends twice.
 */
export async function sendReminders(env: Env, now = new Date()): Promise<Counts> {
  const out: Counts = { telegram: 0, push: 0, fallback: 0, failed: 0 };
  const list = (await books(env)) ?? [];
  if (!list.length) { console.error(JSON.stringify({ event: "reminders_no_books" })); return out; }
  for (const t of [new Date(now.getTime() - 3600000), now]) await runSlot(env, slotKey(t), now, list, out);
  return out;
}

async function runSlot(env: Env, key: string, now: Date, list: NonNullable<Awaited<ReturnType<typeof books>>>, out: Counts) {
  const saved = (await env.SUBS.get(key, "json")) as { cursor?: string; done?: boolean } | null;
  if (saved?.done) return;
  const api = new Api(env.BOT_TOKEN);
  const keys = vapidKeys(env);
  const slot: Counts = { telegram: 0, push: 0, fallback: 0, failed: 0 };

  const toTelegram = async (rec: Reminder, p: Portion): Promise<Reminder> => {
    try {
      const msg = await withBackoff(() => api.sendMessage(rec.chatId!, telegramMessage(p), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: telegramKeyboard(env, p) }));
      slot.telegram++;
      return { ...markSent(rec, "telegram", now), tgMessage: { date: localNow(rec.tz, now).date, id: msg.message_id } };
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) return telegramGone(rec);
      throw e;
    }
  };
  const one = async (name: string) => {
    const rec = await env.SUBS.get<Reminder>(name, "json");
    const due = dueChannels(rec, now);
    if (!rec || !due.length) return;
    const p = portion(rec, list);
    // Nothing read yet and no plan: there is nothing to remind of, and nothing is made up.
    if (!p) return;
    let r = rec;
    try {
      if (due.includes("push") && keys) {
        const status = await sendPush(r.push!, keys).catch(() => 0);
        if (status >= 200 && status < 300) { r = markSent(r, "push", now); slot.push++; }
        else {
          const f = pushFailed(r, status, now);
          if (f.gone) await env.SUBS.delete(`pushep:${await sha256(r.push!.endpoint)}`);
          r = f.rec;
          if (f.sendTelegram && !due.includes("telegram")) { r = await toTelegram(r, p); slot.fallback++; }
          else if (!f.gone) slot.failed++;
        }
      }
      if (due.includes("telegram")) r = await toTelegram(r, p);
    } finally {
      if (r !== rec) await saveReminder(env, name.slice(PREFIX.length), r);
    }
  };

  let cursor: string | undefined = saved?.cursor;
  try {
    do {
      const page = await env.SUBS.list<Meta>({ prefix: PREFIX, cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      const due = page.keys.filter((k) => mayBeDue(k.metadata, now));
      for (let i = 0; i < due.length; i += CHUNK) {
        const chunk = due.slice(i, i + CHUNK);
        const t0 = Date.now();
        const results = await Promise.allSettled(chunk.map(({ name }) => one(name)));
        for (const r of results) if (r.status === "rejected") slot.failed++;
        const budget = (chunk.length / SENDS_PER_SECOND) * 1000;
        const elapsed = Date.now() - t0;
        if (elapsed < budget) await sleep(budget - elapsed);
      }
      if (cursor) await env.SUBS.put(key, JSON.stringify({ cursor, done: false }), { expirationTtl: SLOT_TTL });
    } while (cursor);
    await env.SUBS.put(key, JSON.stringify({ ...slot, done: true }), { expirationTtl: SLOT_TTL });
  } finally {
    out.telegram += slot.telegram; out.push += slot.push; out.fallback += slot.fallback; out.failed += slot.failed;
    console.log(JSON.stringify({ event: "reminders", slot: key, ...slot }));
  }
}
