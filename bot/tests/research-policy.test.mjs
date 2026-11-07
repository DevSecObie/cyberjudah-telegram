import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminBudgetPool, researchRounds, researchSignal } from '../src/research-policy.mjs';

test('research rounds have a hard ceiling even with no monetary budget', () => {
  assert.equal(researchRounds(10000), 25);
  assert.equal(researchRounds(Infinity), 25);
  assert.equal(researchRounds(3.8), 3);
  assert.equal(researchRounds(-1), 1);
});

test('research stops before a call on a past deadline or an already disconnected request', () => {
  assert.throws(() => researchSignal(undefined, Date.now() - 1).throwIfAborted(), { name: 'TimeoutError' });
  const controller = new AbortController(); controller.abort();
  assert.equal(researchSignal(controller.signal).aborted, true);
});

test('admin daily pool is isolated, bounded and fails closed on invalid settings', () => {
  assert.deepEqual(adminBudgetPool({}), { prefix: 'admin:', capUsd: 10 });
  assert.equal(adminBudgetPool({ ASK_ADMIN_DAILY_USD_CAP: '0' }).capUsd, 0);
  assert.throws(() => adminBudgetPool({ ASK_ADMIN_DAILY_USD_CAP: 'bad' }));
  assert.throws(() => adminBudgetPool({ ASK_ADMIN_DAILY_USD_CAP: '-1' }));
});
