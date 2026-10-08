import test from 'node:test';
import assert from 'node:assert/strict';
import { narrationStatusFrom, narrationHint } from '../src/lib/narration-logic.mjs';

test('a book with no recorded chapters at all is none, not complete: there is nothing to download, which is not the same as having downloaded everything that exists', () => {
  assert.equal(narrationStatusFrom([], new Set()), 'none');
});

test('no required file cached at all is none, not partial', () => {
  const required = ['a', 'b', 'c'];
  assert.equal(narrationStatusFrom(required, new Set()), 'none');
});

test('some but not all required files cached is partial', () => {
  const required = ['a', 'b', 'c'];
  assert.equal(narrationStatusFrom(required, new Set(['a'])), 'partial');
  assert.equal(narrationStatusFrom(required, new Set(['a', 'b'])), 'partial');
});

test('every required file cached is complete', () => {
  const required = ['a', 'b', 'c'];
  assert.equal(narrationStatusFrom(required, new Set(['a', 'b', 'c'])), 'complete');
});

test('a cache that has extra, unrelated files does not count toward this book', () => {
  const required = ['a'];
  assert.equal(narrationStatusFrom(required, new Set(['unrelated'])), 'none');
});

test('the download hint shows a size in megabytes when the catalog is readable', () => {
  assert.equal(narrationHint(12_000_000, false), '≈ 12.0 MB');
  assert.equal(narrationHint(1_500_000, false), '≈ 1.5 MB');
});

test('the download hint explains plainly when there is nothing to narrate', () => {
  assert.equal(narrationHint(0, false), 'No licensed narration for this book.');
  assert.equal(narrationHint(null, false), 'No licensed narration for this book.');
});

test('the download hint explains plainly, without a fabricated size, when the catalog fails', () => {
  const hint = narrationHint(null, true);
  assert.match(hint, /catalog is unavailable/);
  assert.doesNotMatch(hint, /MB/);
});
