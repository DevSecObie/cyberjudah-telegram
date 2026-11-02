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
const index = [{ slug: 'faith', label: 'Faith' }];
const faith = { slug: 'faith', label: 'Faith', items: [{ title: 'Faith class', url: 'https://cyberjudah.io/notes/faith' }] };

function worker(outboundService) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01', outboundService,
    bindings: { DATA_ORIGIN: 'https://data.cyberjudah.test' },
  }));
}

test('Nave reads the classes\' topics in the Workers runtime, never Bible Strong\'s Nave', async () => {
  const calls = [];
  const mf = worker(request => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    return path === '/api/topics/index.json' ? Response.json(index) : path === '/api/topics/faith.json' ? Response.json(faith) : new Response('', { status: 404 });
  });
  try {
    for (const path of ['topics?initial=f&limit=50', 'topics?search=Faith&limit=20', 'topics/faith', 'verses/1-1-1/topics', 'random']) {
      const response = await mf.dispatchFetch(`https://cyberjudah.test/api/nave/en/${path}`, {
        headers: { authorization: 'private', cookie: 'private=1' },
      });
      assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
      const body = await response.json();
      assert.equal(body.resource.kind, 'nave');
      assert.match(body.resource.revision, /^cj-/);
      if (path.startsWith('topics?')) assert.deepEqual(body.topics.map(t => t.normalizedName), ['faith']);
    }
    assert.ok(calls.length > 0);
    for (const request of calls) {
      assert.equal(new URL(request.url).origin, 'https://data.cyberjudah.test');
      assert.equal(request.headers.get('authorization'), null);
      assert.equal(request.headers.get('cookie'), null);
    }
    assert.equal((await mf.dispatchFetch('https://cyberjudah.test/api/nave/en/topics/aaron')).status, 404);
  } finally {
    await mf.dispose();
  }
});
