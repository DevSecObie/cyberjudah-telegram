import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-og.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-og.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/app-identity$/ }, () => ({ path: 'identity', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export async function appReader(req) { return req.headers.get('authorization') === 'Bearer fixture' ? {uid:'firebase-alice'} : null }` }));
}}] });
const { appOg, isPublicTarget, parseOpenGraph, fetchPage } = await import(out);

const html = (head) => new Response(`<html><head>${head}</head><body>x</body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('only public web pages may be fetched', () => {
  for (const ok of ['https://example.com/a', 'http://www.youtube.com/watch?v=x', 'https://sub.example.org:443/']) assert.equal(isPublicTarget(ok), true, ok);
  for (const bad of [
    'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com',
    'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/',
    'http://[::1]/', 'http://2130706433/', 'http://0x7f000001/', 'http://example.com:8080/', 'http://router.local/',
    'http://metadata.google.internal/', 'https://cyberjudah.io/api/me', 'https://x.oisrae1.workers.dev/', 'http://intranet/',
  ]) assert.equal(isPublicTarget(bad), false, bad);
});

test('reads Open Graph tags, with the page title and description as fallbacks', () => {
  assert.deepEqual(parseOpenGraph('<meta property="og:title" content="Tom &amp; Jerry"><meta property="og:image" content="/pic.jpg"><meta property="og:site_name" content="Site"><meta name="description" content="Desc">', 'https://example.com/page'),
    { title: 'Tom & Jerry', description: 'Desc', image: 'https://example.com/pic.jpg', siteName: 'Site' });
  assert.deepEqual(parseOpenGraph('<title> Plain </title><meta property="og:image" content="javascript:alert(1)">', 'https://example.com/'), { title: 'Plain' });
  for (const image of ['http://192.168.1.1/x.jpg', 'https://localhost/x.jpg', 'http://example.com/x.jpg'])
    assert.equal(parseOpenGraph(`<meta property="og:image" content="${image}">`, 'https://example.com/').image, undefined, image);
});

test('every redirect is checked, and non-HTML is refused', async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return url === 'https://example.com/' ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }) : html(''); };
  assert.equal(await fetchPage('https://example.com/', fetcher), null);
  assert.deepEqual(calls, ['https://example.com/']);
  assert.equal(await fetchPage('https://example.com/', async () => new Response('{}', { headers: { 'content-type': 'application/json' } })), null);
  let hops = 0;
  assert.equal(await fetchPage('https://example.com/', async () => { hops++; return new Response(null, { status: 301, headers: { location: `https://example.com/${hops}` } }); }), null);
  assert.equal(hops, 4);
});

test('reads at most 512 KB of a page', async () => {
  const big = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(64 * 1024).fill(97)); c.close(); } });
  const page = await fetchPage('https://example.com/', async () => new Response(big, { headers: { 'content-type': 'text/html' } }));
  assert.equal(page.html.length, 512 * 1024);
});

const env = { READER_LIMIT: { limit: async ({ key }) => ({ success: key === 'og:firebase-alice' }) } };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const request = (query, authorization = 'Bearer fixture') => appOg.request(`https://example.test/?${query}`, { headers: { authorization } }, env, ctx);

test('only a signed-in app reader may ask, and only for public pages', async () => {
  assert.equal((await request('url=https%3A%2F%2Fexample.com', '')).status, 401);
  assert.equal((await request('url=http%3A%2F%2F127.0.0.1%2F')).status, 400);
  assert.equal((await request('')).status, 400);
});

test('answers in the shape the app reads', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => html('<meta property="og:title" content="A page"><meta property="og:description" content="About it">');
  try {
    const response = await request('url=https%3A%2F%2Fexample.com%2Fa');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { title: 'A page', description: 'About it' } });
  } finally { globalThis.fetch = original; }
});
