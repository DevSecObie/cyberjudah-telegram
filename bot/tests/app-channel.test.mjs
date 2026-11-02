import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-channel.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-channel.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/live$/ }, () => ({ path: 'live', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents:
    `export async function recentVideos(env) { env.calls.push('recent'); return env.recent }
     export async function liveNow(env) { env.calls.push('live'); return { live: true, upcoming: false, video: 'BBBBBBBBBBB', title: 'A class', starts: null } }` }));
}}] });
const { appChannel } = await import(out);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const fresh = { ok: true, videos: [{ video: 'AAAAAAAAAAA', title: 'Today’s class', published: '2026-10-31T15:55:20Z', views: null }] };

test('the newest uploads are served without a sign-in, as the Telegram app reads them', async () => {
  const env = { calls: [], recent: fresh };
  const response = await appChannel.request('https://example.test/recent', {}, env, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { videos: fresh.videos, feedOk: true });
  assert.match(response.headers.get('cache-control'), /max-age=300/);
});

test('a feed outage is reported and retried sooner', async () => {
  const env = { calls: [], recent: { ok: false, videos: [] } };
  const response = await appChannel.request('https://example.test/recent', {}, env, ctx);
  assert.equal((await response.json()).feedOk, false);
  assert.match(response.headers.get('cache-control'), /max-age=60/);
});

test('the live stream is served without a sign-in', async () => {
  const env = { calls: [] };
  const response = await appChannel.request('https://example.test/live', {}, env, ctx);
  assert.equal((await response.json()).video, 'BBBBBBBBBBB');
});

test('nothing but reading is allowed', async () => {
  const env = { calls: [], recent: fresh };
  assert.equal((await appChannel.request('https://example.test/recent', { method: 'POST' }, env, ctx)).status, 404);
  assert.equal(env.calls.length, 0);
});
