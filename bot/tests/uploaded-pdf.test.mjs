import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/uploaded-pdf.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/library-pdf.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { libraryPdf } = await import(out);
const limit = 10 * 1024 * 1024;
const pdf = Buffer.from('%PDF-1.7\nExisting note or answer words.');
const valid = { send: true, upload: { kind: 'answer', name: 'Recorded title.pdf', data: pdf.toString('base64') } };
const post = body => new Request('https://cyberjudah.test/api/library/pdf', { method: 'POST', body: JSON.stringify(body) });

function fixture(options = {}) {
  const sent = [];
  let checked = 0;
  const forbidden = async () => { throw new Error('Uploads must not read, fetch or cache library content'); };
  const send = async (stream, name, caption) => {
    if (options.sendError) throw new Error('chat not found');
    sent.push({ data: Buffer.from(await new Response(stream).arrayBuffer()), name, caption });
  };
  const allow = options.noLimiter ? undefined : async () => { checked++; if (options.limitError) throw new Error('limiter unavailable'); return !options.blocked; };
  return { sent, checked: () => checked, call: body => libraryPdf(body instanceof Request ? body : post(body), '100:test', forbidden, send, forbidden, undefined, { get: forbidden, put: forbidden, delete: forbidden }, allow) };
}

test('note and answer PDFs are uploaded byte-for-byte without reading or storing library data', async () => {
  for (const kind of ['note', 'answer']) {
    const f = fixture(), response = await f.call({ ...valid, upload: { ...valid.upload, kind } });
    assert.deepEqual(await response.json(), { ok: true, sent: true });
    assert.equal(f.checked(), 1);
    assert.deepEqual(f.sent[0], { data: pdf, name: 'Recorded title.pdf', caption: 'Recorded title' });
  }
});

test('uploads cannot supply a different chat, mixed library selectors or extra document fields', async () => {
  for (const body of [{ ...valid, chat_id: 999 }, { ...valid, archive: 'other' }, { ...valid, slug: 'other' }, { ...valid, send: false }, { ...valid, upload: { ...valid.upload, chat_id: 999 } }, { ...valid, upload: { ...valid.upload, kind: 'book' } }]) {
    const f = fixture(), response = await f.call(body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).sent, false);
    assert.deepEqual(f.sent, []);
  }
});

test('filenames remove header injection and path syntax and always end in pdf', async () => {
  const f = fixture();
  assert.equal((await f.call({ ...valid, upload: { ...valid.upload, name: '../../A";\r\nname\\answer.exe' } })).status, 200);
  assert.match(f.sent[0].name, /\.pdf$/);
  assert.doesNotMatch(f.sent[0].name, /[\\/";\x00-\x1f]|\.\./);
});

test('non-PDF bytes, malformed base64 and noncanonical padding never reach Telegram', async () => {
  for (const data of ['', 'abc', 'JVBE=Ri0=', 'JVBERi0*', 'JVBERi1=', Buffer.from('not a PDF').toString('base64')]) {
    const f = fixture(), response = await f.call({ ...valid, upload: { ...valid.upload, data } });
    assert.equal(response.status, 400, data);
    assert.deepEqual(f.sent, []);
  }
});

test('the decoded ten-megabyte boundary is accepted, and one extra byte is refused', async () => {
  const bytes = Buffer.alloc(limit);
  pdf.copy(bytes);
  const f = fixture();
  assert.equal((await f.call({ ...valid, upload: { ...valid.upload, data: bytes.toString('base64') } })).status, 200);
  assert.deepEqual(f.sent[0].data, bytes);
  const rejected = fixture();
  const response = await rejected.call({ ...valid, upload: { ...valid.upload, data: Buffer.concat([bytes, Buffer.of(0)]).toString('base64') } });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'too-big');
  assert.deepEqual(rejected.sent, []);
});

test('a streamed request without Content-Length is cancelled at the encoded-body limit', async () => {
  let cancelled = false;
  const request = new Request('https://cyberjudah.test/api/library/pdf', { method: 'POST', duplex: 'half', body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }) });
  const f = fixture(), response = await f.call(request);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).sent, false);
  assert.equal(cancelled, true);
  assert.deepEqual(f.sent, []);
});

test('blocked, missing and failed per-person limiters fail closed before a chat send', async () => {
  for (const options of [{ blocked: true }, { noLimiter: true }, { limitError: true }]) {
    const f = fixture(options), response = await f.call(valid), body = await response.json();
    assert.equal(response.status, options.blocked ? 429 : 503);
    assert.equal(body.sent, false);
    assert.ok(body.message);
    assert.deepEqual(f.sent, []);
    if (options.blocked) assert.equal(response.headers.get('retry-after'), '60');
  }
});

test('a refused chat send gives a next step without exposing or retaining the PDF', async () => {
  const f = fixture({ sendError: true }), response = await f.call(valid), body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'chat-unavailable');
  assert.match(body.message, /press Start/);
  assert.deepEqual(f.sent, []);
});
