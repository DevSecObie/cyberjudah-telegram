import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTeachings } from '../../shared/teaching-order.mjs';

const day = '2026-10-03';
const times = {
  morning: { date: day, broadcastAt: `${day}T12:56:31Z` },
  midday: { date: day, broadcastAt: `${day}T16:00:04Z` },
  afternoon: { date: day, broadcastAt: `${day}T18:58:36Z` },
  haiti: { date: day, broadcastAt: `${day}T21:56:00Z` },
};
test('newest day first, with first-to-last broadcast order inside a day', () => {
  const input = [
    { video: 'afternoon', date: day }, { video: 'haiti', date: '2026-10-04', pending: true },
    { video: 'midday', date: day }, { video: 'older', date: '2026-09-26' },
    { video: 'morning', date: day }, { video: 'newer', date: '2026-10-07' },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(orderTeachings(input, times).map(r => r.video), ['newer', 'morning', 'midday', 'afternoon', 'haiti', 'older']);
  assert.deepEqual(input, copy, 'sorting does not mutate cached queries');
});
test('unknown starts remain visible and stable without inventing upload-time order', () => {
  const input = [{ video: 'unknown-b', date: day }, { video: 'morning', date: day }, { video: 'unknown-a', date: day }, { video: 'undated', date: '' }];
  assert.deepEqual(orderTeachings(input, times).map(r => r.video), ['morning', 'unknown-b', 'unknown-a', 'undated']);
  assert.deepEqual(orderTeachings(input), input);
});
test('teacher-corrected note dates remain authoritative, and timezone offsets compare as instants', () => {
  const rows = [{ video: 'morning', date: '2026-10-02' }, { video: 'late', date: day }, { video: 'early', date: day }];
  const broadcasts = { ...times, late: { date: day, broadcastAt: '2026-10-04T00:05:00Z' }, early: { date: day, broadcastAt: '2026-10-03T17:56:00-04:00' } };
  assert.deepEqual(orderTeachings(rows, broadcasts).map(r => r.video), ['early', 'late', 'morning']);
});
test('invalid metadata cannot replace a class date or hide a class', () => {
  const rows = [{ video: 'one', date: day, pending: true }, { video: 'two', date: day }];
  assert.deepEqual(orderTeachings(rows, { one: { date: '2026-02-30', broadcastAt: 'bad' }, two: { date: day, broadcastAt: day } }), rows);
});
