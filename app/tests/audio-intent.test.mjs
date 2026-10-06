import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioIntent, audioRate } from '../src/lib/audio-intent.mjs';

test('a recording resolved after pause remains owned but cannot autoplay until resumed', async () => {
  const intent = new AudioIntent();
  const generation = intent.start();
  let resolve;
  const source = new Promise((done) => { resolve = done; });
  const start = source.then(() => intent.canPlay(generation));
  intent.paused = true;
  resolve();
  assert.equal(await start, false);
  assert.equal(intent.owns(generation), true);
  intent.paused = false;
  assert.equal(intent.canPlay(generation), true);
});

test('stop and replacement playback reject late work from previous generations', () => {
  const intent = new AudioIntent();
  const old = intent.start();
  intent.stop();
  assert.equal(intent.canPlay(old), false);
  const replacement = intent.start();
  assert.equal(intent.owns(old), false);
  assert.equal(intent.canPlay(replacement), true);
  intent.paused = true;
  const next = intent.start();
  assert.equal(intent.canPlay(next), true);
  assert.equal(intent.canPlay(replacement), false);
});

test('saved speed and pitch accept supported values and safely default corrupted storage', () => {
  for (const value of [null, undefined, '', 'NaN', 'Infinity', '0', '-1', '4', '{}']) assert.equal(audioRate(value), 1);
  for (const value of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) assert.equal(audioRate(String(value)), value);
});
