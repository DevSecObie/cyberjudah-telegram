import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The /mcp route on its own, in the Workers runtime, as a host such as Claude asks it.
const { outputFiles } = await build({
  stdin: {
    contents: 'import { Hono } from "hono"; import { mcp } from "./src/mcp.ts"; const app = new Hono(); app.all("/mcp", c => mcp(c.req.raw, c.env, c.executionCtx)); export default app;',
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
  loader: { '.json': 'json' },
});

const KEY = 'test-key-not-a-secret';
const books = [{ book: 'Exodus', slug: 'exodus', chapters: 40 }];
const exodus12 = { book: 'Exodus', chapter: 12, translation: 'KJV', url: '', verses: [
  { verse: 13, text: 'And the blood shall be to you for a token upon the houses where ye are:' },
  { verse: 14, text: 'And this day shall be unto you for a memorial; and ye shall keep it a feast to the LORD throughout your generations; ye shall keep it a feast by an ordinance for ever.' },
] };

function worker(bindings = { MCP_KEY: KEY }, seen = []) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { DATA_ORIGIN: 'https://data.cyberjudah.test', SITE_URL: 'https://cyberjudah.test', ...bindings },
    outboundService: (request) => {
      seen.push(request.url);
      const path = new URL(request.url).pathname;
      if (path === '/api/kjv/books.json') return Response.json(books);
      if (path === '/api/kjv/exodus/12.json') return Response.json(exodus12);
      if (path === '/api/notes/classes/2026/test-class.json') return Response.json({ title: 'Test Class', teacher: 'Bishop Nathanyel', date: '2026-10-31', videoId: 'abcdefghijk', body: 'Word for word.' });
      if (path === '/api/cases/index.json') return Response.json({ cases: [{ slug: 'edom', name: 'Edom' }] });
      if (path === '/api/cases/edom.json') return Response.json({ name: 'Edom', summary: 'The case of Edom.' });
      if (path === '/api/notes/index.json') return Response.json([
        { kind: 'class', title: 'The Passover', url: '/classes/2026/passover', teacher: 'Bishop Nathanyel', topics: ['passover'], summary: '' },
        { kind: 'class', title: 'Another class', url: '/classes/2026/other', teacher: 'Deacon Test', topics: [], summary: '' },
      ]);
      if (path === '/api/notes/classes/2026/passover.json') return Response.json({ kind: 'class', title: 'The Passover', url: '/classes/2026/passover', teacher: 'Bishop Nathanyel', date: '2026-04-01', videoId: 'abcdefghijk', body: 'An opening paragraph that greets the class and says nothing more.\n\nThe passover is a memorial kept for ever, the teacher said, word for word from the class.\n\nA closing paragraph about something else entirely, said at the end.' });
      if (path === '/api/places/index.json') return Response.json([{ id: 'goshen-gen-45-10', name: 'Goshen', names: ['Goshen'], description: 'Where Israel dwelt in Egypt (Genesis 45:10)' }]);
      if (path === '/api/places/goshen-gen-45-10.json') return Response.json({ id: 'goshen-gen-45-10', name: 'Goshen', names: ['Goshen'], description: 'Where Israel dwelt in Egypt (Genesis 45:10)', verses: ['genesis/45/10', 'exodus/8/22'] });
      if (path === '/api/concordance/exodus/12.json') return Response.json({ cited_by: [], commentary: [
        { verses: '14', passage: 'Exodus 12:14', points: ['A memorial: the feast kept for ever.'], note: { label: 'The Passover', url: '/classes/2026/passover', date: '2026-04-01', teacher: 'Bishop Nathanyel' }, ts: '1:05', video: 'abcdefghijk', t: 65 },
      ] });
      return new Response('not found', { status: 404 });
    },
  }));
}

const rpc = (mf, body, key = KEY) => mf.dispatchFetch('https://cyberjudah.test/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body),
});
// A host accepts a JSON body or an event stream; read the one message either way.
const message = async (r) => {
  const body = await r.text();
  const data = body.startsWith('{') ? body : body.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  return JSON.parse(data);
};
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };

test('/mcp answers nothing until the owner sets MCP_KEY', async () => {
  const mf = worker({});
  try {
    const r = await rpc(mf, init);
    assert.equal(r.status, 404);
  } finally { await mf.dispose(); }
});

test('/mcp turns away a request without the key, or with the wrong one', async () => {
  const mf = worker();
  try {
    for (const key of ['', 'wrong-key']) {
      const r = await rpc(mf, init, key);
      assert.equal(r.status, 401, `key ${JSON.stringify(key)}`);
      assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer/);
    }
  } finally { await mf.dispose(); }
});

