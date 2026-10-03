import { Hono, type Context } from "hono";
import { GrammyError, InlineKeyboard } from "grammy";
import type { Env } from "./env";
import { validateInitData } from "./initdata.mjs";
import { books, escapeHtml } from "./data";
import { openButton } from "./bot";
import { CHUNK, SENDS_PER_SECOND, SLOT_TTL, sleep } from "./daily";
import { tellAdmins } from "./health";
import { telegramApi } from "./telegram-api";
import {
  ackPending, applyContent, applySettings, blank, countByChannel, dueChannels, localNow, markDone, markSent, mayBeDue, meta,
  addPush, claim, release, pause, portion, telegramBack, publicView, pushOutcome, removePush, stop, telegramGone, validTz, PAUSE_CHOICES,
  type Meta, type Portion, type Reminder,
} from "./reminders.mjs";
import { sendPush, validSubscription, type VapidKeys } from "./webpush.mjs";
import { clientIp, deviceOf, forgetDevice, issueDevice, overLimit, randomHex, repointDevice, sha256, IDLE_TTL } from "./device";
import { open, pid, seal } from "./privacy.mjs";

/**
 * Reading reminders (rules in reminders.mjs). One record per reader in the SUBS namespace:
 *
 *   remind:tg:<user id>   a reader known through Telegram (the private chat id is the user id)
 *   remind:dev:<id>       a browser that has not been linked to Telegram (push only)
 *   remdev:<id>           a browser's credential: the hash of its secret, and the record it uses
 *   pushep:<hash>         a push subscription's record, so the service worker can ask by endpoint
 *                         (a reader has up to PUSH_DEVICES subscriptions, one per browser)
 *   remlink:<code>        a one-time code (15 minutes) that links a browser to the bot's chat
 *
 * Each record carries its on/hour/zone/channels as KV metadata, so the hourly run lists them
 * without opening every one and the admin page counts them the same way.
 */

const PREFIX = "remind:";
const recKey = (rid: string) => `${PREFIX}${rid}`;
/** A Telegram reader's reminder is filed under their pseudonymous ID (privacy.mjs); the chat ID the bot sends to is kept inside the record. */
export const tgRid = async (env: Pick<Env, "PRIVACY_KEY" | "BOT_TOKEN">, uid: number) => `tg:${await pid(env, uid)}`;
const LINK_TTL = 15 * 60;

/** Records are sealed at rest (privacy.mjs); only the listing metadata the cron filters on (meta) stays readable. */
export async function loadReminder(env: Env, rid: string): Promise<Reminder | null> {
  return open<Reminder>(env, recKey(rid), await env.SUBS.get(recKey(rid)));
}
export async function saveReminder(env: Env, rid: string, rec: Reminder): Promise<void> {
  // A reader known through Telegram keeps their record; an unlinked browser's expires when unused.
  await env.SUBS.put(recKey(rid), await seal(env, recKey(rid), rec), { metadata: meta(rec), ...(rid.startsWith("dev:") ? { expirationTtl: IDLE_TTL } : {}) });
}
const putIndex = async (env: Env, endpoint: string, rid: string) => env.SUBS.put(`pushep:${await sha256(endpoint)}`, rid, { expirationTtl: IDLE_TTL });

/**
 * Abuse protection (OWASP API4): every reminder call is rate limited per caller, by the
 * Workers Rate Limiting binding. The key is the caller's identity (Telegram user, browser
 * credential, push endpoint); only making a new credential, which has none yet, is keyed
 * by address. The binding counts per Cloudflare location, so it bounds abuse rather than
 * counting exactly. Without the binding (a local run), nothing is limited.
 */
const tooMany = (c: Context<{ Bindings: Env }>) => c.json({ ok: false, error: "rate-limited" }, 429, { "retry-after": "60" });

/** A push subscription the Worker will post to: a browser push service, or in tests the loopback one (PUSH_TEST_ORIGIN). */
const pushable = (env: Env, sub: unknown) => validSubscription(sub, env.PUSH_TEST_ORIGIN);

export function vapidKeys(env: Env): VapidKeys | null {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null;
}

