import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { financialDb } from './helpers/financial-db.mjs';

const out = new URL('./.build/semantic-search.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/semantic-search.ts"; export {default as worker} from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname }, outfile: out, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'error', plugins: [{ name: 'public-records', setup(b) {
  b.onResolve({ filter: /^\.\/data$/ }, args => args.importer.endsWith('/semantic-search.ts') ? { path: 'public-records', namespace: 'fixture' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: 'export async function dataJson(env,path) { env.reads.push(path); await env.beforeRead?.(path); if (env.failReads?.includes(path)) throw new Error("fixture read failed"); return env.records[path] ?? null; }' }));
} }] });
const { semanticOptions, semanticHits, SEMANTIC_MIN_SCORE, worker } = await import(out);
const video = 'abcdefghijk';
const opts = (q = 'recorded words', kinds) => semanticOptions(new URLSearchParams({ q, ...(kinds ? { kinds } : {}) }));
const match = (kind, url, extra = {}, score = 0.9) => ({ id: `${kind}:${url}`, score, metadata: { kind, url, title: 'Recorded title', text: 'Original public recorded words copied exactly from this test fixture, with enough additional recorded words to represent a complete spoken chunk.', ...extra } });
function fixture(t) {
  const { env, sql } = financialDb(t), calls = [], queries = [];
  Object.assign(env, { SITE_URL: 'https://cyberjudah.io', reads: [], records: {
    '/api/kjv/books.json': [{ book: 'John', slug: 'john', chapters: 21 }],
    '/api/kjv/john/11.json': { book: 'John', chapter: 11, translation: 'KJV', verses: [{ verse: 35, text: 'Jesus wept.' }] },
    '/api/notes/index.json': [{ kind: 'class', title: 'Recorded title', url: '/classes/recorded', videoId: video, teacher: 'Recorded teacher', date: '2012-01-01' }, { kind: 'study', title: 'Recorded study', url: '/study/recorded' }],
    '/api/laws/2A.json': { title: 'Recorded section', url: '/law/recorded/2a', entries: [{ id: '2A.1', text: 'Exact existing law entry.', citation: 'Recorded citation' }] },
    '/api/cases/index.json': { cases: [{ name: 'Recorded case', era: 'Recorded era', verdict: 'Recorded verdict', url: '/cases/recorded/case' }] },
    '/api/precepts/index.json': [{ title: 'Recorded precept', refs: 3, url: '/precepts/recorded' }],
  }, AI: { run: async (model, input, options) => { calls.push({ model, input, options }); return { data: [Array(1024).fill(0.1)] }; } }, VEC: { query: async (vector, options) => { queries.push({ vector, options }); return { matches: env.matches ?? [] }; } } });
  return { env, sql, calls, queries };
}
const signal = () => new AbortController().signal;

test('query bounds, normalized cache inputs, known kinds and capped result counts', () => {
  assert.equal(opts('  REcorded   Words ').q, 'recorded words');
  assert.deepEqual(opts('words', 'verse,class,verse').kinds, ['class', 'verse']);
  assert.equal(semanticOptions(new URLSearchParams('q=words&limit=1000')).limit, 30);
  for (const query of ['q=x', `q=${'x'.repeat(401)}`, 'q=words&kinds=word', 'q=words&kinds=', 'q=words&limit=0', 'q=words&limit=1.5']) assert.equal(semanticOptions(new URLSearchParams(query)), null);
});

test('all six keyword hit shapes use public records, keep short KJV text and actual class start', async t => {
  const f = fixture(t);
  f.env.matches = [match('verse', '/bible/john/11#v35', { text: 'Truncated vector text must not become Scripture.' }), match('spoken', '/classes/recorded', { video, t: 45.5, teacher: 'Unrecorded name' }), match('study', '/study/recorded'), match('law', '/law/recorded/2a#2A.1'), match('case', '/cases/recorded/case'), match('precept', '/precepts/recorded')];
  const hits = await semanticHits(f.env, opts(), signal());
  assert.deepEqual(hits.map(h => h.kind), ['verse', 'class', 'study', 'law', 'case', 'precept']);
  assert.deepEqual(hits[0], { kind: 'verse', book: 'John', slug: 'john', chapter: 11, verse: 35, text: 'Jesus wept.', score: 0.9 });
  assert.equal(hits[1].teacher, 'Recorded teacher'); assert.equal(hits[1].date, '2012-01-01'); assert.equal(hits[1].t, 45.5);
  assert.equal(hits[1].snippet, f.env.matches[1].metadata.text);
  assert.equal(hits[3].text, 'Exact existing law entry.'); assert.equal(hits[3].citation, 'Recorded citation');
  assert.equal(hits[4].verdict, 'Recorded verdict'); assert.equal(hits[5].refs, 3);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].model, '@cf/baai/bge-m3');
  assert.deepEqual(f.calls[0].input, { text: ['recorded words'] });
  assert.deepEqual(f.queries[0].options, { topK: 50, returnMetadata: 'all', returnValues: false });
  assert.ok(!JSON.stringify(f.calls[0].input).includes('Original public'), 'retrieved text is never sent to a generation model');
});