test('/mcp lists only read tools, and reads a passage word for word with its link', async () => {
  const seen = [];
  const mf = worker({ MCP_KEY: KEY }, seen);
  try {
    const hello = await rpc(mf, init);
    assert.equal(hello.status, 200, await hello.clone().text());
    const info = await message(hello);
    assert.equal(info.result.serverInfo.name, 'cyberjudah');
    assert.match(info.result.instructions, /Never quote Scripture or a class from memory/);

    const listed = await message(await rpc(mf, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const names = listed.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['commentary', 'law', 'look_up_word', 'person', 'precepts', 'read_data', 'read_note', 'read_passage', 'read_resource', 'read_transcript', 'search_classes', 'search_library', 'timeline', 'verse_study']);
    for (const t of listed.result.tools) {
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
    }

    const read = await message(await rpc(mf, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_passage', arguments: { reference: 'Exodus 12:14' } } }));
    const text = read.result.content[0].text;
    assert.equal(read.result.isError, undefined);
    assert.match(text, /^Exodus 12:14 \(KJV\)\n14 And this day shall be unto you for a memorial;/);
    assert.doesNotMatch(text, /token upon the houses/);
    assert.match(text, /Link: https:\/\/cyberjudah\.test\/bible\/exodus\/12$/);
    assert.ok(seen.every((u) => u.startsWith('https://data.cyberjudah.test/')), seen.join(', '));

    const bad = await message(await rpc(mf, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_passage', arguments: { reference: 'Hezekiah 4:1' } } }));
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /not a reference this Bible has/);
  } finally { await mf.dispose(); }
});

test('/mcp reads any public note or data file, and nothing outside them', async () => {
  const seen = [];
  const mf = worker({ MCP_KEY: KEY }, seen);
  try {
    await rpc(mf, init);
    const call = async (name, args) => (await message(await rpc(mf, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }))).result;

    const note = await call('read_note', { path: '/classes/2026/test-class' });
    assert.equal(note.isError, undefined);
    assert.match(note.content[0].text, /title: Test Class\nteacher: Bishop Nathanyel/);
    assert.match(note.content[0].text, /Video: https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/);
    assert.match(note.content[0].text, /Word for word\.$/);

    const data = await call('read_data', { path: 'api/cases/index.json' });
    assert.deepEqual(JSON.parse(data.content[0].text), { cases: [{ slug: 'edom', name: 'Edom' }] });

    // A case file with most fields missing once sent the reader into a 19^7 recursion.
    const started = Date.now();
    const found = await call('search_library', { resource: 'cases', query: 'Edom' });
    assert.equal(found.isError, undefined, found.content[0].text);
    assert.match(found.content[0].text, /^Edom\nEdom\nThe case of Edom\.\nLink: https:\/\/cyberjudah\.test\/cases\/edom$/);
    assert.ok(Date.now() - started < 5000);

    // Only the public data site's own files: no climbing out, no other host.
    for (const path of ['api/../secrets.json', 'https://evil.test/api/x.json', '/api/cases/index.json', 'api/cases/index']) {
      const r = await call('read_data', { path });
      assert.equal(r.isError, true, path);
    }
    for (const path of ['/classes/../../admin', 'classes/2026/x', '//evil.test/x']) {
      const r = await call('read_note', { path });
      assert.equal(r.isError, true, path);
    }
    assert.ok(seen.every((u) => u.startsWith('https://data.cyberjudah.test/')), seen.join(', '));
  } finally { await mf.dispose(); }
});

test('Ask research reads the commentary, the whole class notes and the places', async () => {
  const mf = worker();
  try {
    await rpc(mf, init);
    const call = async (args) => (await message(await rpc(mf, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_library', arguments: args } }))).result;

    const commentary = await call({ resource: 'commentary', query: 'Exodus 12:14' });
    assert.equal(commentary.isError, undefined, commentary.content[0].text);
    assert.match(commentary.content[0].text, /A memorial: the feast kept for ever\./);
    assert.match(commentary.content[0].text, /Bishop Nathanyel/);
    assert.match(commentary.content[0].text, /Link: https:\/\/cyberjudah\.test\/classes\/2026\/passover$/m);

    const notes = await call({ resource: 'class-notes', query: 'passover memorial' });
    assert.equal(notes.isError, undefined, notes.content[0].text);
    assert.match(notes.content[0].text, /^The Passover · Bishop Nathanyel · class notes \(2026-04-01\)\nThe passover is a memorial kept for ever/);
    assert.doesNotMatch(notes.content[0].text, /greets the class|closing paragraph/);

    const place = await call({ resource: 'places', query: 'Goshen' });
    assert.equal(place.isError, undefined, place.content[0].text);
    assert.match(place.content[0].text, /Where Israel dwelt in Egypt/);
    assert.match(place.content[0].text, /Named in genesis 45:10; exodus 8:22\./);
    assert.match(place.content[0].text, /Link: https:\/\/cyberjudah\.test\/bible\/genesis\/45#v10$/m);
  } finally { await mf.dispose(); }
});
