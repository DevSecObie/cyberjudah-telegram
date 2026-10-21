import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AGE, PERSISTED, merge, persistable, settle, trim } from '../src/lib/query-persist.mjs';

const q = (queryKey, dataUpdatedAt) => ({ queryKey, state: { dataUpdatedAt } });

test('only public query keys are persisted', () => {
  for (const key of [['books'], ['chapter', 'genesis', 1], ['votd', '2026-10-21'], ['recent']]) assert.equal(persistable(key), true);
  for (const key of [['me'], ['notes'], ['note-requests'], ['donations'], ['live'], ['search-ai', 'x', true], 'books', undefined]) assert.equal(persistable(key), false);
});

test('trim keeps the newest entries per prefix, drops personal and expired ones', () => {
  const now = 10 * MAX_AGE;
  const chapters = Array.from({ length: PERSISTED.chapter + 5 }, (_, i) => q(['chapter', 'genesis', i + 1], now - i));
  const kept = trim([q(['me'], now), q(['books'], now - MAX_AGE - 1), q(['books'], now - 5), q(['books'], now - 1), ...chapters], now);
  assert.deepEqual(kept.filter((k) => k.queryKey[0] === 'books').map((k) => k.state.dataUpdatedAt), [now - 1]);
  const keptChapters = kept.filter((k) => k.queryKey[0] === 'chapter');
  assert.equal(keptChapters.length, PERSISTED.chapter);
  assert.deepEqual(keptChapters[0].queryKey, ['chapter', 'genesis', 1]);
  assert.equal(kept.some((k) => k.queryKey[0] === 'me'), false);
});

test('trim drops entries without a load time', () => {
  assert.deepEqual(trim([q(['books'], undefined), q(['books'], Number.NaN)]), []);
});

test("today's verse outranks earlier days that finished loading later", () => {
  const now = 10 * MAX_AGE;
  const days = ['2026-10-21', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];
  const kept = trim(days.map((day, i) => q(['votd', day], now - 100 + i)), now).map((k) => k.queryKey[1]);
  assert.deepEqual(kept, ['2026-10-21', '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-17']);
});

test('merge keeps saved queries the cache has let go of, and the newer copy of each', () => {
  const h = (hash, at) => ({ queryHash: hash, queryKey: ['chapter', hash], state: { dataUpdatedAt: at } });
  const merged = merge([h('a', 1), h('b', 5)], [h('b', 3), h('c', 4)]);
  assert.deepEqual(merged.map((m) => [m.queryHash, m.state.dataUpdatedAt]).sort(), [['a', 1], ['b', 5], ['c', 4]]);
  assert.equal(merge([h('a', 1)], [h('a', 2)])[0].state.dataUpdatedAt, 2);
});

test('settle stores a failed refresh as its last good data, without a promise', () => {
  const s = settle({ queryHash: 'x', queryKey: ['chapter'], promise: Promise.resolve(), state: { status: 'error', error: new Error('offline'), fetchStatus: 'fetching', data: { ok: 1 }, dataUpdatedAt: 7 } });
  assert.equal('promise' in s, false);
  assert.deepEqual([s.state.status, s.state.error, s.state.fetchStatus, s.state.data, s.state.dataUpdatedAt], ['success', null, 'idle', { ok: 1 }, 7]);
});
