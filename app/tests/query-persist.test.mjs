import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AGE, PERSISTED, persistable, trim } from '../src/lib/query-persist.mjs';

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
