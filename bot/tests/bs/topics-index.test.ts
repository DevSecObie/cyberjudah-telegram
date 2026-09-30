import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicIndex } from '../../scripts/build-bs-topics-index.mjs';
import { BOOKS } from '../../src/bs/core.ts';

const manifest = { commit: 'test-source', built: '2026-09-30' };
const rows = [{ slug: 'faith', label: 'Faith' }, { slug: 'history', label: 'History' }];
const topics = {
  faith: { ...rows[0], thread: [{ url: '/bible/genesis/1#v1', verses: '1,3–5;5' }, { url: '/bible/genesis/1#v3', verses: '3' }] },
  history: { ...rows[1], thread: [{ url: '/bible/genesis/1', verses: '' }, { url: '/bible/2-maccabees/1#v1', verses: '1-2' }] },
};
const build = (values = topics, order = rows) => buildTopicIndex({ rows: order, books: BOOKS, manifest, readTopic: async (slug: keyof typeof topics) => values[slug] });

test('topic index preserves gaps, deduplicates overlapping ranges, and separates chapter associations across all 81 books', async () => {
  const index = await build();
  assert.deepEqual(index.verses, { '1-1-1': [0], '1-1-3': [0], '1-1-4': [0], '1-1-5': [0], '81-1-1': [1], '81-1-2': [1] });
  assert.deepEqual(index.chapters, { '1-1': [1] });
  assert.deepEqual(index.topics, [{ normalizedName: 'faith', name: 'Faith' }, { normalizedName: 'history', name: 'History' }]);
  assert.equal(index.sourceCommit, manifest.commit);
  assert.deepEqual(await build(topics, [...rows].reverse()), index);
  const reordered = structuredClone(topics); reordered.faith.thread.reverse();
  assert.equal((await build(reordered)).revision, index.revision);
  const changed = structuredClone(topics); changed.faith.thread[0].verses = '1-5';
  assert.notEqual((await build(changed)).revision, index.revision);
});

test('topic index generation fails on missing data or malformed references instead of publishing partial associations', async () => {
  await assert.rejects(buildTopicIndex({ rows, books: BOOKS, manifest, readTopic: async () => { throw new Error('missing topic'); } }), /missing topic/);
  for (const patch of [{ url: '/bible/unknown/1' }, { verses: '3-1' }, { verses: '1,unknown' }]) {
    const changed = structuredClone(topics);
    Object.assign(changed.faith.thread[0], patch);
    await assert.rejects(build(changed), /Invalid topic/);
  }
  await assert.rejects(build(topics, [...rows, rows[0]]), /duplicate topic/);
});
