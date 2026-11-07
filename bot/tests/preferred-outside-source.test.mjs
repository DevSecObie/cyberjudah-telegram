import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/preferred-outside-source.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { preferredOutsidePages } from "./src/preferred-outside-source"; export { MORE_RUN } from "./src/ask-tools"; export { RESEARCH } from "./src/ai.mjs";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { preferredOutsidePages, MORE_RUN, RESEARCH } = await import(out);
const article = 'These are the exact existing words in the recorded article, with its stated explanation and historical context. No additional teaching is supplied by this fixture.';
const row = { id: 123, title: 'Recorded page', subtype: 'page', url: 'https://israelunite.org/recorded-page/', _links: { self: [{ href: 'https://israelunite.org/wp-json/wp/v2/pages/123' }] } };
const page = { title: { rendered: 'Recorded page' }, content: { rendered: `<p>${article}</p>`, protected: false }, link: row.url };
const env = hosts => ({ SUBS: { get: async () => ({ revision: Number.MAX_SAFE_INTEGER, hosts }) } });
const run = async (hosts, input) => {
  const sources = [], events = [];
  const result = await MORE_RUN.outside_source(env(hosts), input, undefined, event => events.push(event), () => '', source => { sources.push(source); return { n: sources.length, fresh: true }; });
  return { result, sources, events };
};

test('IUIC discovery returns published article text and credit before any Wikipedia lookup', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (address, options) => {
    const url = new URL(address); requests.push(url);
    assert.equal(url.hostname, 'israelunite.org');
    assert.equal(options.redirect, 'error');
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('search'), 'recorded question');
      assert.equal(url.searchParams.get('subtype'), 'page,post');
      return Response.json([row]);
    }
    assert.equal(url.pathname, '/wp-json/wp/v2/pages/123');
    return Response.json(page);
  });
  const { result, sources, events } = await run(['israelunite.org', 'wikipedia.org'], { query: 'recorded question' });
  assert.equal(requests.length, 2);
  assert.deepEqual(sources, [{ kind: 'web', title: 'Recorded page', url: row.url, sub: 'israelunite.org', text: article }]);
  assert.ok(result.content.includes(article) && result.content.includes('israelunite.org'));
  assert.ok(events[0].status.includes('israelunite.org'));
  assert.match(RESEARCH, /preferring israelunite\.org before other approved outside sites/);
  assert.match(RESEARCH, /never invent new doctrine/);
});

for (const mode of ['no-match', 'unavailable']) {
  test(`Wikipedia remains a fallback when the preferred source has ${mode}`, async t => {
    const hosts = [];
    t.mock.method(globalThis, 'fetch', async address => {
      const url = new URL(address); hosts.push(url.hostname);
      if (url.hostname === 'israelunite.org') {
        if (mode === 'unavailable') throw new Error('offline');
        return Response.json([]);
      }
      assert.equal(url.hostname, 'en.wikipedia.org');
      return Response.json(url.searchParams.get('list') === 'search' ? { query: { search: [{ title: 'Recorded history' }] } } : { query: { pages: [{ title: 'Recorded history', extract: article }] } });
    });
    const { sources } = await run(['israelunite.org', 'wikipedia.org'], { query: 'recorded question' });
    assert.deepEqual(hosts, ['israelunite.org', 'en.wikipedia.org', 'en.wikipedia.org']);
    assert.equal(sources[0].sub, 'en.wikipedia.org');
  });
}

test('a reviewed source list can exclude IUIC; source preference never bypasses it', async () => {
  assert.deepEqual(await preferredOutsidePages('recorded question', ['wikipedia.org'], async () => { assert.fail('disallowed source fetched'); }), []);
});

test('foreign or malformed result endpoints and protected content cannot become sources', async () => {
  for (const endpoint of ['https://evil.test/private', 'https://israelunite.org:8443/private', 'https://user@israelunite.org/private', 'https://israelunite.org/wp-json/wp/v2/pages/999']) {
    const requests = [];
    const result = await preferredOutsidePages('recorded question', ['israelunite.org'], async address => { requests.push(address); return Response.json([{ ...row, _links: { self: [{ href: endpoint }] } }]); });
    assert.deepEqual(result, []);
    assert.equal(requests.length, 1);
  }
  const result = await preferredOutsidePages('recorded question', ['israelunite.org'], async address => Response.json(String(address).includes('/search?') ? [row] : { ...page, content: { rendered: article, protected: true } }));
  assert.deepEqual(result, []);
});

test('an explicitly requested approved URL remains the selected source', async t => {
  t.mock.method(globalThis, 'fetch', async address => {
    assert.equal(address, 'https://en.wikipedia.org/wiki/Recorded_history');
    return new Response(`<title>Recorded history</title><p>${article}</p>`);
  });
  const { sources } = await run(['israelunite.org', 'wikipedia.org'], { url: 'https://en.wikipedia.org/wiki/Recorded_history' });
  assert.equal(sources[0].sub, 'en.wikipedia.org');
});
