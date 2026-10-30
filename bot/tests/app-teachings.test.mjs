import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-teachings.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-teachings.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/app-identity$/ }, () => ({ path: 'identity', namespace: 'fixture' }));
  b.onResolve({ filter: /^\.\/teachings$/ }, () => ({ path: 'teachings', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'identity'
    ? `export async function appReader(req) { return req.headers.get('authorization') === 'Bearer fixture' ? {uid:'firebase-alice'} : null }`
    : `export async function searchTeachings(env,q,feed,page) { env.calls.push({q,feed,page}); return {ok:true,q,feed,page,hits:[{title:'A class',feed:'classes',date:'2026-01-01',video:'AAAAAAAAAAA',start:300,note:'/classes/a',excerpt:'the slave ships',timing:'caption'}],more:false,ms:1} }` }));
}}] });
const { appTeachings } = await import(out);
const env = { calls: [] };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const request = (query, authorization = 'Bearer fixture') => appTeachings.request(`https://example.test/?${query}`, { headers: { authorization } }, env, ctx);

test('only a signed-in app reader can search what was said in class', async () => {
  assert.equal((await request('q=ships', '')).status, 401);
  assert.equal(env.calls.length, 0);
});

test('a signed-in reader gets the spoken passages with their second', async () => {
  const response = await request('q=slave%20ships&feed=classes&page=2');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hits[0].start, 300);
  assert.deepEqual(env.calls.at(-1), { q: 'slave ships', feed: 'classes', page: 2 });
});

test('a long search and a wild page are bounded', async () => {
  await request(`q=${'a'.repeat(500)}&page=99999`);
  assert.equal(env.calls.at(-1).q.length, 200);
  assert.equal(env.calls.at(-1).page, 1000);
});
