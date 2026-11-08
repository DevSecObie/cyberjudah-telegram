import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';

// cyberjudah.io/privacy and /terms: the store listing's legal pages, served by this Worker as
// plain HTML. The Mini App's /app/privacy and /app/terms still come from the assets.
const out = new URL('./.build/site-legal.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/site-legal.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const assets = [];
const env = { ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response('spa', { headers: { 'content-type': 'text/html' } }); } } };
const get = (path, method = 'GET') => m.worker.fetch(new Request(`https://cyberjudah.io${path}`, { method }), env, { waitUntil() {}, passThroughOnException() {} });

for (const [path, title, other] of [['/privacy', 'Privacy Policy', '/terms'], ['/terms', 'Terms of Use', '/privacy']]) {
  test(`${path} is a plain HTML page, cached, readable without JavaScript, linking to ${other}`, async () => {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const html = await res.text();
    assert.match(html, /^<!doctype html>/);
    assert.match(html, new RegExp(`<title>CyberJudah: ${title}</title>`));
    assert.match(html, new RegExp(`<h1>${title}</h1>`));
    assert.ok(html.includes(`<a href="${other}">`), 'links to the other page');
    assert.ok(!/<script/i.test(html), 'no script: the text is in the HTML itself');
  });
}

test('HEAD works, and the Mini App\'s /app/privacy and /app/terms still come from the assets', async () => {
  assert.equal((await get('/privacy', 'HEAD')).status, 200);
  assets.length = 0;
  await get('/app/privacy');
  await get('/app/terms');
  assert.deepEqual(assets, ['/app/privacy', '/app/terms']);
});

test('the pasted text is rendered as headings, lists and paragraphs, every character escaped', () => {
  const html = m.legalHtml('# Title\n\n## Section\n\nLine one\nline two & <b>three</b>\n\n- a "b"\n- c');
  assert.equal(html, '<h1>Title</h1>\n<h2>Section</h2>\n<p>Line one<br>line two &amp; &lt;b&gt;three&lt;/b&gt;</p>\n<ul><li>a &quot;b&quot;</li><li>c</li></ul>');
});

test('the routes reach this Worker on cyberjudah.io, before the Mini App\'s assets', () => {
  const src = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  for (const p of ['/privacy', '/terms']) {
    assert.ok(src.includes(`"cyberjudah.io${p}"`), `route cyberjudah.io${p}`);
    assert.match(src, new RegExp(`"run_worker_first": \\[[^\\]]*"${p}"`), `${p} runs the Worker first`);
  }
});

// Fails until the approved legal text is pasted in: the pages must not ship with a placeholder.
test('both pages hold the approved legal text, not the placeholder', () => {
  assert.ok(!m.PRIVACY_TEXT.includes(m.LEGAL_TEXT_PENDING), 'privacy text is still the placeholder');
  assert.ok(!m.TERMS_TEXT.includes(m.LEGAL_TEXT_PENDING), 'terms text is still the placeholder');
});
