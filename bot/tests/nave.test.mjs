import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/nave.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/nave.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { createNave } = await import(out);
const resource = { kind: 'nave', language: 'en', revision: 'test' };
const topic = { normalizedName: 'aaron', name: 'Aaron', initial: 'a', description: '<p>Aaron</p>' };
const page = { resource, topics: [topic], limit: 50, nextCursor: '%5B%22Aaron%22%2C%22aaron%22%5D' };

test('Nave forwards English list, search and opaque cursor reads without user headers', async () => {
  const calls = [];
  const api = createNave(async (url, init) => { calls.push([url, init]); return Response.json(page); });
  const response = await api.request('/en/topics?initial=a&search=Aaron&limit=50&cursor=%255B%2522x%2522%255D', { headers: { authorization: 'never-forward-this', cookie: 'private=1' } });
  assert.equal(response.status, 200);
  const [url, init] = calls[0];
  assert.equal(new URL(url).origin, 'https://api.bible-strong.app');
  assert.equal(new URL(url).pathname, '/v1/naves/en/topics');
  assert.equal(new URL(url).searchParams.get('cursor'), '%5B%22x%22%5D');
  assert.deepEqual(init.headers, { accept: 'application/json' });
  assert.equal(init.redirect, 'manual');
  assert.deepEqual((await response.json()).topics, [{ normalizedName: 'aaron', name: 'Aaron', initial: 'a' }]);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
test('Nave serves articles, verse/chapter topics, and a random article', async () => {
  const paths = [];
  const api = createNave(async url => {
    paths.push(new URL(url).pathname);
    return Response.json(url.includes('/verses/') ? { resource, verseKey: '1-1-1', verseTopics: [{ normalizedName: 'aaron', name: 'Aaron' }], chapterTopics: [] } : { resource, topic });
  });
  for (const path of ['/en/topics/aaron', '/en/random', '/en/verses/1-1-1/topics']) assert.equal((await api.request(path)).status, 200);
  assert.deepEqual(paths, ['/v1/naves/en/topics/aaron', '/v1/naves/en/random', '/v1/naves/en/verses/1-1-1/topics']);
});
test('French, unknown operations, malformed verse keys and invalid limits never reach upstream', async () => {
  const api = createNave(async () => { assert.fail('invalid request reached upstream'); });
  for (const path of ['/fr/topics', '/en/topics?limit=0', '/en/topics?limit=501', '/en/topics?limit=NaN', '/en/verses/0-1-1/topics', '/en/offline']) assert.ok((await api.request(path)).status >= 400, path);
});
test('unavailable and invalid upstream payloads remain errors, not empty topic lists', async () => {
  for (const body of [{}, { ...page, resource: { ...resource, language: 'fr' } }, { ...page, resource: { ...resource, kind: 'dictionary' } }]) {
    assert.equal((await createNave(async () => Response.json(body)).request('/en/topics')).status, 502);
  }
  assert.equal((await createNave(async () => Response.json({ resource, topic })).request('/en/topics/another')).status, 502);
  assert.equal((await createNave(async () => Response.json({ resource, verseKey: '1-1-2', verseTopics: [], chapterTopics: [] })).request('/en/verses/1-1-1/topics')).status, 502);
  assert.equal((await createNave(async () => new Response('', { status: 404 })).request('/en/topics/missing')).status, 404);
  assert.equal((await createNave(async () => new Response('', { status: 503 })).request('/en/topics')).status, 503);
  assert.equal((await createNave(async () => { throw new Error('network'); }).request('/en/topics')).status, 503);
});
