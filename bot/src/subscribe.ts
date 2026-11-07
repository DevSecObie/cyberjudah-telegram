// The daily verse's subscription: what POST /api/subscribe accepts, and whether a subscriber's
// local hour is now. A time zone name (IANA, "America/Chicago") is kept when the app sends one,
// so the hour stays right across daylight saving; the older offset in minutes (tz) still works
// for apps that send only that. Anything sent that isn't valid is a 400, never quietly a default.
import type { Env, Sub } from "./env";

export const DEFAULT_HOUR = 8;
const MAX_OFFSET = 14 * 60;

const zoneChecks = new Map<string, true>();
/** A formatter per zone, bounded like the zone checks. */
const keep = (cache: Map<string, Intl.DateTimeFormat>, zone: string, f: Intl.DateTimeFormat) => { if (cache.size >= 1000) cache.clear(); cache.set(zone, f); return f; };
/** The zone as sent when Intl knows it as a time zone ("America/Chicago", "Asia/Kolkata"), or null.
 *  Kept as sent: Intl's own spelling can be an older name ("Asia/Calcutta"). Each answer is kept,
 *  since the hourly send asks for every subscriber. (shared/holy-days.mjs zoneOf is not reused:
 *  it accepts only its own short list of zones and falls back to a default.) */
export function validZone(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(v)) return null;
  if (zoneChecks.has(v)) return v;
  try { new Intl.DateTimeFormat("en-US", { timeZone: v }); } catch { return null; }
  // Only zones Intl accepts are kept (a refused name is never cached), and the cache is bounded.
  if (zoneChecks.size >= 1000) zoneChecks.clear();
  zoneChecks.set(v, true);
  return v;
}

export type SubscribeInput =
  | { ok: true; on: false }
  | { ok: true; on: true; hour: number; tz: number; zone?: string }
  | { ok: false; error: "bad-json" | "bad-on" | "bad-hour" | "bad-tz" | "bad-zone" };

/** The request body, checked: on (boolean), hour (0–23, default 8), tz (minutes east of UTC, ±840,
 *  default 0), zone (IANA, optional). A field that's there must be valid. */
export function parseSubscribe(body: unknown): SubscribeInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "bad-json" };
  const b = body as Record<string, unknown>;
  if (b.on !== undefined && typeof b.on !== "boolean") return { ok: false, error: "bad-on" };
  if (!b.on) return { ok: true, on: false };
  // Absent or null: the default, as before. A value that's there must be valid.
  const hour = b.hour === undefined || b.hour === null ? DEFAULT_HOUR : b.hour;
  if (!(typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23)) return { ok: false, error: "bad-hour" };
  const tz = b.tz === undefined || b.tz === null ? 0 : b.tz;
  if (!(typeof tz === "number" && Number.isInteger(tz) && Math.abs(tz) <= MAX_OFFSET)) return { ok: false, error: "bad-tz" };
  if (b.zone === undefined || b.zone === null) return { ok: true, on: true, hour, tz };
  const zone = validZone(b.zone);
  if (!zone) return { ok: false, error: "bad-zone" };
  return { ok: true, on: true, hour, tz, zone };
}

/** The hour of the day for a UTC hour at an offset in minutes (half-hour zones round down). */
export const offsetHour = (utcHour: number, tz: number) => Math.floor((((utcHour * 60 + tz) % 1440) + 1440) % 1440 / 60);

const hours = new Map<string, Intl.DateTimeFormat>();
/** The hour of the day (0-23) at this moment in a zone. Some runtimes ignore hourCycle "h23" and
 *  give midnight as 24, so the hour is taken from its own part and kept under 24. */
export function zoneHour(when: Date, zone: string): number {
  let f = hours.get(zone);
  if (!f) f = keep(hours, zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }));
  return Number(f.formatToParts(when).find((p) => p.type === "hour")?.value) % 24;
}

/** The subscriber's local hour at this moment: from their zone when they have a valid one, else
 *  from their fixed offset. */
export function subscriberHour(sub: Pick<Sub, "tz" | "zone">, when: Date): number {
  const zone = sub.zone ? validZone(sub.zone) : null;
  return zone ? zoneHour(when, zone) : offsetHour(when.getUTCHours(), sub.tz);
}

const days = new Map<string, Intl.DateTimeFormat>();
/** The subscriber's local date ("YYYY-MM-DD") at this moment: in their zone, else at their offset. */
export function subscriberDate(sub: Pick<Sub, "tz" | "zone">, when: Date): string {
  const zone = sub.zone ? validZone(sub.zone) : null;
  if (!zone) return new Date(when.getTime() + sub.tz * 60000).toISOString().slice(0, 10);
  let f = days.get(zone);
  if (!f) f = keep(days, zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }));
  const p = Object.fromEntries(f.formatToParts(when).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Is it the subscriber's chosen hour where they are. The night clocks spring forward, a chosen
 *  hour that doesn't exist that day is due at the first hour after it. */
export function isDueHour(sub: Pick<Sub, "tz" | "zone" | "hour">, when: Date): boolean {
  const hour = subscriberHour(sub, when);
  if (hour === sub.hour) return true;
  // Only an hour or two past the chosen one can follow a skipped hour; the rest need no second look.
  const past = (hour - sub.hour + 24) % 24;
  if (past < 1 || past > 2) return false;
  const before = subscriberHour(sub, new Date(when.getTime() - 3_600_000));
  // An hour ago it was `before`; more than one hour on means the hours between were skipped.
  const gap = (hour - before + 24) % 24;
  for (let k = 1; k < gap; k++) if ((before + k) % 24 === sub.hour) return true;
  return false;
}

/** Is the verse due for this subscriber now: their chosen hour where they are, and not already sent
 *  on this local date (`sent`, from sentKeyOf; the night clocks fall back, an hour happens twice). */
export const isDue = (sub: Pick<Sub, "tz" | "zone" | "hour">, when: Date, sent?: string | null) => isDueHour(sub, when) && sent !== subscriberDate(sub, when);

/** Where the local date the verse was last sent is kept: its own key beside the subscription
 *  ("sub:<pid>" -> "sent:<pid>"), so the hourly send never rewrites the subscription itself (a
 *  rewrite could bring back one the person had just turned off). It expires on its own. */
export function sentKeyOf(subKey: string): string | null {
  const id = subKey.replace(/^sub:/, "");
  // A subscription not yet moved to its pseudonymous key (privacy-migrate) is keyed by the raw
  // Telegram ID: no sent key is made from it, so that ID never appears in a new key.
  return /^\d+$/.test(id) ? null : `sent:${id}`;
}
export const SENT_TTL = 2 * 86400;

/** Deletes a subscription and the date its verse last went out: every path that ends one uses this. */
export async function deleteSub(env: Pick<Env, "SUBS">, subKey: string): Promise<void> {
  await env.SUBS.delete(subKey);
  const sent = sentKeyOf(subKey);
  if (sent) await env.SUBS.delete(sent);
}
