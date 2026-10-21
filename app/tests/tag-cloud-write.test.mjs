import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('queued tag edits wait for the real CloudStorage write callback before reading again', async t => {
  const device = {}, cloud = {}, pending = [];
  const previous = { window: globalThis.window, sdk: globalThis.__tagCloudSdk };
  globalThis.window = { localStorage: { getItem: key => device[key] ?? null, setItem: (key, value) => { device[key] = value; }, removeItem: key => { delete device[key]; } }, dispatchEvent: () => true };
  globalThis.__tagCloudSdk = { features: { cloud: true, deviceStorage: false }, app: { CloudStorage: {
    getItem: (key, callback) => queueMicrotask(() => callback(null, cloud[key] ?? '')),
    setItem: (key, value, callback) => pending.push(() => { cloud[key] = value; callback(null, true); }),
    removeItem: (key, callback) => pending.push(() => { delete cloud[key]; callback(null, true); }),
  } } };
  t.after(() => { globalThis.window = previous.window; globalThis.__tagCloudSdk = previous.sdk; });
  const result = await build({ stdin: { contents: 'export * from "./lib/tag-storage"; export { store } from "./tg/store";', resolveDir: new URL('../src', import.meta.url).pathname }, tsconfig: new URL('../tsconfig.json', import.meta.url).pathname, bundle: true, write: false, format: 'esm', plugins: [{ name: 'tag-cloud-boundaries', setup(b) {
    b.onResolve({ filter: /^(\.\/sdk|@\/tg\/sdk)$/ }, () => ({ path: 'sdk', namespace: 'fixture' }));
    b.onResolve({ filter: /^@\/studies\/storage$/ }, () => ({ path: 'studies', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path === 'sdk' ? 'export const { app, features } = globalThis.__tagCloudSdk;' : 'export const allAnnotations = async () => []; export const changeAnnotations = async () => {}; export const markId = a => a.id;' }));
  } }] });
  const { saveTagDefinition, store } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const first = saveTagDefinition('a', 'Alpha', true);
  const second = saveTagDefinition('b', 'Beta', true);
  for (let i = 0; i < 30 && pending.length === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1, 'the second editor must not write while the first callback is pending');
  assert.equal(cloud.bs_tags, undefined);
  pending.shift()(); await first;
  for (let i = 0; i < 30 && pending.length === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  pending.shift()(); await second;
  assert.deepEqual(Object.keys(JSON.parse(cloud.bs_tags)).sort(), ['a', 'b']);
  assert.deepEqual(JSON.parse(device['cj:bs_tags']), JSON.parse(cloud.bs_tags));
  let removed = false;
  const removing = store.set('bs_tags', null).then(() => { removed = true; });
  await Promise.resolve(); assert.equal(removed, false);
  pending.shift()(); await removing;
  assert.equal(removed, true);
});
