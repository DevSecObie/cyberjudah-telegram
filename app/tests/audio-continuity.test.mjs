import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentChapter, bindMediaSession } from '../src/lib/audio-continuity.mjs';
import { AudioIntent } from '../src/lib/audio-intent.mjs';

const books = [{ slug: 'first', chapterIds: [1, 3] }, { slug: 'last', chapterIds: [2] }];
test('chapter continuity uses catalog order and actual chapter IDs, stopping at both ends', () => {
  assert.deepEqual(adjacentChapter(books, { slug: 'first', chapter: 1 }, 1), { slug: 'first', chapter: 3 });
  assert.deepEqual(adjacentChapter(books, { slug: 'first', chapter: 3 }, 1), { slug: 'last', chapter: 2 });
  assert.deepEqual(adjacentChapter(books, { slug: 'last', chapter: 2 }, -1), { slug: 'first', chapter: 3 });
  assert.equal(adjacentChapter(books, { slug: 'last', chapter: 2 }, 1), null);
  assert.equal(adjacentChapter(books, { slug: 'first', chapter: 1 }, -1), null);
  assert.equal(adjacentChapter(books, { slug: 'missing', chapter: 1 }, 1), null);
});
test('stop and replacement cancel deferred chapter loads even when they resolve out of order', async () => {
  const intent = new AudioIntent();
  const accepted = [];
  const deferred = (chapter) => {
    const generation = intent.start();
    let resolve;
    const task = new Promise((done) => { resolve = done; }).then(() => {
      if (intent.canPlay(generation)) accepted.push(chapter);
    });
    return { resolve, task };
  };
  const first = deferred('first'), second = deferred('second');
  second.resolve(); await second.task;
  first.resolve(); await first.task;
  assert.deepEqual(accepted, ['second']);
  const stopped = deferred('stopped'); intent.stop();
  stopped.resolve(); await stopped.task;
  assert.deepEqual(accepted, ['second']);
});
test('media session owns supported handlers and removes them on disposal', () => {
  const installed = new Map(); let plays = 0;
  const session = { playbackState: 'playing', metadata: {}, setActionHandler(action, fn) {
    if (action === 'previoustrack') throw new Error('unsupported');
    installed.set(action, fn);
  } };
  const dispose = bindMediaSession(session, { play: () => plays++, stop: () => {}, previoustrack: () => {} });
  installed.get('play')(); assert.equal(plays, 1);
  dispose(); assert.equal(installed.get('play'), null); assert.equal(installed.get('stop'), null);
  assert.equal(session.playbackState, 'none'); assert.equal(session.metadata, null);
  bindMediaSession(undefined, {})();
});
