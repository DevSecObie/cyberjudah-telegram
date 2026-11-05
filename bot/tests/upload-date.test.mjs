import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/upload-date.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/upload-date.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { uploadDateIn, uploadDate } = await import(out);

const kv = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, m }; };

test('the upload date is read from the watch page, never guessed', () => {
  assert.equal(uploadDateIn('..."microformat":{"playerMicroformatRenderer":{"publishDate":"2020-05-25T05:00:11-07:00","uploadDate":"2020-05-25T05:00:11-07:00"}}'), '2020-05-25');
  assert.equal(uploadDateIn('<meta itemprop="datePublished" content="2019-01-04T12:00:00-08:00">'), '2019-01-04');
  assert.equal(uploadDateIn('<html>Sign in to confirm you are not a bot</html>'), '');
});

test('a found date is kept and YouTube is asked once; a bad id is never fetched', async () => {
  const SUBS = kv(); let calls = 0;
  const fetcher = async () => { calls++; return new Response('"publishDate":"2020-05-25T05:00:11-07:00"'); };
  assert.equal(await uploadDate({ SUBS }, '-t9W3dyGuTI', fetcher), '2020-05-25');
  assert.equal(await uploadDate({ SUBS }, '-t9W3dyGuTI', fetcher), '2020-05-25');
  assert.equal(calls, 1);
  assert.equal(await uploadDate({ SUBS }, 'bad id', fetcher), '');
  assert.equal(calls, 1);
  assert.equal(await uploadDate({ SUBS }, 'AAAAAAAAAAA', async () => { throw new Error('offline'); }), '');
});
