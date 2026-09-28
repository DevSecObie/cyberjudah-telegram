/** Calendar arithmetic uses the reader's IANA zone, never the server's local zone. */
export function localClock(now, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function shiftDay(day, n) { return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
export function readingSummary(catalog, logs, day) {
  const key = c => `${c.slug}/${c.chapter}`;
  const read = new Set(logs.map(key));
  const today = logs.filter(c => c.day === day);
  const counts = new Map();
  for (const row of logs) counts.set(row.day, (counts.get(row.day) || 0) + 1);
  let streak = 0, cursor = (counts.get(day) || 0) >= 4 ? day : shiftDay(day, -1);
  while ((counts.get(cursor) || 0) >= 4) { streak++; cursor = shiftDay(cursor, -1); }
  const calendar = Array.from({ length: 28 }, (_, i) => { const date = shiftDay(day, i - 27); return { day: date, count: counts.get(date) || 0 }; });
  const remaining = catalog.filter(c => !read.has(key(c)));
  const todaysKeys = new Set(today.map(key));
  const chapters = [...catalog.filter(c => todaysKeys.has(key(c))).map(c => ({ ...c, read: true })), ...remaining.slice(0, Math.max(0, 4 - today.length)).map(c => ({ ...c, read: false }))];
  return { day, chapters, count: today.length, totalRead: read.size, total: catalog.length, streak, calendar, completed: [...read], finished: remaining.length === 0 };
}
export function validReadingSettings(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean' || typeof value.weekly !== 'boolean') return false;
  if (typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(value.time)) return false;
  if (typeof value.timezone !== 'string' || value.timezone.length > 80) return false;
  try { localClock(new Date(), value.timezone); return true; } catch { return false; }
}