type Who = { kind: "telegram"; uid: number; rid: string } | { kind: "device"; dev: string; rid: string };

/** Who is asking, resolved once per request (the rate limiter and the route both need it). */
const asked = new WeakMap<Request, Promise<Who | null>>();
function who(c: Context<{ Bindings: Env }>): Promise<Who | null> {
  let w = asked.get(c.req.raw);
  if (!w) { w = resolveWho(c); asked.set(c.req.raw, w); }
  return w;
}
/** Telegram launch data (as the rest of the API), else a browser's device credential. */
async function resolveWho(c: Context<{ Bindings: Env }>): Promise<Who | null> {
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  if (m) {
    const data = await validateInitData(m[1], c.env.BOT_TOKEN, 30 * 86400);
    return data?.user ? { kind: "telegram", uid: data.user.id, rid: await tgRid(c.env, data.user.id) } : null;
  }
  const d = await deviceOf(c.env, c.req.header("x-cj-device"));
  return d ? { kind: "device", ...d } : null;
}

/** Today's reminder in Telegram: the reading, and Open / Done / Pause / Stop. Never verse text. */
function telegramMessage(p: Portion) {
  return p.kind === "plan" ? `<b>Today's reading</b>\nDay ${(p.day ?? 0) + 1} of your plan: ${escapeHtml(p.label)}` : `<b>Continue where you left off</b>\n${escapeHtml(p.label)}`;
}
function telegramKeyboard(env: Env, p: Portion, done = false): InlineKeyboard {
  const kb = openButton(env, env.WORKER_URL, "private", p.param, "Open");
  if (done) return kb;
  return kb.text("Done", "rd:done").row().text("Pause…", "rd:pause").text("Stop", "rd:stop");
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
  try { await telegramApi(env).editMessageText(rec.chatId!, rec.tgMessage.id, `${telegramMessage(before)}\n\n✓ Done`, { parse_mode: "HTML", reply_markup: telegramKeyboard(env, before, true) }); }
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

/** A browser's push subscription added to a record, with its index; a device past the limit is let go. */
async function addPushTo(env: Env, rid: string, rec: Reminder, sub: unknown): Promise<Reminder> {
  if (!pushable(env, sub)) return rec;
  const { rec: next, dropped } = addPush(rec, sub);
  await putIndex(env, sub.endpoint, rid);
  for (const e of dropped) await env.SUBS.delete(`pushep:${await sha256(e)}`);
  return next;
}
/** One browser's subscription removed from a record, with its index. */
async function removePushFrom(env: Env, rec: Reminder, endpoint: string): Promise<Reminder> {
  await env.SUBS.delete(`pushep:${await sha256(endpoint)}`);
  return removePush(rec, endpoint);
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
  const rid = await tgRid(env, uid);
  const mine = cred.rid !== rid ? await loadReminder(env, cred.rid) : null;
  const theirs = await loadReminder(env, rid);
  let rec: Reminder = { ...(theirs?.on ? theirs : mine ?? theirs ?? blank()), chatId: uid };
  if (mine) {
    rec.channels = { telegram: rec.channels.telegram || mine.channels.telegram, push: rec.channels.push || mine.channels.push };
    for (const sub of mine.pushes ?? []) rec = await addPushTo(env, rid, rec, sub);
    await env.SUBS.delete(recKey(cred.rid));
  }
  await saveReminder(env, rid, rec);
  await repointDevice(env, dev, rid);
  return true;
}

const PAUSE_LABEL: Record<string, string> = { 1: "Paused until tomorrow.", 7: "Paused for a week.", forever: "Paused until you resume it." };

/** /stop in the bot's chat: reading reminders off, from the chat itself. */
export async function stopFor(env: Env, uid: number): Promise<boolean> {
  const rec = await loadReminder(env, await tgRid(env, uid));
  if (!rec?.on) return false;
  await saveReminder(env, await tgRid(env, uid), stop(rec));
  return true;
}
/** The reader started the bot again after blocking it: Telegram reminders resume as they were. */
export async function telegramReturned(env: Env, uid: number): Promise<void> {
  const rec = await loadReminder(env, await tgRid(env, uid));
  if (rec?.tgBlocked) await saveReminder(env, await tgRid(env, uid), telegramBack(rec));
}

/** The bot's Done / Pause / Stop buttons under a reminder. Pause asks how long first. */
export async function reminderButton(env: Env, uid: number, action: "done" | "pause" | "stop", until?: number | "forever"): Promise<string> {
  const rid = await tgRid(env, uid);
  if (action === "done") return (await doneFor(env, rid)) ? "Marked done." : "This reminder is no longer on.";
  const rec = await loadReminder(env, rid);
  if (!rec) return "This reminder is no longer on.";
  if (action === "stop") { await saveReminder(env, rid, stop(rec)); return "Reminders are off. Turn them on again in Settings."; }
  const n = until === "forever" || PAUSE_CHOICES.includes(until ?? 0) ? until! : 7;
  await saveReminder(env, rid, pause(rec, new Date(), n));
  return `${PAUSE_LABEL[String(n)]} Resume it in Settings.`;
}
/** The buttons under today's reminder: the usual row, or the pause lengths to choose from. */
export async function reminderKeyboard(env: Env, uid: number, choosing: boolean): Promise<InlineKeyboard | null> {
  const rec = await loadReminder(env, await tgRid(env, uid));
  const p = rec ? portion(rec, (await books(env)) ?? []) : null;
  if (!p) return null;
  if (!choosing) return telegramKeyboard(env, p);
  return openButton(env, env.WORKER_URL, "private", p.param, "Open").row()
    .text("Until tomorrow", "rd:pause:1").text("A week", "rd:pause:7").text("Until I resume", "rd:pause:0").row()
    .text("Cancel", "rd:back");
}

let botUsername: string | undefined;
async function botLink(env: Env, start: string) {
  botUsername ??= (await telegramApi(env).getMe()).username;
  return `https://t.me/${botUsername}?start=${start}`;
}

export const reminders = new Hono<{ Bindings: Env }>();
// Every call is limited by who makes it (a new browser, by address, in the PUT below).
reminders.use("*", async (c, next) => {
  const w = await who(c);
  if (w && (await overLimit(c.env, `${w.kind}:${w.kind === "telegram" ? w.uid : w.dev}`))) return tooMany(c);
  await next();
});

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
  const body = await c.req.json<{ settings?: unknown; content?: unknown; push?: unknown; pushRemove?: unknown; notice?: boolean }>().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad-json" }, 400);
  if (body.push !== undefined && !pushable(c.env, body.push)) return c.json({ ok: false, error: "bad-subscription" }, 400);
  let w = await who(c);
  let device: string | undefined;
  if (!w) {
    if (c.req.header("authorization") || c.req.header("x-cj-device")) return c.json({ ok: false, error: "unauthorized" }, 401);
    // A new credential, limited per address (device.ts).
    const made = await issueDevice(c.env, clientIp(c));
    if (!made.ok) return tooMany(c);
    w = { kind: "device", ...made.device };
    device = made.credential;
  }
  const now = new Date();
  let rec = (await loadReminder(c.env, w.rid)) ?? blank();
  if (w.kind === "telegram") rec.chatId = w.uid;
  rec = applySettings(rec, body.settings, now);
  rec = applyContent(rec, body.content);
  if (body.push !== undefined) rec = await addPushTo(c.env, w.rid, rec, body.push);
  if (typeof body.pushRemove === "string" && body.pushRemove.length <= 1024) rec = await removePushFrom(c.env, rec, body.pushRemove);
  if (body.notice === false) delete rec.notice;
  // A new browser that has chosen nothing yet gets its credential only: no record for the hourly run to list.
  if (!(device && !rec.on && !rec.pushes?.length)) await saveReminder(c.env, w.rid, rec);
  return c.json(view(c.env, rec, { identity: w.kind, linked: w.rid.startsWith("tg:"), ...(device ? { device } : {}) }));
});

