import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/ask-frame.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/ask-frame.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { boundedFrame, hasSourceList, SOURCE_PREVIEW_CHARS, FRAME_BUDGET_BYTES } = await import(out);
const size = (o) => new TextEncoder().encode(JSON.stringify(o)).length;

test('sources that fit pass unchanged; long ones become previews with their length', () => {
  const short = { n: 1, title: 'Short', text: 'short text' };
  const out = boundedFrame({ done: true, answer: 'A', sources: [short, { n: 2, title: 'Long', text: 'x'.repeat(5000), excerpt: 'x'.repeat(1000) }, { n: 3, title: 'Picture', image: '/img.webp' }] });
  assert.deepEqual(out.sources[0], short);
  assert.deepEqual(out.sources[1], { n: 2, title: 'Long', text: 'x'.repeat(SOURCE_PREVIEW_CHARS), excerpt: 'x'.repeat(1000), text_chars: 5000, truncated: true });
  assert.deepEqual(out.sources[2], { n: 3, title: 'Picture', image: '/img.webp' }, 'no body fields are added');
  assert.equal(out.answer, 'A');
});

test('an excerpt is kept when the text is empty', () => {
  assert.deepEqual(boundedFrame({ sources: [{ text: '', excerpt: 'kept' }] }).sources[0], { text: '', excerpt: 'kept' });
});

test('passages and passages_delta lines are bounded too; other lines are not source lists', () => {
  assert.equal(boundedFrame({ passages: [{ n: 1, text: 'y'.repeat(50_000) }] }).passages[0].text.length, SOURCE_PREVIEW_CHARS);
  assert.equal(boundedFrame({ passages_delta: [{ n: 1, text: 'y'.repeat(50_000) }] }).passages_delta[0].text.length, SOURCE_PREVIEW_CHARS);
  for (const frame of [{ delta: 'z'.repeat(300_000) }, { ping: 1 }, { status: 'Reading' }, null, 'x']) assert.equal(hasSourceList(frame), false);
  assert.equal(hasSourceList({ done: true, sources: [] }), true);
});

test('a frame still over budget with previews shrinks them, then drops them, but keeps every source and the answer', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ n: i + 1, title: `Source ${i + 1}`, url: `/n/${i}`, text: 'w'.repeat(2000) }));
  const out = boundedFrame({ done: true, answer: 'kept', sources: many });
  assert.ok(size(out) <= FRAME_BUDGET_BYTES, `${size(out)} bytes`);
  assert.equal(out.sources.length, 300);
  assert.equal(out.answer, 'kept');
  assert.ok(out.sources.every((s) => s.text_chars === 2000 && s.truncated === true && s.url));
});
