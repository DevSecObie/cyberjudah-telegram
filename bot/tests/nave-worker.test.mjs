import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({
  stdin: {
    contents: 'import { Hono } from "hono"; import { nave } from "./src/nave.ts"; const app = new Hono(); app.route("/api/nave", nave); export default app;',
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
});
const resource = { kind: 'nave', language: 'en', revision: 'test' };
const topic = { normalizedName: 'aaron', name: 'Aaron', initial: 'a', description: '<p>Aaron</p>' };
const page = { resource, topics: [topic], limit: 50 };

function worker(outboundService) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01', outboundService,
  }));
}

test('Nave reaches its public upstream in the Workers runtime for every online read', async () => {
  const calls = [];
  const mf = worker(request => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    return Response.json(path.includes('/verses/')
      ? { resource, verseKey: '1-1-1', verseTopics: [], chapterTopics: [] }
      : path.endsWith('/topics') ? page : { resource, topic });
  });
  try {
    for (const path of ['topics?initial=a&limit=50', 'topics?search=Aaron&limit=20&cursor=opaque%2520cursor', 'topics/aaron', 'verses/1-1-1/topics', 'random']) {
      const response = await mf.dispatchFetch(`https://cyberjudah.test/api/nave/en/${path}`, {
        headers: { authorization: 'private', cookie: 'private=1' },
      });
      assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
      assert.deepEqual((await response.json()).resource, resource);
    }
    assert.equal(calls.length, 5);
    for (const request of calls) {
      assert.equal(new URL(request.url).origin, 'https://api.bible-strong.app');
      assert.equal(request.headers.get('accept'), 'application/json');
      assert.equal(request.headers.get('authorization'), null);
      assert.equal(request.headers.get('cookie'), null);
    }
    assert.equal(new URL(calls[1].url).searchParams.get('cursor'), 'opaque%20cursor');
    assert.equal(new URL(calls[1].url).searchParams.get('limit'), '20');
  } finally {
    await mf.dispose();
  }
});

test('Nave rejects upstream redirects without following them in the Workers runtime', async () => {
  const calls = [];
  let status;
  const mf = worker(request => {
    calls.push(request.url);
    return new Response(null, { status, headers: { location: 'https://unexpected.test/nave' } });
  });
  try {
    for (status of [301, 302, 303, 307, 308]) {
      const response = await mf.dispatchFetch('https://cyberjudah.test/api/nave/en/topics');
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: 'nave-unavailable' });
    }
    assert.equal(calls.length, 5);
    assert.ok(calls.every(url => new URL(url).origin === 'https://api.bible-strong.app'));
  } finally {
    await mf.dispose();
  }
});
