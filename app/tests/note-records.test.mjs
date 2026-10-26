import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let instance = 0;
async function setup(t) {
  const values = {};
  const previous = globalThis.__noteStore;
  globalThis.__noteStore = { json: { get: async (key, fallback) => structuredClone(values[key] ?? fallback), set: async (key, value) => { values[key] = structuredClone(value); } }, store: { keys: async () => Object.keys(values) } };
  t.after(() => { globalThis.__noteStore = previous; });
  const output = await build({ entryPoints: [new URL('../src/bible/store.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'note-storage-boundary', setup(b) {
    b.onResolve({ filter: /^@\/tg\/(store|hooks)$/ }, args => ({ path: args.path, namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path.endsWith('/store') ? 'export const { json, store } = globalThis.__noteStore;' : 'export const useStored = () => { throw new Error("Hooks are not part of this storage test"); };' }));
  } }] });
  return { values, ...await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${instance++}`) };
}
test('same-passage records edit and delete by ID without replacing a legacy range or another note', async t => {
  const { values, writeNote, readNote, noteVerses, noteEndpoint } = await setup(t);
  const legacy = { id: 'legacy', title: 'Old', description: 'Original words', date: 1, tags: { faith: true } };
  const first = { id: 'first', verses: [1, 2], title: 'First', description: 'First words', date: 2 };
  const second = { id: 'second', verses: [1, 2], title: 'Second', description: 'Second words', date: 3 };
  await writeNote('genesis', 1, '1/2', legacy);
  await writeNote('genesis', 1, first.id, first);
  await writeNote('genesis', 1, second.id, second);
  assert.deepEqual(values.bs_n_genesis_1, { '1/2': legacy, first, second });
  assert.deepEqual((await readNote('genesis-1-2', 'second')).note, second);
  assert.deepEqual(noteVerses('first', first), [1, 2]);
  assert.deepEqual(noteVerses('1/2', legacy), [1, 2]);
  assert.equal(noteEndpoint('genesis', 1, 'first', first).noteId, 'first');
  assert.equal(noteEndpoint('genesis', 1, '1/2', legacy).noteId, undefined);
  const edited = { ...second, description: 'Edited words', date: 4 };
  await writeNote('genesis', 1, second.id, edited);
  await writeNote('genesis', 1, first.id, null);
  assert.deepEqual(values.bs_n_genesis_1, { '1/2': legacy, second: edited });
  assert.equal(await readNote('genesis-1-1', 'first'), null);
  assert.deepEqual((await readNote('genesis-1-1')).note, legacy);
  assert.equal(await readNote('genesis-2-1', 'second'), null);
  await writeNote('genesis', 1, '1/2', null);
  assert.equal(await readNote('genesis-1-1'), null);
  assert.deepEqual((await readNote('genesis-1-1', 'second')).note, edited);
});
