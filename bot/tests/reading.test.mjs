import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localClock, readingSummary, shiftDay, validReadingSettings } from '../../shared/reading.mjs';
const catalog = Array.from({ length: 8 }, (_, i) => ({ slug: 'genesis', book: 'Genesis', chapter: i + 1 }));
const rows = (day, chapters) => chapters.map(chapter => ({ slug: 'genesis', chapter, day }));
test('reading clock follows DST and quarter-hour timezones', () => {
  assert.equal(localClock(new Date('2026-03-08T09:00:00Z'), 'America/Los_Angeles').time, '01:00');
  assert.equal(localClock(new Date('2026-03-08T10:00:00Z'), 'America/Los_Angeles').time, '03:00');
  assert.deepEqual(localClock(new Date('2026-09-27T18:30:00Z'), 'Asia/Kathmandu'), { day: '2026-09-28', time: '00:15' });
});
test('reminder settings require explicit opt-in and a real IANA zone', () => {
  assert.ok(validReadingSettings({ enabled: false, weekly: false, time: '08:15', timezone: 'America/New_York' }));
  for (const patch of [{ enabled: 'yes' }, { time: '24:00' }, { time: '08:03' }, { timezone: 'not-a-zone' }]) assert.equal(validReadingSettings({ enabled: true, weekly: true, time: '08:00', timezone: 'UTC', ...patch }), false);
});
test('four explicit completions finish the daily goal without advancing away from it', () => {
  const s = readingSummary(catalog, rows('2026-09-27', [1, 2, 3, 4]), '2026-09-27');
  assert.equal(s.count, 4); assert.equal(s.streak, 1); assert.equal(s.chapters.length, 4); assert.ok(s.chapters.every(c => c.read));
  const next = readingSummary(catalog, rows('2026-09-27', [1, 2, 3, 4]), '2026-09-28');
  assert.deepEqual(next.chapters.map(c => c.chapter), [5, 6, 7, 8]); assert.equal(next.count, 0); assert.equal(next.streak, 1);
});
test('undo reopens the goal and missed days break streaks', () => {
  const s = readingSummary(catalog, rows('2026-09-27', [1, 2, 3]), '2026-09-27');
  assert.equal(s.count, 3); assert.equal(s.streak, 0); assert.equal(s.chapters[3].chapter, 4); assert.equal(s.chapters[3].read, false);
  assert.equal(readingSummary(catalog, rows('2026-09-25', [1, 2, 3, 4]), '2026-09-27').streak, 0);
});
test('rereading counts for the day without inflating library completion', () => {
  const s = readingSummary(catalog, [...rows('2026-09-26', [1, 2, 3, 4]), ...rows('2026-09-27', [1, 2, 3, 4])], '2026-09-27');
  assert.equal(s.count, 4); assert.equal(s.totalRead, 4); assert.equal(s.streak, 2); assert.equal(s.calendar.length, 28);
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});
