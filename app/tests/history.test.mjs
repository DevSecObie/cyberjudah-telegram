import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/history.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { getHistoryItemKey, normalizeHistory, pushHistory, historyHref, MAX_HISTORY_BYTES, MAX_HISTORY_ITEMS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const bible = (chapter = 1, at = 1) => ({ slug: 'genesis', chapter, name: `Genesis ${chapter}`, at });
test('Nave has its own identity and encoded article route without replacing class-topic history', () => {
  const rows = normalizeHistory([{ type: 'nave', slug: "aaron's rod", name: "Aaron's rod", at: 3 }, { type: 'topic', slug: 'aaron', name: 'Aaron', at: 2 }]);
  assert.equal(rows.length, 2);
  assert.equal(getHistoryItemKey(rows[0]), "nave:aaron's rod");
  assert.equal(historyHref(rows[0]), "/nave/en/aaron's%20rod");
  assert.equal(historyHref(rows[1]), '/topics/aaron');
});
test('legacy Bible records default to Bible, deduplicate by verse and keep chapter-at-verse routes', () => {
  const rows = normalizeHistory([bible(1, 2), { ...bible(1, 8), verse: 1 }, { ...bible(1, 6), verse: 2 }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'bible');
  assert.equal(rows[0].at, 8);
  assert.equal(historyHref(rows[0]), '/read/genesis/1');
  assert.equal(historyHref(rows[1]), '/read/genesis/1?at=2');
  const next = pushHistory(rows, { slug: 'genesis', chapter: 1, name: 'Genesis 1', verse: 2 });
  assert.equal(next[0].verse, 2);
  assert.equal(next.length, 2);
});
test('all kinds share one flat ordering and canonical identities', () => {
  const h = normalizeHistory([
    bible(1, 10),
    { type: 'strong', reference: 'h0001', name: 'ab', original: 'אָב', at: 20 },
    { type: 'strong', reference: 'H1', name: 'ab', at: 30 },
    { type: 'dictionary', slug: 'faith', name: 'Faith', resourceId: 'easton', entryId: 1, at: 40 },
    { type: 'dictionary', slug: 'faith', name: 'Faith', resourceId: 'other', entryId: 1, at: 50 },
    { type: 'topic', slug: 'faith', name: 'Faith', at: 60 },
  ]);
  assert.deepEqual(h.map(r => r.at), [60, 50, 40, 30, 10]);
  assert.equal(historyHref(h[0]), '/topics/faith');
  assert.equal(historyHref(h[2]), '/dictionary/faith');
  assert.equal(historyHref(h[3]), '/lexicon/H1');
  assert.notEqual(getHistoryItemKey(h[1]), getHistoryItemKey(h[2]));
  const next = pushHistory(h, { type: 'strong', reference: 'H0001', name: 'father' });
  assert.equal(next[0].reference, 'H1');
  assert.equal(next.length, h.length);
});
test('normalization rejects corrupt rows and strips unknown fields', () => {
  assert.deepEqual(normalizeHistory({}), []);
  assert.deepEqual(normalizeHistory([null, false, {}, { ...bible(), chapter: 0 }, { ...bible(), verse: -1 }, { ...bible(), type: 'unknown' }, { ...bible(), slug: '../secret' }, { ...bible(), at: Infinity }, { type: 'strong', reference: 'H0', name: 'bad', at: 1 }]), []);
  assert.deepEqual(normalizeHistory([{ ...bible(), accidental: 'data' }])[0], { type: 'bible', slug: 'genesis', chapter: 1, verse: 1, name: 'Genesis 1', at: 1 });
});
test('writes respect both the count cap and the actual UTF-8 CloudStorage byte limit', () => {
  const compact = normalizeHistory(Array.from({ length: 90 }, (_, i) => ({ type: 'topic', slug: `t${i}`, name: 'T', at: i + 1 })));
  assert.equal(compact.length, MAX_HISTORY_ITEMS);
  assert.equal(compact[0].at, 90);
  const multilingual = normalizeHistory(Array.from({ length: 70 }, (_, i) => ({ type: 'strong', reference: `H${i + 1}`, name: '🕊אָב'.repeat(1000), original: 'λόγος'.repeat(1000), at: i + 1 })));
  assert.ok(multilingual.length > 0 && multilingual.length < 50);
  assert.ok(Buffer.byteLength(JSON.stringify(multilingual), 'utf8') <= MAX_HISTORY_BYTES);
  assert.equal(multilingual[0].reference, 'H70');
  assert.ok(!/\uD83D$/.test(multilingual[0].name));
});
