import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createServer } from 'node:http';

// The free-budget alert: the admins hear once a UTC day when free answers (settled plus still
// reserved) reach 80% of ASK_FREE_DAILY_USD_CAP. It keeps its own KV key, apart from the health state.
const out = new URL('./.build/free-budget-alert.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { alertFreeBudget, freeUsedToday, reserveFreeBudget, settleFreeBudget, FREE_BUDGET_ALERT_SHARE } from "./src/free-budget";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const NOW = Date.parse('2026-11-07T15:00:00Z');

function fixture(vars = {}) {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => ({ bind: (...a) => prepare(sql, a), first: async () => db.prepare(sql).get(...values) ?? null, all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }) });
  const kv = new Map();
  const env = { DB: { prepare, batch: async (statements) => { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } }, SUBS: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } }, BOT_TOKEN: '100:local-test', ADMIN_IDS: '11', ASK_FREE_DAILY_USD_CAP: '1.00', ...vars };
  return { env, kv };
}
async function withTelegram(fn, env, { fail = false } = {}) {
  const sent = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (fail) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error_code: 500, description: 'down' })); return; }
      sent.push(JSON.parse(body || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: { message_id: 1, date: 0, chat: { id: 11, type: 'private' } } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  env.TELEGRAM_API_ROOT = `http://127.0.0.1:${server.address().port}`;
  try { return { result: await fn(), sent }; } finally { server.close(); }
}

test('below 80% of the cap nothing is sent; a fresh database is nothing spent', async () => {
  const { env } = fixture();
  assert.deepEqual(await m.freeUsedToday(env, NOW), { settled: 0, held: 0, cap: 1_000_000 });
  await m.reserveFreeBudget(env, 'a', 0.79, NOW);
  const { result, sent } = await withTelegram(() => m.alertFreeBudget(env, NOW), env);
  assert.equal(result, 0);
  assert.equal(sent.length, 0);
});

test('settled plus reserved spend at exactly 80% tells the admins once that day, with both amounts', async () => {
  const { env, kv } = fixture();
  const hold = await m.reserveFreeBudget(env, 'a', 0.1, NOW);
  await m.settleFreeBudget(env, hold, 0.1);
  await m.reserveFreeBudget(env, 'b', 0.7, NOW);
  assert.deepEqual(await m.freeUsedToday(env, NOW), { settled: 100_000, held: 700_000, cap: 1_000_000 });
  const first = await withTelegram(() => m.alertFreeBudget(env, NOW), env);
  assert.equal(first.result, 1, '0.1 + 0.7 is 80%, not just under it');
  assert.equal(first.sent.length, 1);
  assert.equal(first.sent[0].chat_id, 11);
  assert.match(first.sent[0].text, /\$0\.80 of the \$1\.00 budget for 2026-11-07 \(80%\): \$0\.10 spent, \$0\.70 reserved/);
  assert.ok(kv.has('alert:free_budget:2026-11-07'));
  assert.ok(![...kv.keys()].some((k) => k.startsWith('health:')), 'the shared health state is untouched');
  const again = await withTelegram(() => m.alertFreeBudget(env, NOW + 15 * 60_000), env);
  assert.equal(again.sent.length, 0, 'not again the same day');
});

test('a failed send, or no admins yet, keeps no key, so the next run tries again', async () => {
  const { env, kv } = fixture();
  await m.reserveFreeBudget(env, 'a', 0.9, NOW);
  const failed = await withTelegram(() => m.alertFreeBudget(env, NOW), env, { fail: true });
  assert.equal(failed.result, 0);
  assert.ok(!kv.has('alert:free_budget:2026-11-07'), 'Telegram down: the key is cleared');
  env.ADMIN_IDS = '';
  assert.equal((await withTelegram(() => m.alertFreeBudget(env, NOW), env)).result, 0);
  assert.ok(!kv.has('alert:free_budget:2026-11-07'), 'no admins: the key is cleared');
  env.ADMIN_IDS = '11';
  const retried = await withTelegram(() => m.alertFreeBudget(env, NOW + 15 * 60_000), env);
  assert.equal(retried.result, 1);
  assert.equal(retried.sent.length, 1);
});

test('each UTC day alerts on its own; a crossing just before midnight is reported just after; a cap of 0 never alerts', async () => {
  const { env } = fixture();
  await m.reserveFreeBudget(env, 'a', 0.9, NOW);
  assert.equal((await withTelegram(() => m.alertFreeBudget(env, NOW), env)).sent.length, 1, 'day one');
  const lateNight = Date.parse('2026-11-08T23:55:00Z');
  await m.reserveFreeBudget(env, 'b', 0.85, lateNight);
  const midnight = Date.parse('2026-11-09T00:00:00Z');
  const next = await withTelegram(() => m.alertFreeBudget(env, midnight), env);
  assert.equal(next.sent.length, 1);
  assert.match(next.sent[0].text, /budget for 2026-11-08/);
  const off = fixture({ ASK_FREE_DAILY_USD_CAP: '0' });
  assert.equal((await withTelegram(() => m.alertFreeBudget(off.env, NOW), off.env)).result, 0);
});

test('a storage error is logged, never thrown into the cron', async () => {
  const { env } = fixture();
  env.DB.prepare = () => { throw new Error('D1 unavailable'); };
  env.DB.batch = async () => { throw new Error('D1 unavailable'); };
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try { assert.equal(await m.alertFreeBudget(env, NOW), 0); } finally { console.error = original; }
  assert.match(errors.join('\n'), /free_budget_alert_failed/);
});
