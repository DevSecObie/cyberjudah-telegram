import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const state = { values: {}, annotations: [], fail: '', synced: false, cloud: false, cloudRead: null };
globalThis.__tagTest = state;
const output = await build({ stdin: { contents: 'export * from "./lib/tag-list"; export * from "./lib/tag-storage";', resolveDir: new URL('../src', import.meta.url).pathname }, tsconfig: new URL('../tsconfig.json', import.meta.url).pathname, bundle: true, write: false, format: 'esm', plugins: [{ name: 'tag-storage-fixture', setup(b) {
  b.onResolve({ filter: /^@\/(tg\/store|tg\/sdk|studies\/storage)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.includes('tg/store') ? `
    const state = globalThis.__tagTest;
    export const personalStore = async () => state.synced ? { get: key => JSON.stringify(state.values[key] ?? {}), set: async (key, value) => { await Promise.resolve(); if (state.fail === key) throw Error('write failed'); state.values[key] = JSON.parse(value); } } : null;
    export const store = { keys: async () => Object.keys(state.values) };
    export const json = { get: async (key, fallback) => structuredClone(state.values[key] ?? fallback), set: async (key, value) => { if (state.fail === key) throw Error('write failed'); state.values[key] = structuredClone(value); } };
  ` : args.path.includes('tg/sdk') ? `
    const state = globalThis.__tagTest;
    export const features = { get cloud() { return state.cloud; } };
    export const app = { CloudStorage: { getItem: (key, callback) => { state.cloudRead = callback; } } };
  ` : `
    const state = globalThis.__tagTest;
    export const allAnnotations = async () => structuredClone(state.annotations);
    export const markId = a => a.group ?? a.id;
    export const changeAnnotations = async ({update}) => { if (state.fail === 'annotations') throw Error('write failed'); for (const record of update) state.annotations[state.annotations.findIndex(a => a.id === record.id)] = record; };
  ` }));
} }] });
const { buildTagInventory, itemsForTag, queryTags, normalizeTagQuery, deleteTagEverywhere, saveTagDefinition } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('tag counts include grouped word marks, notes and links; highlight chips group by date', () => {
  const tagged = { date: 100, tags: { faith: true } };
  const inventory = buildTagInventory([
    { kind: 'h', slug: 'genesis', chapter: 1, records: { 1: { ...tagged, color: 'color1' }, 2: { ...tagged, color: 'color1' } } },
    { kind: 'n', slug: 'genesis', chapter: 1, records: { '1/2': { ...tagged, id: 'n', title: 'Note', description: 'Words' } } },
    { kind: 'l', slug: 'genesis', chapter: 1, records: { 3: { ...tagged, id: 'l', title: 'Link', url: 'https://example.com' } } },
  ], [2, 1].map(verse => ({ id: `w${verse}`, group: 'word', verseKey: `genesis-1-${verse}`, tags: tagged.tags, quote: `part ${verse}`, created: '2026-10-01', style: 'underline' })));
  const rows = queryTags([{ id: 'faith', name: 'Faith' }, { id: 'empty', name: 'Empty' }], inventory, { query: '', sort: 'count-desc' });
  assert.deepEqual(rows.map(row => row.id), ['faith', 'empty']);
  assert.deepEqual(rows[0].counts, { highlights: 2, notes: 1, links: 1 });
  assert.equal(rows[0].itemCount, 5);
  assert.deepEqual(itemsForTag(inventory, 'faith').filter(item => item.kind === 'highlight')[0].references, ['genesis-1-1', 'genesis-1-2']);
  assert.equal(itemsForTag(inventory, 'faith').find(item => item.kind === 'word').description, 'part 1 … part 2');
  assert.deepEqual(queryTags(rows.map(row => row.tag), inventory, { query: 'fai', sort: 'name-asc' }).map(row => row.id), ['faith']);
  assert.deepEqual(normalizeTagQuery({ sort: 'invalid', query: 10 }), { sort: 'name-asc', query: '' });
});

function seed() {
  state.fail = ''; state.synced = false; state.cloud = false; state.cloudRead = null;
  state.values = { bs_tags: { gone: { id: 'gone', name: 'Gone' }, kept: { id: 'kept', name: 'Kept' } } };
  for (const kind of ['h', 'n', 'l']) state.values[`bs_${kind}_genesis_1`] = { 1: { id: kind, title: 'Keep this content', tags: { gone: true, kept: true } } };
  state.annotations = [1, 2].map(verse => ({ id: `w${verse}`, group: 'word', verseKey: `genesis-1-${verse}`, quote: 'keep', style: 'underline', tags: { gone: true, kept: true } }));
}

test('deleting a tag removes every attachment without deleting any content or other tag', async () => {
  seed();
  await deleteTagEverywhere('gone');
  assert.deepEqual(Object.keys(state.values.bs_tags), ['kept']);
  for (const kind of ['h', 'n', 'l']) { const value = state.values[`bs_${kind}_genesis_1`][1]; assert.deepEqual(value.tags, { kept: true }); assert.equal(value.title, 'Keep this content'); }
  assert.equal(state.annotations.length, 2);
  for (const record of state.annotations) { assert.deepEqual(record.tags, { kept: true }); assert.equal(record.quote, 'keep'); }
});

test('a failed attachment removal leaves the tag available for retry', async () => {
  seed(); state.fail = 'annotations';
  await assert.rejects(deleteTagEverywhere('gone'), /write failed/);
  assert.ok(state.values.bs_tags.gone);
  state.fail = '';
  await deleteTagEverywhere('gone');
  assert.equal(state.values.bs_tags.gone, undefined);
});

 test('an account write failure is awaited before removing the tag', async () => {
  seed(); state.synced = true; state.fail = 'bs_l_genesis_1';
  await assert.rejects(deleteTagEverywhere('gone'), /write failed/);
  assert.ok(state.values.bs_tags.gone);
  state.fail = '';
  await deleteTagEverywhere('gone');
  assert.equal(state.values.bs_tags.gone, undefined);
});

 test('renaming waits for cloud hydration and preserves concurrent definitions', async () => {
  seed(); state.cloud = true;
  const saving = saveTagDefinition('gone', 'Renamed', false);
  while (!state.cloudRead) await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.values.bs_tags.gone.name, 'Gone');
  state.values.bs_tags.concurrent = { id: 'concurrent', name: 'Local edit' };
  state.cloudRead(null, JSON.stringify({ ...state.values.bs_tags, remote: { id: 'remote', name: 'Cloud tag' } }));
  await saving;
  assert.equal(state.values.bs_tags.remote.name, 'Cloud tag');
  assert.equal(state.values.bs_tags.concurrent.name, 'Local edit');
  assert.equal(state.values.bs_tags.kept.name, 'Kept');
  assert.equal(state.values.bs_tags.gone.name, 'Renamed');
});
 test('failed hydration does not write an incomplete tag map and the next save can retry', async () => {
  seed(); state.cloud = true;
  const saving = saveTagDefinition('new', 'New tag', true);
  while (!state.cloudRead) await new Promise(resolve => setImmediate(resolve));
  state.cloudRead('offline');
  await assert.rejects(saving, /offline/);
  assert.equal(state.values.bs_tags.new, undefined);
  state.cloud = false;
  await saveTagDefinition('new', 'New tag', true);
  assert.equal(state.values.bs_tags.new.name, 'New tag');
});
