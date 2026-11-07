// The daily verse's subscription: what POST /api/subscribe accepts, and whether a subscriber's
// local hour is now. A time zone name (IANA, "America/Chicago") is kept when the app sends one,
// so the hour stays right across daylight saving; the older offset in minutes (tz) still works
// for apps that send only that. Anything sent that isn't valid is a 400, never quietly a default.
import type { Sub } from "./env";

export const DEFAULT_HOUR = 8;
const MAX_OFFSET = 14 * 60;

const zoneChecks = new Map<string, boolean>();
/** The zone as sent when Intl knows it as a time zone ("America/Chicago", "Asia/Kolkata"), or null.
 *  Kept as sent: Intl's own spelling can be an older name ("Asia/Calcutta"). Each answer is kept,
 *  since the hourly send asks for every subscriber. (shared/holy-days.mjs zoneOf is not reused:
 *  it accepts only its own short list of zones and falls back to a default.) */
export function validZone(v: unknown): string | null {
  if (typeof v !== "string" || v.length < 1 || v.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(v)) return null;
  let ok = zoneChecks.get(v);
  if (ok === undefined) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: v }); ok = true; } catch { ok = false; }
    if (zoneChecks.size < 1000) zoneChecks.set(v, ok);
  }
  return ok ? v : null;
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
  const hour = b.hour === undefined ? DEFAULT_HOUR : b.hour;
  if (!(typeof hour === "number" && Number.isInteger(hour) && hour >= 0 && hour <= 23)) return { ok: false, error: "bad-hour" };
  const tz = b.tz === undefined ? 0 : b.tz;
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
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }); hours.set(zone, f); }
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
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }); days.set(zone, f); }
  const p = Object.fromEntries(f.formatToParts(when).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Is it the subscriber's chosen hour where they are. */
export const isDueHour = (sub: Pick<Sub, "tz" | "zone" | "hour">, when: Date) => subscriberHour(sub, when) === sub.hour;

/** Is the verse due for this subscriber now: their chosen hour where they are, and not already sent
 *  on this local date (`sent`, from sentKeyOf; the night clocks fall back, an hour happens twice). */
export const isDue = (sub: Pick<Sub, "tz" | "zone" | "hour">, when: Date, sent?: string | null) => isDueHour(sub, when) && sent !== subscriberDate(sub, when);

/** Where the local date the verse was last sent is kept: its own key beside the subscription
 *  ("sub:<pid>" -> "sent:<pid>"), so the hourly send never rewrites the subscription itself (a
 *  rewrite could bring back one the person had just turned off). It expires on its own. */
export const sentKeyOf = (subKey: string) => `sent:${subKey.replace(/^sub:/, "")}`;
export const SENT_TTL = 2 * 86400;
