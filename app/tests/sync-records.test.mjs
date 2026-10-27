import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/sync-records.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/sync/records.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { readerRecords, readerEntries, readerValue, deviceRecords } = await import(out);
test('English Nave tag records retain their identity through personal-data conversion', async () => {
  const key = `bs_nv_${'a'.repeat(64)}`;
  const value = { normalizedName: 'aaron', name: 'Aaron', date: 123, tags: { study: true } };
  const rows = await readerRecords({ [key]: JSON.stringify(value) });
  assert.ok(rows.length);
  assert.ok(rows.every(row => row.collection === 'tags' && row.data.key === key));
  assert.deepEqual(JSON.parse(readerValue(key, Object.fromEntries(rows.map(row => [row.data.entry, row.data.value])))), value);
});
test('reader values retain their shape and deterministic identity across both source passes', async () => {
  const values = { bs_h_genesis_1: JSON.stringify({ 1: { color: 'color3', date: 123, tags: { creation: true } } }), bs_n_genesis_1: JSON.stringify({ '1/2': { id: 'old-note', title: 'Saved', description: 'Unchanged words', date: 456 } }), bs_bm: JSON.stringify([{ id: 'a', name: 'Creation', book: 'genesis', chapter: 1, date: 1 }]), hl: JSON.stringify({ 'john/3': '16:y' }), rel_genesis_1: JSON.stringify([{ id: 'z', endpoints: [] }, { id: 'a', endpoints: [] }]), palette: 'night' };
  const original = JSON.stringify(values), cloud = await readerRecords(values);
  const device = await deviceRecords({ localValues: values, studies: [], annotations: [] }, 'tg_77');
  assert.deepEqual(device, cloud); assert.equal(cloud.length, 5); assert.equal(JSON.stringify(values), original);
  for (const [key, raw] of Object.entries(values).filter(([k]) => k !== 'palette')) assert.deepEqual(JSON.parse(readerValue(key, readerEntries(key, raw))), JSON.parse(raw));
  const note = cloud.find(r => r.collection === 'notes');
  assert.equal(note.data.value.description, 'Unchanged words');
  assert.equal(note.data.entry, '1/2');
});
test('a device-only study and existing word marks retain their fields and ownership', async () => {
  const study = { id: 'one', revision: 7, title: 'Study', blocks: [{ text: 'My words' }] };
  const annotation = { id: 'mark', verseKey: 'genesis-1-1', start: 7, end: 20, quote: 'beginning God', style: 'underline' };
  const rows = await deviceRecords({ localValues: {}, studies: [study], annotations: [annotation] }, 'tg_77');
  assert.deepEqual(rows[0].data.value, study); assert.deepEqual(rows[0].data.user, { id: 'tg_77' });
  assert.deepEqual(rows[1].data.value, annotation);
});
test('malformed saved data aborts conversion instead of treating it as an empty source', async () => {
  for (const value of ['broken', 'null', '[]']) await assert.rejects(readerRecords({ bs_n_genesis_1: value }));
  await assert.rejects(readerRecords({ bs_bm: '[{"name":"missing id"}]' }));
  await assert.rejects(deviceRecords({ localValues: {}, studies: [{}], annotations: [] }, 'tg_77'));
});
test('legacy and independent same-passage notes round-trip without changing their IDs, passages or tags', async () => {
  const notes = { '1/2': { id: 'legacy', title: 'Old', description: 'Original', date: 1, tags: { faith: true } }, first: { id: 'first', verses: [1, 2], title: 'First', description: 'Keep first', date: 2 }, second: { id: 'second', verses: [1, 2], title: 'Second', description: 'Keep second', date: 3, tags: { faith: true } } };
  const key = 'bs_n_genesis_1', raw = JSON.stringify(notes);
  const rows = await readerRecords({ [key]: raw });
  assert.equal(new Set(rows.map(r => r.id)).size, 3);
  assert.deepEqual(Object.fromEntries(rows.map(r => [r.data.entry, r.data.value])), notes);
  assert.deepEqual(JSON.parse(readerValue(key, readerEntries(key, raw))), notes);
  assert.deepEqual(await deviceRecords({ localValues: { [key]: raw }, studies: [], annotations: [] }, 'tg_77'), rows);
});
