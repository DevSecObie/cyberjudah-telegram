import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/bible/search.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { ScriptureSearchError, searchRateLimitSeconds, searchRetry, uniquePassages } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('search retries 429 once, using Retry-After and a 60-second fallback', () => {
  for (const [header, seconds] of [[null, 60], ['', 60], ['invalid', 60], ['-2', 60], ['0', 1], ['1.2', 2], ['12', 12]]) {
    const error = new ScriptureSearchError(429, header);
    assert.equal(searchRateLimitSeconds(error), seconds);
    assert.equal(searchRetry.retry(0, error), true);
    assert.equal(searchRetry.retry(1, error), false);
    assert.equal(searchRetry.retryDelay(0, error), seconds * 1000);
  }
  assert.equal(searchRateLimitSeconds(new ScriptureSearchError(429, 'Tue, 20 Oct 2026 12:00:10 GMT'), Date.parse('2026-10-20T12:00:00Z')), 10);
  for (const error of [new Error('offline'), new ScriptureSearchError(500, '1')]) {
    assert.equal(searchRateLimitSeconds(error), undefined);
    assert.equal(searchRetry.retry(0, error), false);
  }
});

test('appending a page preserves verse order and removes overlapping results', () => {
  const a = { book: 1, chapter: 1, verse: 1, text: 'first' };
  const b = { book: 1, chapter: 1, verse: 2, text: 'second' };
  const c = { book: 1, chapter: 2, verse: 1, text: 'third' };
  assert.deepEqual(uniquePassages([{ count: 3, results: [a, b] }, { count: 3, results: [{ ...b, text: 'duplicate' }, c] }]), [a, b, c]);
});
