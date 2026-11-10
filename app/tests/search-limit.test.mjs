import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// #606: Search answers can now be refused with 429. The AI answer block says why instead of a generic error.
const output = await build({ entryPoints: [new URL('../src/lib/search-limit.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { searchLimitMessage, retrySeconds } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('a 429 limit says the search limit was reached, with the wait from Retry-After when sent', () => {
  assert.equal(searchLimitMessage(429, 'limit'), "You've reached today's search limit. Try again later.");
  assert.equal(searchLimitMessage(429, 'limit', null), "You've reached today's search limit. Try again later.");
  assert.equal(searchLimitMessage(429, 'limit', 'soon'), "You've reached today's search limit. Try again later.");
  assert.equal(searchLimitMessage(429, 'limit', '42'), "You've reached today's search limit. Try again in a minute.");
  assert.equal(searchLimitMessage(429, 'limit', '600'), "You've reached today's search limit. Try again in 10 minutes.");
  assert.equal(searchLimitMessage(429, 'limit', '3600'), "You've reached today's search limit. Try again in an hour.");
  assert.equal(searchLimitMessage(429, 'limit', '30000'), "You've reached today's search limit. Try again in about 9 hours.");
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(searchLimitMessage(429, 'limit', 'Tue, 10 Nov 2026 14:00:00 GMT', now), "You've reached today's search limit. Try again in about 2 hours.");
});

test('a 429 free-paused keeps the free-budget wording', () => {
  assert.equal(searchLimitMessage(429, 'free-paused', '60'), 'Free answers have reached their shared daily budget. Try again later.');
});

test('other refusals get no sentence and keep their own handling', () => {
  for (const [status, error] of [[428, 'consent'], [503, 'unavailable'], [429, undefined], [429, 'other'], [400, 'limit']]) assert.equal(searchLimitMessage(status, error, '60'), undefined, `${status} ${error}`);
});

test('Retry-After is read as seconds or an HTTP date, never below one second', () => {
  assert.equal(retrySeconds('0'), 1);
  assert.equal(retrySeconds(' 12 '), 12);
  assert.equal(retrySeconds('-2'), undefined);
  assert.equal(retrySeconds(''), undefined);
  assert.equal(retrySeconds('Tue, 10 Nov 2026 12:00:10 GMT', Date.parse('2026-11-10T12:00:00Z')), 10);
  assert.equal(retrySeconds('Tue, 10 Nov 2026 11:00:00 GMT', Date.parse('2026-11-10T12:00:00Z')), 1);
});