/** Delete my data: the Telegram reader's reminder and every push subscription it holds. */
export async function forgetReminder(env: Env, uid: number): Promise<boolean> {
  const rid = await tgRid(env, uid);
  const rec = await loadReminder(env, rid);
  if (!rec) return false;
  for (const p of rec.pushes ?? []) await env.SUBS.delete(`pushep:${await sha256(p.endpoint)}`);
  await env.SUBS.delete(recKey(rid));
  return true;
}

/**
 * Forget: a browser forgets itself (its credential, its push subscription, and its record
 * if it was never linked); a Telegram reader deletes their reminder and every subscription.
 */
reminders.delete("/", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => null);
  const rec = await loadReminder(c.env, w.rid);
  const forgetAll = w.kind === "telegram" || w.rid.startsWith("dev:");
  if (rec && forgetAll) {
    for (const p of rec.pushes ?? []) await c.env.SUBS.delete(`pushep:${await sha256(p.endpoint)}`);
    await c.env.SUBS.delete(recKey(w.rid));
  } else if (rec && typeof body?.endpoint === "string" && body.endpoint.length <= 1024) {
    await saveReminder(c.env, w.rid, await removePushFrom(c.env, rec, body.endpoint));
  }
  if (w.kind === "device") await forgetDevice(c.env, w.dev);
  return c.json({ ok: true });
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
/** The service worker's calls are limited per endpoint (by address when none is given). */
push.use("/*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  const body = await c.req.raw.clone().json<{ endpoint?: unknown; old?: unknown }>().catch(() => null);
  const ep = typeof body?.endpoint === "string" ? body.endpoint : typeof body?.old === "string" ? body.old : "";
  if (await overLimit(c.env, ep ? `ep:${await sha256(ep)}` : `ip:${clientIp(c)}`)) return tooMany(c);
  await next();
});
async function byEndpoint(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => null);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return null;
  return c.env.SUBS.get(`pushep:${await sha256(body.endpoint)}`);
}
/**
 * The browser replaced a subscription (the service worker's pushsubscriptionchange): the
 * old endpoint, which only that browser knows, is swapped for the new one on the same record.
 */