test('cutoff, kind filtering, public-only output and recording deduplication keep the best moment', async t => {
  const f = fixture(t);
  f.env.matches = [match('spoken', '/classes/recorded', { video, t: 180 }, 0.7), match('spoken', '/classes/recorded', { video, t: 45 }, 0.95), match('verse', '/bible/john/11#v35', {}, SEMANTIC_MIN_SCORE - 0.001), match('private-chat', '/classes/private', { secret: 'private fixture' }, 0.99), match('spoken', '', { video, t: 'not recorded' }, 0.99), match('case', 'https://evil.example/cases/recorded/case', {}, 0.99)];
  const hits = await semanticHits(f.env, opts('words', 'class'), signal());
  assert.equal(hits.length, 1); assert.equal(hits[0].t, 45);
  assert.ok(!JSON.stringify(hits).includes('private fixture'));
  f.env.matches = [match('study', '/study/../private', {}, 0.99), match('verse', '/bible/john/11#v35', {}, 0.2)];
  assert.deepEqual(await semanticHits(f.env, opts(), signal()), []);
});

test('missing verse records are omitted and conflicting teacher metadata never names a teacher', async t => {
  const f = fixture(t);
  f.env.records['/api/notes/index.json'].push({ videoId: video, url: '/classes/other', teacher: 'Conflicting record', date: '2013-01-01' });
  f.env.matches = [match('verse', '/bible/john/11#v99'), match('spoken', '', { video, t: 60 })];
  const hits = await semanticHits(f.env, opts(), signal());
  assert.equal(hits.length, 1); assert.equal(hits[0].teacher, ''); assert.equal(hits[0].date, null);
  assert.equal(f.env.reads.filter(p => p === '/api/kjv/books.json').length, 1);
});

test('results cap at thirty; a recorded video without a page URL keeps its real start time', async t => {
  const f = fixture(t);
  f.env.records['/api/notes/index.json'].push(...Array.from({ length: 50 }, (_, i) => ({ kind: 'study', title: `Study ${i}`, url: `/study/recorded-${i}` })));
  f.env.matches = Array.from({ length: 50 }, (_, i) => match('study', `/study/recorded-${i}`));
  assert.equal((await semanticHits(f.env, semanticOptions(new URLSearchParams('q=words&limit=1000')), signal())).length, 30);
  f.env.records['/api/notes/index.json'] = [{ kind: 'class', title: 'Recorded title', videoId: video }];
  f.env.matches = [match('spoken', '', { video, t: 123.5 })];
  const hit = (await semanticHits(f.env, opts(), signal()))[0];
  assert.equal(hit.t, 123.5); assert.equal(hit.url, `https://www.youtube.com/watch?v=${video}&t=123s`); assert.equal(hit.teacher, '');
});

const auth = (env, id = 77) => {
  const data = { user: JSON.stringify({ id, first_name: 'Fixture' }), auth_date: String(Math.floor(Date.now()/1000)) };
  const check = Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('\n');
  const hash = createHmac('sha256', createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest()).update(check).digest('hex');
  return `tma ${new URLSearchParams({ ...data, hash })}`;
};
function cache(t) {
  const before = globalThis.caches, values = new Map();
  globalThis.caches = { default: { match: async key => values.get(String(key))?.clone(), put: async (key, response) => { values.set(String(key), response.clone()); } } };
  t.after(() => { globalThis.caches = before; }); return values;
}
async function get(env, q = 'recorded words', headers = {}, limit) {
  const pending = [];
  const response = await worker.fetch(new Request(`https://example.test/api/search/semantic?${new URLSearchParams({ q, ...(limit ? { limit } : {}) })}`, { headers: { authorization: auth(env), ...headers } }), env, { waitUntil: p => pending.push(p), passThroughOnException() {} });
  await Promise.all(pending); return response;
}

