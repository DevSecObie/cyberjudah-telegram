import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/ask-frame.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/ask-frame.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { boundedFrame, SOURCE_PREVIEW_CHARS, FRAME_BUDGET_BYTES } = await import(out);
const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;

test('short sources pass unchanged apart from their length; long ones become previews', () => {
  const out = boundedFrame({ done: true, answer: 'A', sources: [{ n: 1, title: 'Short', text: 'short text' }, { n: 2, title: 'Long', text: 'x'.repeat(5000), excerpt: 'x'.repeat(1000) }] });
  assert.deepEqual(out.sources[0], { n: 1, title: 'Short', text: 'short text', excerpt: 'short text', text_chars: 10 });
  assert.equal(out.sources[1].text.length, SOURCE_PREVIEW_CHARS);
  assert.equal(out.sources[1].text_chars, 5000);
  assert.equal(out.sources[1].truncated, true);
  assert.equal(out.answer, 'A');
});

test('the passages line is bounded too, and lines without sources are untouched', () => {
  const out = boundedFrame({ passages: [{ n: 1, text: 'y'.repeat(50_000) }] });
  assert.equal(out.passages[0].text.length, SOURCE_PREVIEW_CHARS);
  const delta = { delta: 'z'.repeat(300_000) };
  assert.deepEqual(boundedFrame(delta), delta, 'an answer delta is never cut');
  assert.deepEqual(boundedFrame({ ping: 1 }), { ping: 1 });
});

test('a frame still over budget with previews shrinks them, then drops them, but keeps every source and the answer', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ n: i + 1, title: `Source ${i + 1}`, url: `/n/${i}`, text: 'w'.repeat(2000) }));
  const out = boundedFrame({ done: true, answer: 'kept', sources: many });
  assert.ok(size(out) <= FRAME_BUDGET_BYTES, `${size(out)} bytes`);
  assert.equal(out.sources.length, 300);
  assert.equal(out.answer, 'kept');
  assert.ok(out.sources.every((s) => s.text_chars === 2000 && s.truncated === true));
});