push.post("/renew", async (c) => {
  const body = await c.req.json<{ old?: unknown; sub?: unknown }>().catch(() => null);
  if (typeof body?.old !== "string" || body.old.length > 1024 || !pushable(c.env, body.sub)) return c.json({ ok: false }, 400);
  const rid = await c.env.SUBS.get(`pushep:${await sha256(body.old)}`);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  if (!rid || !rec) return c.json({ ok: false }, 404);
  const next = await addPushTo(c.env, rid, await removePushFrom(c.env, rec, body.old), body.sub);
  await saveReminder(c.env, rid, next);
  return c.json({ ok: true });
});
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
  await saveReminder(c.env, rid, pause(rec, new Date(), 7));
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

/**
 * The push services refused our VAPID signature (401/403): the keys are wrong or were
 * changed. No subscription is dropped for it; the admins are told, once a day.
 */
async function alertPushKeys(env: Env, now: Date) {
  const key = `remind-alert:vapid:${now.toISOString().slice(0, 10)}`;
  if (await env.SUBS.get(key)) return;
  await env.SUBS.put(key, "1", { expirationTtl: 2 * 86400 });
  console.error(JSON.stringify({ event: "reminders_vapid_refused" }));
  await tellAdmins(env, "Reading reminders: push services refused our VAPID signature (401/403). Check the VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT secrets. No subscriptions were dropped; push is retried on each run.").catch(() => undefined);
}

type Counts = { telegram: number; push: number; fallback: number; failed: number };
/** One checkpoint per quarter-hour run. */
const QUARTER = 15 * 60000;
const slotKey = (when: Date) => { const t = new Date(Math.floor(when.getTime() / QUARTER) * QUARTER); return `remind-slot:${t.toISOString().slice(0, 16)}`; };

/**
 * The quarter-hourly run, built like the daily verse's (daily.ts): paced under Telegram's
 * broadcast limit, 429s retried after the server's backoff, progress checkpointed per run so
 * an interrupted run resumes, and the previous run, if unfinished, finished first. Each
 * channel's sent day is saved on the record, so a resumed or repeated run never sends twice.
 */
