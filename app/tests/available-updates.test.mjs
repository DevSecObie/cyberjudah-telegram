import test from 'node:test';
import assert from 'node:assert/strict';
import { getAvailableUpdates, hasUnseenUpdates, markUpdatesSeen } from '../src/resources/available-updates.mjs';

// After Bible Strong's availableUpdates-test.
const installed = [{ id: 'strongs', manifest: { release: 'r1' } }, { id: 'easton', manifest: { release: 'e1' } }];
const catalog = { resources: [{ id: 'strongs', release: 'r2' }, { id: 'easton', release: 'e1' }, { id: 'nave', release: 'n1' }] };

test('an installed resource needs an update when the catalog lists another release; others do not count', () => {
  assert.deepEqual([...getAvailableUpdates(installed, catalog)], [['strongs', 'r2']]);
  assert.deepEqual([...getAvailableUpdates(installed, null)], []);
  assert.deepEqual([...getAvailableUpdates([], catalog)], []);
});

test('an update seen once stops counting, and a later release of it counts again', () => {
  const updates = getAvailableUpdates(installed, catalog);
  assert.equal(hasUnseenUpdates(updates, {}), true);
  const seen = markUpdatesSeen(updates, {});
  assert.deepEqual(seen, { strongs: 'r2' });
  assert.equal(hasUnseenUpdates(updates, seen), false);
  assert.equal(markUpdatesSeen(updates, seen), seen);
  const later = getAvailableUpdates(installed, { resources: [{ id: 'strongs', release: 'r3' }] });
  assert.equal(hasUnseenUpdates(later, seen), true);
});
