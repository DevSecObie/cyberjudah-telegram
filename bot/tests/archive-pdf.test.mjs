import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/archive-pdf.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/library-pdf.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { libraryPdf, TELEGRAM_PDF_LIMIT } = await import(out);
const id = 'recorded-public-book', title = 'Existing shelf title';
const post = body => new Request('https://cyberjudah.test/api/library/pdf', { method: 'POST', body: JSON.stringify(body) });
const valid = { archive: id, send: true };
const file = { name: 'recorded text.pdf', format: 'Text PDF', size: String(6 * 1024 * 1024) };

function fixture(options = {}) {
  const fetched = [], sent = [], reads = [], entries = new Map(), cached = [];
  const read = async path => { reads.push(path); assert.equal(path, '/api/library/class-books.json'); return options.shelf ?? [{ archive: id, status: 'public-domain', title }]; };
  const cache = { async get(key) { return entries.get(key) ?? null; }, async put(key, value, opts) { cached.push({ key, value, opts }); entries.set(key, value); }, async delete(key) { entries.delete(key); } };
  const send = async (document, filename, caption) => {
    if (options.sendError) throw new Error('chat not found');
    if (typeof document === 'string') sent.push({ document, filename, caption });
    else { const bytes = await new Response(document).arrayBuffer(); sent.push({ uploaded: bytes.byteLength, filename, caption }); }
    return { document: { file_id: 'Recorded_File_ID_1234' } };
  };
  const fetcher = async (url, init) => {
    fetched.push({ url, method: init.method ?? 'GET' });
    assert.equal(init.redirect, 'manual');
    if (url === `https://archive.org/metadata/${id}`) return Response.json(options.metadata ?? { files: [{ name: `${id}.pdf`, format: 'Image Container PDF', size: '100' }, options.file ?? file] });
    if (options.redirect) return new Response(null, { status: 302, headers: { location: options.redirect } });
    assert.equal(url, `https://archive.org/download/${id}/recorded%20text.pdf`);
    if (init.method === 'HEAD') return new Response(null, { headers: { 'content-type': 'application/pdf', 'content-length': String(options.actualSize ?? 6 * 1024 * 1024) } });
    return options.upstream?.() ?? new Response('%PDF-fixture', { headers: { 'content-type': 'application/pdf' } });
  };
  return { fetched, sent, reads, cached, entries, call: body => libraryPdf(post(body), '100:local-test', read, send, fetcher, options.mirror, cache) };
}

test('only explicit public-domain shelf IDs authorize Archive delivery, including cached PDFs', async () => {
  for (const archive of ['unknown', '../book', 'https://archive.org/details/book']) {
    const f = fixture();
    assert.ok([400, 404].includes((await f.call({ archive, send: true })).status));
    assert.deepEqual(f.fetched, []);
    assert.deepEqual(f.sent, []);
  }
  for (const status of ['borrow', 'library', 'none', undefined]) {
    const f = fixture({ shelf: [{ archive: id, status, title }] });
    f.entries.set(`library-pdf-file:v1:100:${id}`, 'Recorded_File_ID_1234');
    const response = await f.call(valid);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'no-pdf');
    assert.deepEqual(f.fetched, []);
    assert.deepEqual(f.sent, []);
  }
});

test('Archive requests cannot mix selectors, printed pages, arbitrary URLs or non-boolean delivery', async () => {
  for (const body of [{ archive: id }, { ...valid, slug: 'other' }, { ...valid, item: 'other' }, { ...valid, printed: 1 }, { ...valid, url: 'https://evil.test/a.pdf' }, { ...valid, send: 'true' }]) {
    const f = fixture();
    assert.equal((await f.call(body)).status, 400);
    assert.deepEqual(f.fetched, []);
    assert.deepEqual(f.sent, []);
  }
});

test('small PDFs use the recorded Text PDF address and reuse the resulting bot-scoped file ID', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.call(valid)).json(), { ok: true, sent: true });
  assert.deepEqual(f.sent, [{ document: `https://archive.org/download/${id}/recorded%20text.pdf`, filename: `${id}.pdf`, caption: title }]);
  assert.deepEqual(f.fetched.map(row => row.method), ['GET', 'HEAD']);
  assert.deepEqual(f.cached, [{ key: `library-pdf-file:v1:100:${id}`, value: 'Recorded_File_ID_1234', opts: { expirationTtl: 86400 } }]);
  f.fetched.length = 0;
  assert.equal((await f.call(valid)).status, 200);
  assert.equal(f.sent[1].document, 'Recorded_File_ID_1234');
  assert.deepEqual(f.fetched, []);
  assert.equal(f.reads.length, 2, 'the current shelf authorizes every request before a cache hit');
});

test('32 MB metadata and unknown sizes use bounded stream uploads instead of Telegram URL fetches', async () => {
  for (const size of [String(32 * 1024 * 1024), undefined]) {
    const f = fixture({ file: { ...file, size } });
    assert.equal((await f.call(valid)).status, 200);
    assert.equal(f.sent[0].uploaded, 12);
    assert.deepEqual(f.fetched.map(row => row.method), ['GET', 'GET']);
  }
});

test('metadata, actual headers and chunked bodies cannot exceed the Telegram upload limit', async () => {
  const metadata = fixture({ file: { ...file, size: String(TELEGRAM_PDF_LIMIT + 1) } });
  const headers = fixture({ actualSize: TELEGRAM_PDF_LIMIT + 1 });
  let cancelled = false;
  const chunked = fixture({ file: { ...file, size: undefined }, upstream: () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/pdf' } }) });
  for (const f of [metadata, headers, chunked]) {
    const response = await f.call(valid), body = await response.json();
    assert.equal(response.status, 413);
    assert.equal(body.sent, false);
    assert.equal(body.error, 'too-big');
    assert.deepEqual(f.cached, []);
  }
  assert.equal(cancelled, true);
});

test('missing, restricted, private and foreign-redirect PDFs return the safe fallback contract', async () => {
  for (const options of [{ metadata: { files: [] } }, { metadata: { is_dark: true } }, { metadata: { metadata: { 'access-restricted-item': 'true' } } }, { metadata: { files: [{ ...file, private: true }] } }, { redirect: 'https://evil.test/a.pdf' }]) {
    const f = fixture(options), response = await f.call(valid);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'no-pdf');
    assert.deepEqual(f.sent, []);
    assert.ok(f.fetched.every(row => new URL(row.url).hostname === 'archive.org'));
  }
});

test('an existing mirrored PDF is preferred without fetching Archive metadata', async () => {
  const f = fixture({ mirror: { head: async () => 12, get: async () => new Response('%PDF-fixture', { headers: { 'content-type': 'application/pdf' } }) } });
  assert.equal((await f.call(valid)).status, 200);
  assert.equal(f.sent[0].uploaded, 12);
  assert.deepEqual(f.fetched, []);
});

test('chat failures return the next step and never cache or retry a delivery', async () => {
  const f = fixture({ sendError: true });
  f.entries.set(`library-pdf-file:v1:100:${id}`, 'Recorded_File_ID_1234');
  const response = await f.call(valid), body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.sent, false);
  assert.match(body.message, /press Start/);
  assert.deepEqual(f.fetched, []);
  assert.equal(f.entries.size, 0);
});
