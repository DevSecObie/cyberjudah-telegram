import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

let instance = 0;
async function setup(t, { cloud = false, deviceStorage = false, full = false } = {}) {
  const values = { 'cj:existing': 'kept', unrelated: 'not a backup key' };
  const storage = new Proxy(values, { get(target, key) {
    if (key === 'getItem') return k => target[k] ?? null;
    if (key === 'setItem') return (k, v) => { if (full) throw new DOMException('Full', 'QuotaExceededError'); target[k] = v; };
    if (key === 'removeItem') return k => { delete target[k]; };
    return target[key];
  } });
  let cloudRead; const cloudWrites = [], deviceWrites = [];
  const previous = { window: globalThis.window, sdk: globalThis.__storeTestSdk };
  globalThis.window = { localStorage: storage, dispatchEvent: () => true };
  globalThis.__storeTestSdk = { features: { cloud, deviceStorage }, app: {
    DeviceStorage: { getItem: (_k, cb) => cb(null, 'device'), setItem: (k, v) => deviceWrites.push([k, v]), removeItem: () => {} },
    CloudStorage: { getItem: (_k, cb) => { cloudRead = cb; }, getKeys: cb => cb(null, ['cloud']), setItem: (k, v) => cloudWrites.push([k, v]), removeItem: () => {} },
  } };
  t.after(() => { globalThis.window = previous.window; globalThis.__storeTestSdk = previous.sdk; });
  const output = await build({ entryPoints: [new URL('../src/tg/store.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', plugins: [{ name: 'telegram-test-boundary', setup(b) {
    b.onResolve({ filter: /^\.\/sdk$/ }, () => ({ path: 'sdk', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const { app, features } = globalThis.__storeTestSdk;' }));
  } }] });
  const { store, connectPersonalStore } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${instance++}`);
  return { store, connectPersonalStore, cloudWrites, deviceWrites, reply: value => cloudRead(null, value) };
}
test('browser backup enumerates existing and newly saved preferences without unrelated keys', async t => {
  const { store } = await setup(t);
  store.set('bookmark', 'John 1');
  assert.deepEqual((await store.keys()).sort(), ['bookmark', 'existing']);
  assert.equal(await store.get('bookmark'), 'John 1');
  store.set('bookmark', null);
  assert.deepEqual(await store.keys(), ['existing']);
});
test('a full browser mirror cannot lose a Telegram write or let a delayed cloud read replace it', async t => {
  const { store, reply, deviceWrites, cloudWrites } = await setup(t, { cloud: true, deviceStorage: true, full: true });
  assert.equal(await store.get('bookmark'), 'device');
  store.set('bookmark', 'newer'); reply('stale');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await store.get('bookmark'), 'newer');
  assert.deepEqual(deviceWrites, [['bookmark', 'newer']]);
  assert.deepEqual(cloudWrites, [['bookmark', 'newer']]);
  assert.ok((await store.keys()).includes('bookmark'));
});
test('cloud reads remain usable when this browser cannot persist their mirror', async t => {
  const { store, reply } = await setup(t, { cloud: true, full: true });
  await store.get('bookmark'); reply('from-cloud');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await store.get('bookmark'), 'from-cloud');
  assert.throws(() => store.set('bookmark', 'unsaved'), /Full/);
});

test('failed account sync reads original marks without refreshing or writing their old keys', async t => {
  const { store, connectPersonalStore, reply, deviceWrites, cloudWrites } = await setup(t, { cloud: true, deviceStorage: true });
  connectPersonalStore(Promise.reject(new Error('Expired sign-in')));
  assert.equal(await store.get('bs_h_genesis_1'), 'device');
  reply('original-cloud');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await store.get('bs_h_genesis_1'), 'original-cloud');
  store.set('bs_h_genesis_1', 'unsynced edit');
  assert.deepEqual(deviceWrites, []);
  assert.deepEqual(cloudWrites, []);
});
