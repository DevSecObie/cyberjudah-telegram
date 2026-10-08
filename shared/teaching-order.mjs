// @ts-check
/** @typedef {{date: string, broadcastAt: string}} Broadcast */
/** @typedef {{date: string, video?: string, pending?: boolean, broadcastAt?: string}} DatedTeaching */

/** The calendar day an instant falls on, in the given time zone (the viewer's own when omitted). */
const dayOf = (at, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

/**
 * Newest broadcast day first, then first-to-last within each day. A class with a verified broadcast start is
 * dated by the day it went live, so a note dated by its upload or its writing never moves it.
 * Within a day the earliest broadcast comes first; teachings with no verified start (the shows,
 * the history episodes, an unconfirmed recording) follow that day's broadcasts in source order.
 * Upload times (including estimated RSS fallback dates) are never used as broadcast times.
 * @template {DatedTeaching} T
 * @param {T[]} teachings
 * @param {Record<string, Broadcast>} broadcasts
 * @param {string} [timeZone] where the live day is read; the viewer's own by default
 * @returns {T[]}
 */
export function orderTeachings(teachings, broadcasts = {}, timeZone) {
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
    return aKnown && bKnown ? aTime - bTime : aKnown ? -1 : bKnown ? 1 : 0;
  });
}