test('real HTTP auth precedes cache and inference; cache normalizes q and contains only public hits', async t => {
  const f = fixture(t), values = cache(t); f.env.matches = [match('verse', '/bible/john/11#v35')];
  assert.equal((await get(f.env, 'recorded words', { authorization: '' })).status, 401); assert.equal(f.calls.length, 0);
  const first = await get(f.env); assert.equal(first.status, 200); assert.equal((await first.json())[0].text, 'Jesus wept.');
  const cached = await get(f.env, '  REcorded   Words  ');
  assert.equal(cached.status, 200); assert.equal(f.calls.length, 1);
  assert.equal(cached.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(cached.headers.get('cache-control'), 'private, no-store');
  assert.equal((await get(f.env, 'recorded words', { authorization: '' })).status, 401);
  assert.equal(values.size, 1); assert.ok(![...values.keys()][0].includes('recorded'));
});

test('signed users are limited even for cache hits; IP counters do not keep plaintext addresses', async t => {
  const f = fixture(t); cache(t);
  const now = Date.now; Date.now = () => 1794052800000; t.after(() => { Date.now = now; });
  for (let i = 0; i < 10; i++) assert.equal((await get(f.env, 'words', { 'cf-connecting-ip': '192.0.2.9' })).status, 200);
  assert.equal((await get(f.env, 'words', { 'cf-connecting-ip': '192.0.2.9' })).status, 429);
  assert.equal(f.calls.length, 1);
  assert.ok(!JSON.stringify(f.sql.prepare('SELECT key FROM rate_counts').all()).includes('192.0.2.9'));
});

test('invalid queries run nothing; inference/index failures use the agreed 503 contract', async t => {
  const f = fixture(t); cache(t);
  assert.equal((await get(f.env, 'x')).status, 400); assert.equal(f.calls.length, 0);
  f.env.VEC.query = async () => { throw new Error('private provider error'); };
  const down = await get(f.env); assert.equal(down.status, 503); assert.deepEqual(await down.json(), { error: 'semantic-unavailable' });
  f.env.AI.run = async () => ({ data: [[1, 2, 3]] });
  assert.equal((await get(f.env, 'different query')).status, 503);
});

test('IP rejection does not spend the person counter and the daily allowance is bounded', async t => {
  const f = fixture(t); cache(t);
  await get(f.env, 'words', { 'cf-connecting-ip': '192.0.2.10' });
  f.sql.prepare("UPDATE rate_counts SET n = 6000 WHERE key LIKE 'semantic_ip:%'").run();
  const before = f.sql.prepare("SELECT n FROM rate_counts WHERE key LIKE 'semantic_person:%'").get().n;
  assert.equal((await get(f.env, 'words', { 'cf-connecting-ip': '192.0.2.10' })).status, 429);
  assert.equal(f.sql.prepare("SELECT n FROM rate_counts WHERE key LIKE 'semantic_person:%'").get().n, before);
  f.sql.prepare("UPDATE rate_counts SET n = 200 WHERE key LIKE 'semantic_day:%'").run();
  assert.equal((await get(f.env, 'words')).status, 429);
  assert.equal(f.calls.length, 1);
});


test('through the Mini App relay, a signed reader address gets its own counter; unsigned ones share the relay', async t => {
  const f = fixture(t); cache(t);
  f.env.MINIAPP_CLIENT_IP_KEY = 'relay-key';
  const relay = { 'cf-connecting-ip': '203.0.113.9' };
  const signed = (ip, ts = Math.floor(Date.now() / 1000)) => ({ ...relay, 'x-cj-client-ip': ip, 'x-cj-client-ts': String(ts), 'x-cj-client-sig': createHmac('sha256', 'relay-key').update(`${ip}|${ts}|GET|/api/search/semantic`).digest('hex') });
  await get(f.env, 'words', relay);
  f.sql.prepare("UPDATE rate_counts SET n = 6000 WHERE key LIKE 'semantic_ip:%'").run();
  assert.equal((await get(f.env, 'words', relay)).status, 429, 'the relay address is spent');
  assert.equal((await get(f.env, 'words', { ...relay, 'x-cj-client-ip': '198.51.100.7' })).status, 429, 'an unsigned claim counts the relay');
  assert.equal((await get(f.env, 'words', signed('198.51.100.7'))).status, 200, 'a signed reader is counted on its own');
  const keys = f.sql.prepare("SELECT key FROM rate_counts WHERE key LIKE 'semantic_ip:%'").all().map(r => r.key);
  assert.equal(keys.length, 2);
  assert.ok(keys.every(k => !k.includes('198.51.100.7') && !k.includes('203.0.113.9')), 'no plaintext address');
});

test('a signed reader address is held at 600 a minute; the unsigned relay keeps 6000, safe in any deploy order', async t => {
  const f = fixture(t); cache(t);
  f.env.MINIAPP_CLIENT_IP_KEY = 'relay-key';
  const relay = { 'cf-connecting-ip': '203.0.113.9' };
  const signed = (ip, ts = Math.floor(Date.now() / 1000)) => ({ ...relay, 'x-cj-client-ip': ip, 'x-cj-client-ts': String(ts), 'x-cj-client-sig': createHmac('sha256', 'relay-key').update(`${ip}|${ts}|GET|/api/search/semantic`).digest('hex') });
  await get(f.env, 'words', relay);
  await get(f.env, 'words', signed('198.51.100.7'));
  f.sql.prepare("UPDATE rate_counts SET n = 600 WHERE key LIKE 'semantic_ip:%'").run();
  f.sql.prepare("UPDATE rate_counts SET n = 0 WHERE key LIKE 'semantic_person:%'").run();
  assert.equal((await get(f.env, 'words', relay)).status, 200, 'the unsigned relay is not cut to a tenth');
  assert.equal((await get(f.env, 'words', signed('198.51.100.7'))).status, 429, 'a signed reader network stops at 600');
});

test('short hydrated KJV verses stay; five-word spoken scraps and retracted pages do not', async t => {
  const f = fixture(t);
  f.env.matches = [match('verse', '/bible/john/11#v35'), match('spoken', '/classes/recorded', { video, t: 3, text: 'These are five spoken words.' }), match('study', '/study/retracted'), match('spoken', '/classes/retracted', { video, t: 15 })];
  const hits = await semanticHits(f.env, opts(), signal());
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'Jesus wept.');
  f.env.records['/api/notes/index.json'] = [];
  f.env.matches = [match('spoken', '', { video, t: 15 })];
  assert.deepEqual(await semanticHits(f.env, opts(), signal()), [], 'an unlisted video cannot revive a removed class');
});

