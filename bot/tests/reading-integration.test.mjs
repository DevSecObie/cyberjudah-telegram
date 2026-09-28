import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildSync } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const output = join(mkdtempSync(join(tmpdir(), 'cj-reading-test-')), 'reading.cjs');
buildSync({ entryPoints: [new URL('../src/reading.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: output, logLevel: 'silent' });
const { sendReading, reading } = createRequire(import.meta.url)(output);
const catalog = [{ book: 'Genesis', slug: 'genesis', chapters: 8, chapterIds: [1,2,3,4,5,6,7,8] }];
globalThis.caches = { default: { match: async () => new Response(JSON.stringify(catalog)) } };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../reading.sql', import.meta.url), 'utf8'));
  const env = { BOT_TOKEN: 'test-token', WORKER_URL: 'https://example.com', DATA_ORIGIN: 'https://data.example.com', SUBS: { get: async () => null }, DB: { prepare(sql) {
    const statement = sqlite.prepare(sql); let values = [];
    const self = { bind(...args) { values = args; return self; }, async all() { return { results: statement.all(...values) }; }, async first() { return statement.get(...values) ?? null; }, async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; } }; return self;
  } } };
  return { sqlite, env };
}
test('cron requires opt-in, skips completed goals, and claims delivery only once', async () => {
  const { sqlite, env } = fixture(), sent = [];
  const api = { sendMessage: async (...args) => sent.push(args) };
  sqlite.exec("INSERT INTO reading_settings VALUES(1,'America/New_York','08:00',1,0),(2,'UTC','12:00',0,0),(3,'UTC','12:00',1,0)");
  for (let chapter=1; chapter<=4; chapter++) sqlite.prepare('INSERT INTO reading_log VALUES(3,?,?,?)').run('genesis', chapter, '2026-09-29');
  const now = new Date('2026-09-29T12:00:00Z');
  await sendReading(env, now, api); await sendReading(env, now, api);
  assert.equal(sent.length, 1); assert.equal(sent[0][0], 1); assert.match(sent[0][1], /Study, Pray, Apply!/);
  sqlite.close();
});
test('Monday recap covers the previous seven local dates and combines with reminder', async () => {
  const { sqlite, env } = fixture(), sent = [];
  sqlite.exec("INSERT INTO reading_settings VALUES(1,'UTC','08:00',1,1)");
  for (const day of ['2026-09-20','2026-09-21','2026-09-27','2026-09-28']) sqlite.prepare('INSERT INTO reading_log VALUES(1,?,?,?)').run('genesis', 1, day);
  await sendReading(env, new Date('2026-09-28T08:00:00Z'), { sendMessage: async (...args) => sent.push(args) });
  assert.equal(sent.length, 1); assert.match(sent[0][1], /2 chapters across 2 days/);
  assert.match(sent[0][1], /1\/4 complete/); sqlite.close();
});
test('API scopes writes to the authenticated user and rejects invalid chapters', async () => {
  const { sqlite, env } = fixture();
  // Route middleware must precede routes, so wrap the router with its normal authenticated context.
  const { Hono } = await import('hono');
  const app = new Hono(); app.use('*', async (c, next) => { c.set('tma', { user: { id: 42 } }); await next(); }); app.route('/api/reading', reading);
  const post = value => app.request('/api/reading/chapter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }, env);
  assert.equal((await post({ slug: 'genesis', chapter: 999, read: true })).status, 400);
  assert.equal((await post({ user_id: 7, slug: 'genesis', chapter: 1, read: true })).status, 200);
  assert.equal((await post({ slug: 'genesis', chapter: 1, read: true })).status, 200);
  const rows = sqlite.prepare('SELECT * FROM reading_log').all(); assert.equal(rows.length, 1); assert.equal(rows[0].user_id, 42);
  assert.equal((await post({ slug: 'genesis', chapter: 1, read: false })).status, 200);
  assert.equal(sqlite.prepare('SELECT * FROM reading_log').all().length, 0); sqlite.close();
});
