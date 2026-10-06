// The Sabbath, the feast days and the New Moons, kept "from even unto even" (Leviticus 23:32): no
// top-up is sold from full dark on the evening before such a day to full dark on its own evening.
// Full dark is when there is no blue left in the sky at all: the end of astronomical twilight, the
// sun 18° below the horizon. Using a balance already held is never stopped.
//
// It is worked out for the reader's own place, known only from the time zone their device reports
// (Intl.DateTimeFormat().resolvedOptions().timeZone): the zone's principal place in the tz database
// (zone-coords.json, built by bot/scripts/zone-coords.mjs). No location is ever asked for. An
// unknown zone falls back to DEFAULT_ZONE.
//
// The weekly Sabbath (the seventh day, Friday even to Saturday even) needs no data. The feast days
// and New Moons are the IUIC calendar's (israelunite.org), listed in holy-days.json: a weekly job
// (bot/scripts/holy-days.mjs, .github/workflows/holy-days.yml) proposes its updates as a pull
// request for the owner to approve.
import coords from "./zone-coords.json" with { type: "json" };
import listed from "./holy-days.json" with { type: "json" };

/** Where an unknown or missing time zone is taken to be: New York, where the church is headquartered. */
export const DEFAULT_ZONE = "America/New_York";
/** How far below the horizon the sun is when no blue is left in the sky (astronomical twilight's end). */
export const FULL_DARK_DEG = 18;

const ZONES = coords.zones;
/** The feast days and New Moons from holy-days.json: { date: "YYYY-MM-DD" (the daytime date), kind, name }. */
export const HOLY_DAYS = Array.isArray(listed.days) ? listed.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? "") && (d.kind === "feast" || d.kind === "newmoon")) : [];

const validZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
/** The reader's zone if it is a real one we know the place of; otherwise DEFAULT_ZONE. */
export const zoneOf = (tz) => (typeof tz === "string" && tz.length < 64 && ZONES[tz] && validZone(tz) ? tz : DEFAULT_ZONE);
/** The zone's principal place as [latitude, longitude] (north and east positive). */
export const coordsOf = (tz) => ZONES[zoneOf(tz)];

/** The calendar date ("YYYY-MM-DD") at this moment in this zone. */
export function localDate(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zoneOf(tz), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** The hour (0–23) at this moment in this zone. */
export const localHour = (ms, tz) => Number(new Intl.DateTimeFormat("en-US", { timeZone: zoneOf(tz), hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
const ymd = (date) => date.split("-").map(Number);
export const addDays = (date, n) => { const [y, m, d] = ymd(date); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekday = (date) => { const [y, m, d] = ymd(date); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

const RAD = Math.PI / 180;
/**
 * The sun's declination (radians) and the equation of time (minutes) at a moment, by NOAA's
 * general solar position formulas (NOAA Global Monitoring Laboratory, "General Solar Position
 * Calculations"): good to about a minute, which is all a dusk needs.
 */
function sunAt(ms) {
  const t = new Date(ms);
  const y = t.getUTCFullYear();
  const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const doy = Math.floor((ms - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const hour = t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / days) * (doy - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqtime, decl };
}

/**
 * Full dark on the evening of a local date at a place: the moment the sun goes `deg` below the
 * horizon after that day's noon, in ms since the epoch. Solar noon is 720 − 4·longitude − eqtime
 * minutes after that date's 00:00 UTC, which is the local noon of that date for any longitude,
 * so no zone offset is needed. Where the sun does not go that low that night (high latitudes in
 * summer), or never comes up that high (deep polar winter), the night's deepest darkness, solar
 * midnight, is used instead (`deepest` says so).
 */
export function fullDark(date, lat, lon, deg = FULL_DARK_DEG) {
  const [y, m, d] = ymd(date);
  const base = Date.UTC(y, m - 1, d);
  let at = base + (720 - 4 * lon) * 60000 + 6 * 3600000;
  let deepest = false;
  // Each pass takes the sun's position at the last estimate, so the estimate settles on the moment itself.
  for (let i = 0; i < 4; i++) {
    const { eqtime, decl } = sunAt(at);
    const noon = base + (720 - 4 * lon - eqtime) * 60000;
    const cosH = (Math.cos((90 + deg) * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl));
    deepest = cosH < -1 || cosH > 1;
    at = deepest ? noon + 720 * 60000 : noon + (4 * Math.acos(cosH)) / RAD * 60000;
  }
  return { at: Math.round(at), deepest };
}
/** Full dark on the evening of a local date in a zone. */
export const fullDarkIn = (date, tz) => { const [lat, lon] = coordsOf(tz); return fullDark(date, lat, lon).at; };

/** What a daytime date is: the weekly Sabbath, a listed feast day or New Moon, or nothing. */
export function holyDay(date, days = HOLY_DAYS) {
  if (weekday(date) === 6) return { kind: "sabbath", name: "Sabbath" };
  const d = days.find((x) => x.date === date);
  return d ? { kind: d.kind, name: d.name ?? (d.kind === "newmoon" ? "New Moon" : "Feast day") } : null;
}

/**
 * Whether top-ups are paused now for a reader in this zone, and until when. A holy day's pause
 * runs from full dark on the evening before it to full dark on its own evening; days that follow
 * one another (a feast day before the Sabbath) run on as one pause.
 */
export function topupPause(now, tz, days = HOLY_DAYS) {
  const zone = zoneOf(tz);
  const today = localDate(now, zone);
  for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
    const h = holyDay(date, days);
    if (!h) continue;
    const from = fullDarkIn(addDays(date, -1), zone);
    let until = fullDarkIn(date, zone);
    if (now < from || now >= until) continue;
    for (let next = addDays(date, 1); holyDay(next, days); next = addDays(next, 1)) until = fullDarkIn(next, zone);
    return { kind: h.kind, name: h.name, from, until, zone };
  }
  return null;
}

/** The day a pause ends, as the reader says it ("Saturday"), in their zone. */
export const pauseDay = (p) => new Intl.DateTimeFormat("en-US", { timeZone: p.zone, weekday: "long" }).format(new Date(p.until));
const FOR = { sabbath: "the Sabbath", feast: "the feast day", newmoon: "the New Moon" };
/** What the reader is told in place of the top-up buttons. */
export const pauseMessage = (p) => `Top-ups pause for ${FOR[p.kind] ?? "the Sabbath"} — they open again after dark on ${pauseDay(p)}`;
/** What a giver is told in place of the donation buttons: donations pause the same way top-ups do, from even unto even. */
export const givingPauseMessage = (p) => `Giving pauses for ${FOR[p.kind] ?? "the Sabbath"} — it opens again after dark on ${pauseDay(p)}`;

/**
 * Whether midday today (local) is the time to remind a reader to top up: tomorrow is a holy day
 * and today is not (on a holy day top-ups are already paused, and the reminder went the day before).
 */
export function eveOfHolyDay(now, tz, days = HOLY_DAYS) {
  const today = localDate(now, tz);
  const tomorrow = holyDay(addDays(today, 1), days);
  return tomorrow && !holyDay(today, days) ? { date: today, ...tomorrow } : null;
}
