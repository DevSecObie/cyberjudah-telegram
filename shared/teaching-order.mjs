// @ts-check
/** @typedef {{date: string, broadcastAt: string}} Broadcast */
/** @typedef {{date: string, video?: string, pending?: boolean, broadcastAt?: string}} DatedTeaching */

/**
 * Newest teaching day first, then actual broadcast starts from first to last.
 * Unknown starts follow verified starts, retaining their source order. Upload times
 * (including estimated RSS fallback dates) are never used as broadcast times.
 * @template {DatedTeaching} T
 * @param {T[]} teachings
 * @param {Record<string, Broadcast>} broadcasts
 * @returns {T[]}
 */
export function orderTeachings(teachings, broadcasts = {}) {
  const rows = teachings.map((row) => {
    const broadcast = row.video ? broadcasts[row.video] : undefined;
    const at = broadcast?.broadcastAt;
    if (!at || !/^\d{4}-\d{2}-\d{2}T/.test(at) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) return { ...row };
    const day = broadcast.date;
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
    return { ...row, broadcastAt: at, date: row.pending && validDay ? day : row.date };
  });
  return rows.sort((a, b) => {
    const day = (b.date || '').localeCompare(a.date || '');
    if (day) return day;
    const aTime = Date.parse(a.broadcastAt || ''), bTime = Date.parse(b.broadcastAt || '');
    const aKnown = Number.isFinite(aTime), bKnown = Number.isFinite(bTime);
    return aKnown && bKnown ? aTime - bTime : aKnown ? -1 : bKnown ? 1 : 0;
  });
}
