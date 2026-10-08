import test from 'node:test';
import assert from 'node:assert/strict';
import { orderTeachings } from '../../shared/teaching-order.mjs';

const day = '2026-10-03';
const NY = 'America/New_York';
const times = {
  morning: { date: day, broadcastAt: `${day}T12:56:31Z` },
  midday: { date: day, broadcastAt: `${day}T16:00:04Z` },
  afternoon: { date: day, broadcastAt: `${day}T18:58:36Z` },
  haiti: { date: day, broadcastAt: `${day}T21:56:00Z` },
};
test('newest broadcast day first, then first-to-last inside each day', () => {
  const input = [
    { video: 'afternoon', date: day }, { video: 'haiti', date: '2026-10-04', pending: true },
    { video: 'midday', date: day }, { video: 'older', date: '2026-09-26' },
    { video: 'morning', date: day }, { video: 'newer', date: '2026-10-07' },
  ];
  const copy = structuredClone(input);
  assert.deepEqual(orderTeachings(input, times, NY).map(r => r.video), ['newer', 'morning', 'midday', 'afternoon', 'haiti', 'older']);
  assert.deepEqual(input, copy, 'sorting does not mutate cached queries');
});
test('a class is dated by the day it went live, not the day its notes carry', () => {
  // A note dated a week after its stream, and an evening stream past UTC midnight.
  const rows = [{ video: 'late-note', date: '2026-08-22' }, { video: 'evening', date: '2026-07-01' }, { video: 'next', date: '2026-08-22' }];
  const broadcasts = {
    'late-note': { date: '2026-08-22', broadcastAt: '2026-08-15T19:00:33Z' },
    evening: { date: '2026-06-30', broadcastAt: '2026-07-01T00:18:56Z' },
    next: { date: '2026-08-22', broadcastAt: '2026-08-22T12:55:23Z' },
  };
  const out = orderTeachings(rows, broadcasts, NY);
  assert.deepEqual(out.map(r => [r.video, r.date]), [['next', '2026-08-22'], ['late-note', '2026-08-15'], ['evening', '2026-06-30']]);
});
test('unknown starts follow the day\'s broadcasts, stable, without inventing upload-time order', () => {
  const input = [{ video: 'unknown-b', date: day }, { video: 'morning', date: day }, { video: 'unknown-a', date: day }, { video: 'undated', date: '' }];
  assert.deepEqual(orderTeachings(input, times, NY).map(r => r.video), ['morning', 'unknown-b', 'unknown-a', 'undated']);
  assert.deepEqual(orderTeachings(input), input);
});
test('timezone offsets compare as instants', () => {
  const rows = [{ video: 'early', date: day }, { video: 'late', date: day }];
  const broadcasts = { late: { date: day, broadcastAt: '2026-10-03T23:05:00Z' }, early: { date: day, broadcastAt: '2026-10-03T17:56:00-04:00' } };
  assert.deepEqual(orderTeachings(rows, broadcasts, NY).map(r => r.video), ['early', 'late']);
});
test('invalid metadata cannot replace a class date or hide a class', () => {
  const rows = [{ video: 'one', date: day, pending: true }, { video: 'two', date: day }];
  assert.deepEqual(orderTeachings(rows, { one: { date: '2026-02-30', broadcastAt: 'bad' }, two: { date: day, broadcastAt: day } }), rows);
});
