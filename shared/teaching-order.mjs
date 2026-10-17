// @ts-check
/** @typedef {{date: string, broadcastAt: string}} Broadcast */
/** @typedef {{date: string, video?: string, pending?: boolean, broadcastAt?: string}} DatedTeaching */

/** The calendar day an instant falls on, in the given time zone (the viewer's own when omitted). */
const dayOf = (at, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/**
 * In the order the classes went live, newest first. A class with a verified broadcast start is
 * dated by the day it went live, so a note dated by its upload or its writing never moves it.
 * Within a day the latest broadcast comes first; teachings with no verified start (the shows,
 * the history episodes, an unconfirmed recording) follow that day's broadcasts.
 * When a same-day teaching has no verified start, the channel feed's own order decides
 * where it can: the channel lists a day's classes in the order they were taught, while the
 * notes files carry no within-day order at all. Feed-listed teachings come first in feed
 * order, the rest follow in source order. That listing order is all the feed gives; the
 * upload timestamps on it are never read as broadcast times.
 * Upload times (including estimated RSS fallback dates) are never used as broadcast times.
 * @template {DatedTeaching} T
 * @param {T[]} teachings
 * @param {Record<string, Broadcast>} broadcasts
 * @param {string} [timeZone] where the live day is read; the viewer's own by default
 * @param {string[]} [feedOrder] the channel feed's video ids, in the feed's own order
 * @returns {T[]}
 */
export function orderTeachings(teachings, broadcasts = {}, timeZone, feedOrder) {
  const feedAt = new Map((feedOrder ?? []).map((video, at) => [video, at]));
  const rows = teachings.map((row) => {
    const broadcast = row.video ? broadcasts[row.video] : undefined;
    const at = broadcast?.broadcastAt;
    if (!at || !/^\d{4}-\d{2}-\d{2}T/.test(at) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) return { ...row };
    return { ...row, broadcastAt: at, date: dayOf(at, timeZone) };
  });
  return rows.sort((a, b) => {
    const day = (b.date || '').localeCompare(a.date || '');
    if (day) return day;
    const aTime = Date.parse(a.broadcastAt || ''), bTime = Date.parse(b.broadcastAt || '');
    const aKnown = Number.isFinite(aTime), bKnown = Number.isFinite(bTime);
    if (aKnown || bKnown) return aKnown && bKnown ? bTime - aTime : aKnown ? -1 : 1;
    const aFeed = a.video ? feedAt.get(a.video) : undefined, bFeed = b.video ? feedAt.get(b.video) : undefined;
    if (aFeed === undefined || bFeed === undefined) return aFeed === bFeed ? 0 : aFeed !== undefined ? -1 : 1;
    return aFeed - bFeed;
  });
}
