import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import { financialDb } from './helpers/financial-db.mjs';

const out = new URL('./.build/feedback.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/feedback.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { issueAnswerReceipt, recordFeedback, parseFeedback, feedbackInput, exportFeedback, deleteFeedback, sweepFeedback, worker } = await import(out);

const validId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const vote = (id, extra = {}) => ({ answer_id: id, rating: 'down', reason: 'wrong source', ...extra });
const post = (body, headers = {}) => new Request('https://example.test/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const auth = (env, id) => {
  const params = { user: JSON.stringify({ id, first_name: 'Fixture' }), auth_date: String(Math.floor(Date.now()/1000)) };
  const check = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return { authorization: `tma ${new URLSearchParams({ ...params, hash })}` };
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test('feedback schema accepts only the agreed enums, opaque receipt and safe source number', () => {
  assert.deepEqual(parseFeedback(vote(validId, { source_n: 100 })), vote(validId, { source_n: 100 }));
  for (const value of [null, [], 'text', {}, vote('client-invented'), vote(validId, { rating: ['up'] }), vote(validId, { reason: ['other'] }), vote(validId, { reason: 'private free text' }), vote(validId, { source_n: 0 }), vote(validId, { source_n: 1.5 }), vote(validId, { source_n: '1' }), vote(validId, { owner: 88 })]) assert.equal(parseFeedback(value), null, JSON.stringify(value));
});

test('body reading caps actual bytes with absent or false Content-Length', async () => {
  assert.equal((await feedbackInput(post(vote(validId)))).ok, true);
  assert.equal((await feedbackInput(post('{'))).status, 400);
  for (const headers of [{}, { 'content-length': '1' }]) assert.equal((await feedbackInput(post(' '.repeat(2049), headers))).status, 413);
  assert.equal((await feedbackInput(post(JSON.stringify({ value: 'א'.repeat(1100) })))).status, 413, 'the bound is bytes, not JavaScript characters');
});

test('server receipts are fresh, owner-bound, expire and validate sparse citation membership', async t => {
  const { env } = financialDb(t), now = Date.now();
  const id = await issueAnswerReceipt(env, 77, [{ n: 2 }, { n: 100 }], now);
  const other = await issueAnswerReceipt(env, 88, [{ n: 2 }], now);
  assert.match(id, /^[a-f0-9-]{36}$/);
  assert.notEqual(id, other);
  assert.equal(await recordFeedback(env, 77, vote(id, { source_n: 100 }), 'fixture-ip', now), 200);
  assert.equal(await recordFeedback(env, 77, vote(id, { source_n: 1 }), 'fixture-ip', now), 400, '1 is not in this registry despite being in range by array length');
  assert.equal(await recordFeedback(env, 88, vote(id), 'other-ip', now), 404);
  assert.equal(await recordFeedback(env, 77, vote(validId), 'fixture-ip', now), 404);
  assert.equal(await recordFeedback(env, 77, vote(id), 'fixture-ip', now + 31*86400_000), 404);
});

test('concurrent duplicate votes are idempotent and later changes update the same row', async t => {
  const { env, sql } = financialDb(t), now = Date.now();
  const id = await issueAnswerReceipt(env, 77, [{ n: 100 }], now);
  assert.deepEqual(await Promise.all(Array.from({ length: 6 }, () => recordFeedback(env, 77, vote(id, { source_n: 100 }), 'fixture-ip', now))), Array(6).fill(200));
  assert.equal(sql.prepare('SELECT count(*) AS n FROM ask_feedback').get().n, 1);
  assert.equal(await recordFeedback(env, 77, { answer_id: id, rating: 'up' }, 'fixture-ip', now + 1000), 200);
  const row = sql.prepare('SELECT rating, reason, source_n, created_at, updated_at FROM ask_feedback').get();
  assert.deepEqual({ ...row }, { rating: 'up', reason: null, source_n: null, created_at: now, updated_at: now + 1000 });
  await recordFeedback(env, 77, { answer_id: id, rating: 'up' }, 'fixture-ip', now + 2000);
  assert.equal(sql.prepare('SELECT updated_at FROM ask_feedback').get().updated_at, now + 1000, 'an identical replay is a no-op');
});

test('per-person and IP limits admit no concurrent request above their caps', async t => {
  const { env, sql } = financialDb(t), now = Math.floor(Date.now()/60000)*60000;
  const id = await issueAnswerReceipt(env, 77, [], now);
  const results = await Promise.all(Array.from({ length: 14 }, () => recordFeedback(env, 77, vote(id), 'fixture-ip', now)));
  assert.equal(results.filter(status => status === 200).length, 10);
  assert.equal(results.filter(status => status === 429).length, 4);
  assert.equal(await recordFeedback(env, 77, vote(id), 'fixture-ip', now + 60000), 200);
  const ipRow = sql.prepare("SELECT key FROM ask_feedback_limits WHERE key LIKE 'ip:%' ORDER BY expires_at DESC LIMIT 1").get();
  sql.prepare('UPDATE ask_feedback_limits SET n = 600 WHERE key = ?').run(ipRow.key);
  const another = await issueAnswerReceipt(env, 88, [], now);
  assert.equal(await recordFeedback(env, 88, vote(another), 'fixture-ip', now + 60000), 429);
});

test('feedback stores metadata only, exports to its owner, deletes and expires without affecting others', async t => {
  const { env, sql } = financialDb(t), now = Date.now();
  const first = await issueAnswerReceipt(env, 77, [{ n: 2 }], now);
  const second = await issueAnswerReceipt(env, 88, [], now);
  await recordFeedback(env, 77, vote(first, { source_n: 2 }), 'private-network-address', now);
  await recordFeedback(env, 88, vote(second), 'private-network-address', now);
  assert.equal((await exportFeedback(env, 77)).ratings.length, 1);
  assert.equal((await exportFeedback(env, 77)).ratings[0].answer_id, first);
  const all = JSON.stringify(sql.prepare('SELECT * FROM ask_feedback').all()) + JSON.stringify(sql.prepare('SELECT * FROM ask_answer_receipts').all()) + JSON.stringify(sql.prepare('SELECT * FROM ask_feedback_limits').all());
  assert.ok(!all.includes('private-network-address'));
  assert.ok(!all.includes('question') && !all.includes('transcript') && !all.includes('chat'));
  await deleteFeedback(env, 77);
  assert.deepEqual(await exportFeedback(env, 77), { receipts: [], ratings: [] });
  assert.equal((await exportFeedback(env, 88)).ratings.length, 1);
  await sweepFeedback(env, now + 31*86400_000);
  assert.deepEqual(await exportFeedback(env, 88), { receipts: [], ratings: [] });
});

test('storage failures hide optional receipts and fail feedback closed without inference', async t => {
  const { env, fail } = financialDb(t);
  env.AI = { run: () => { throw new Error('No inference is allowed for feedback'); } };
  fail(/CREATE TABLE/, 1);
  assert.equal(await issueAnswerReceipt(env, 77, []), undefined);
  const id = await issueAnswerReceipt(env, 77, []);
  assert.ok(id, 'initialization retries after a failed table creation');
  fail(/SELECT source_ns/, 1);
  await assert.rejects(recordFeedback(env, 77, vote(id)));
});

test('HTTP feedback requires signed identity, enforces ownership and size, and makes no external calls', async t => {
  const { env } = financialDb(t), previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Feedback must not make external requests'); };
  t.after(() => { globalThis.fetch = previous; });
  const id = await issueAnswerReceipt(env, 77, [{ n: 100 }]);
  assert.equal((await worker.fetch(post(vote(id)), env, ctx)).status, 401);
  const good = await worker.fetch(post(vote(id, { source_n: 100 }), auth(env, 77)), env, ctx);
  assert.equal(good.status, 200); assert.deepEqual(await good.json(), { ok: true });
  const foreign = await worker.fetch(post(vote(id), auth(env, 88)), env, ctx);
  const missing = await worker.fetch(post(vote(validId), auth(env, 88)), env, ctx);
  assert.equal(foreign.status, 404); assert.equal(missing.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
  assert.equal((await worker.fetch(post(' '.repeat(2049), auth(env, 77)), env, ctx)).status, 413);
  assert.equal((await worker.fetch(post(vote(id, { source_n: 1 }), auth(env, 77)), env, ctx)).status, 400);
});
