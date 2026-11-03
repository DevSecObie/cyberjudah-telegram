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
    assert.deepEqual(names, ['law', 'look_up_word', 'person', 'precepts', 'read_passage', 'search_classes', 'timeline', 'verse_study']);
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