test('tiny cosine rounding excess clamps to one while invalid scores are omitted', async t => {
  const f = fixture(t);
  f.env.matches = [match('verse', '/bible/john/11#v35', {}, 1 + 1e-8), match('study', '/study/recorded', {}, 1.1)];
  const hits = await semanticHits(f.env, opts(), signal());
  assert.equal(hits.length, 1); assert.equal(hits[0].score, 1);
});

test('individual failed hydration drops only its hits and never caches the partial response', async t => {
  const f = fixture(t), values = cache(t);
  f.env.matches = [match('verse', '/bible/john/11#v35'), match('case', '/cases/recorded/case')];
  f.env.failReads = ['/api/cases/index.json'];
  const first = await get(f.env);
  assert.equal(first.status, 200); assert.deepEqual((await first.json()).map(hit => hit.kind), ['verse']);
  assert.equal(values.size, 0);
  f.env.failReads = [];
  const recovered = await get(f.env);
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).length, 2);
  assert.equal(values.size, 1); assert.equal(f.calls.length, 2);
});

test('public hydration reads overlap, share memo entries, and never exceed the read bound', async t => {
  const f = fixture(t); let active = 0, maximum = 0;
  f.env.beforeRead = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; };
  f.env.matches = [match('verse', '/bible/john/11#v35'), match('study', '/study/recorded'), match('case', '/cases/recorded/case'), match('precept', '/precepts/recorded')];
  assert.equal((await semanticHits(f.env, opts(), signal())).length, 4);
  assert.ok(maximum > 1, 'reads run in parallel instead of waiting for each record');
  assert.equal(new Set(f.env.reads).size, f.env.reads.length, 'concurrent reads use the same memo promise');
  f.env.reads.length = 0;
  f.env.matches = Array.from({ length: 50 }, (_, i) => match('verse', `/bible/john/${i + 1}#v1`));
  await semanticHits(f.env, opts(), signal());
  assert.ok(f.env.reads.length <= 32);
});
