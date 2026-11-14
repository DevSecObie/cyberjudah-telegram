import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// The web app at web.cyberjudah.io reads cyberjudah.io's API from another origin; other sites still may not.
const out = new URL('./.build/web-app-cors.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { worker } = await import(out);
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const preflight = origin => worker.fetch(new Request('https://cyberjudah.io/api/app/channel/recent', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } }), {}, ctx);

test('the web app may read the API from web.cyberjudah.io', async () => {
  const response = await preflight('https://web.cyberjudah.io');
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://web.cyberjudah.io');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
});

test('the native readers keep their origins, and other sites get none', async () => {
  assert.equal((await preflight('capacitor://localhost')).headers.get('access-control-allow-origin'), 'capacitor://localhost');
  for (const origin of ['https://evil.example', 'https://web.cyberjudah.io.evil.example', 'http://web.cyberjudah.io'])
    assert.ok(!(await preflight(origin)).headers.get('access-control-allow-origin'), origin);
});

test('an allowed origin can read Retry-After on a refusal (#606: the Search limit notice)', async () => {
  const response = await worker.fetch(new Request('https://cyberjudah.io/api/health', { headers: { origin: 'https://web.cyberjudah.io' } }), {}, ctx);
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /(^|,\s*)Retry-After(\s*,|$)/i);
});