export async function sendReminders(env: Env, now = new Date()): Promise<Counts> {
  const out: Counts = { telegram: 0, push: 0, fallback: 0, failed: 0 };
  const list = (await books(env)) ?? [];
  if (!list.length) { console.error(JSON.stringify({ event: "reminders_no_books" })); return out; }
  for (const t of [new Date(now.getTime() - QUARTER), now]) await runSlot(env, slotKey(t), now, list, out);
  return out;
}

async function runSlot(env: Env, key: string, now: Date, list: NonNullable<Awaited<ReturnType<typeof books>>>, out: Counts) {
  const saved = (await env.SUBS.get(key, "json")) as { cursor?: string; done?: boolean } | null;
  if (saved?.done) return;
  const api = telegramApi(env);
  const keys = vapidKeys(env);
  const slot: Counts = { telegram: 0, push: 0, fallback: 0, failed: 0 };
  let misconfigured = false;

  /** Telegram, for a reminder already claimed: a refused chat switches Telegram off; any other failure gives the claim back to retry on the next run. */
  const toTelegram = async (r: Reminder, p: Portion, before: Reminder): Promise<Reminder> => {
    try {
      const msg = await withBackoff(() => api.sendMessage(r.chatId!, telegramMessage(p), { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: telegramKeyboard(env, p) }));
      slot.telegram++;
      return { ...r, tgMessage: { date: localNow(r.tz, now).date, id: msg.message_id } };
    } catch (e) {
      if (e instanceof GrammyError && e.error_code === 403) return telegramGone(r);
      slot.failed++;
      console.error(JSON.stringify({ event: "reminder_telegram_failed", code: e instanceof GrammyError ? e.error_code : 0 }));
      return release(r, "telegram", before);
    }
  };
  const one = async (name: string) => {
    const rid = name.slice(PREFIX.length);
    const rec = await open<Reminder>(env, name, await env.SUBS.get(name));
    const due = dueChannels(rec, now);
    if (!rec || !due.length) return;
    const p = portion(rec, list);
    // Nothing read yet and no plan: there is nothing to remind of, and nothing is made up.
    if (!p) return;
    // At most once: the day is claimed for these channels before anything is sent.
    let r = claim(rec, due, now);
    await saveReminder(env, rid, r);
    try {
      if (due.includes("push") && keys) {
        // Every browser the reader turned push on in; one delivery counts for the day.
        const subs = r.pushes ?? [];
        const results = await Promise.all(subs.map(async (sub) => ({ endpoint: sub.endpoint, status: await sendPush(sub, keys, { testOrigin: env.PUSH_TEST_ORIGIN }).catch(() => 0) })));
        // The claim is given back first; pushOutcome marks the day sent again if any browser took it.
        const f = pushOutcome(release(r, "push", rec), results, now);
        for (const e of f.gone) await env.SUBS.delete(`pushep:${await sha256(e)}`);
        // Each browser reached keeps its index for another 180 days (refreshed once a day).
        const today = localNow(r.tz, now).date;
        for (const sub of subs) if (results.find((x) => x.endpoint === sub.endpoint && x.status >= 200 && x.status < 300) && sub.seen !== today) await putIndex(env, sub.endpoint, rid);
        if (f.misconfigured) misconfigured = true;
        r = f.rec;
        if (f.sent) slot.push++;
        else if (f.sendTelegram && !due.includes("telegram")) { r = await toTelegram(claim(r, ["telegram"], now), p, rec); slot.fallback++; }
        else if (!f.gone.length || r.pushes?.length) slot.failed++;
      } else if (due.includes("push")) r = release(r, "push", rec);
      if (due.includes("telegram")) r = await toTelegram(r, p, rec);
    } finally {
      await saveReminder(env, rid, r);
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
    if (misconfigured) await alertPushKeys(env, now);
    out.telegram += slot.telegram; out.push += slot.push; out.fallback += slot.fallback; out.failed += slot.failed;
    console.log(JSON.stringify({ event: "reminders", slot: key, ...slot }));
  }
}
