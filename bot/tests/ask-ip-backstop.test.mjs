import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { signInitData } from '../src/initdata.mjs';
import { keyedHash } from '../src/privacy.mjs';

// The per-IP Ask backstop (ASK_IP_DAILY_LIMIT) counts the reader's own address when the Mini App's
// Worker signs it (MINIAPP_CLIENT_IP_KEY, client-ip.ts), and the connecting address otherwise.
// A header the caller sends without a valid signature changes nothing.
const out = new URL('./.build/ask-ip-backstop.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { default as worker } from "./src/index.ts"; export { signedClientIp, clientIp, clientAddress } from "./src/client-ip.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const nowS = () => Math.floor(Date.now() / 1000);
const KEY = 'miniapp-client-ip-test-key';
const PROXY = '203.0.113.9', READER = '198.51.100.7';
const day = () => new Date().toISOString().slice(0, 10);
// Counters are keyed on a keyed hash of the address (PRIVACY_KEY), never the address itself.
const ipKey = async (ip) => `ask_ip:${await keyedHash({ PRIVACY_KEY: 'ask-ip-test' }, 'ask_ip', ip)}:${day()}`;
const launch = (id = 77) => signInitData({ user: { id, first_name: 'Telegram reader' }, auth_date: nowS() }, '100:local-test');
const sign = ({ ip = READER, ts = nowS(), method = 'POST', path = '/api/ask', key = KEY } = {}) => ({
  'x-cj-client-ip': ip, 'x-cj-client-ts': String(ts), 'x-cj-client-sig': createHmac('sha256', Buffer.from(key, 'utf8')).update(`${ip}|${ts}|${method}|${path}`).digest('hex'),
});

async function fixture(vars = {}) {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => ({ bind: (...a) => prepare(sql, a), first: async () => db.prepare(sql).get(...values) ?? null, all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }) });
  const kv = new Map();
  const env = { DB: { prepare, batch: async (statements) => { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } }, SUBS: { get: async (k, type) => kv.has(k) ? type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } }, BOT_TOKEN: '100:local-test', PRIVACY_KEY: 'ask-ip-test', ASK_BILLING: 'on', ASK_USD_PER_STAR: '0.013', ASK_IP_DAILY_LIMIT: '1000', MINIAPP_CLIENT_IP_KEY: KEY, ...vars };
  // The relay's own address has already used the whole day's backstop.
  db.exec('CREATE TABLE rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)');
  db.prepare('INSERT INTO rate_counts (key, n) VALUES (?, ?)').run(await ipKey(PROXY), 1000);
  const count = async (ip) => db.prepare('SELECT n FROM rate_counts WHERE key = ?').get(await ipKey(ip))?.n ?? 0;
  const spend = async (ip) => db.prepare('INSERT OR REPLACE INTO rate_counts (key, n) VALUES (?, 1000)').run(await ipKey(ip));
  // No stored key may hold an address in the clear.
  const rawKeys = () => db.prepare('SELECT key FROM rate_counts').all().map((r) => r.key).filter((k) => /\d+\.\d+\.\d+\.\d+|:[0-9a-f]*::/.test(k.replace(/:\d{4}-\d{2}-\d{2}$/, '')));
  return { env, count, spend, rawKeys };
}
const ask = async (env, headers, path = '/api/ask') => m.worker.fetch(new Request(`https://test${path}?x=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': PROXY, authorization: `tma ${await launch()}`, ...headers }, body: JSON.stringify({ q: 'hi' }) }), env, { waitUntil() {} });
const ipLimited = async (res) => res.status === 429 && (await res.clone().json()).error === 'limit';
// Past the backstop, ask() runs and (with no consent on file) answers 428 consent: proof the request reached it.
const reachedAsk = async (res) => res.status === 428 && (await res.clone().json()).reason === 'consent';

test('a signed reader address is counted instead of the relay, and reaches the ask', async () => {
  const { env, count, rawKeys } = await fixture();
  const res = await ask(env, sign());
  assert.equal(await reachedAsk(res), true, `got ${res.status} ${await res.clone().text()}`);
  assert.ok(!(await res.clone().text()).includes(READER), 'the reply never echoes the address');
  assert.equal(await count(READER), 1, 'the reader address is counted');
  assert.equal(await count(PROXY), 1000, 'the relay address is untouched');
  assert.deepEqual(rawKeys(), [], 'only hashed addresses are stored');
});

test('a signed reader address whose own backstop is spent is held', async () => {
  const { env, spend } = await fixture();
  await spend(READER);
  assert.equal(await ipLimited(await ask(env, sign())), true);
});

test('Telegram launch data alone is not exempt: unsigned, it counts the connecting address', async () => {
  const { env, count } = await fixture();
  assert.equal(await ipLimited(await ask(env, {})), true);
  assert.equal(await count(PROXY), 1001);
});

test('a header the caller sends without a valid signature changes nothing', async () => {
  const { env, count } = await fixture();
  const cases = {
    'claimed address only': { 'x-cj-client-ip': READER, 'x-forwarded-for': READER, 'x-real-ip': READER },
    'wrong key': sign({ key: 'guessed' }),
    'signed for another address': { ...sign(), 'x-cj-client-ip': '198.51.100.8' },
    'signed for another path': sign({ path: '/api/search' }),
    'signed for another method': sign({ method: 'GET' }),
    'signed with the query': sign({ path: '/api/ask?x=1' }),
    'stale': sign({ ts: nowS() - 120 }),
    'from the future': sign({ ts: nowS() + 120 }),
    'uppercase hex': Object.fromEntries(Object.entries(sign()).map(([k, v]) => [k, k === 'x-cj-client-sig' ? v.toUpperCase() : v])),
    'not an address': sign({ ip: 'not-an-ip' }),
  };
  for (const [name, headers] of Object.entries(cases)) assert.equal(await ipLimited(await ask(env, headers)), true, name);
  assert.equal(await count(READER) + await count('198.51.100.8'), 0, 'no claimed address was counted');
  const off = await fixture({ MINIAPP_CLIENT_IP_KEY: undefined });
  assert.equal(await ipLimited(await ask(off.env, sign())), true, 'without the key, signed headers are ignored');
});

test('during a rotation the previous key is still accepted, and nothing else', async () => {
  const env = { MINIAPP_CLIENT_IP_KEY: 'new-key', MINIAPP_CLIENT_IP_KEY_PREVIOUS: KEY };
  const req = (h) => new Request('https://bot.example/api/ask', { method: 'POST', headers: h });
  assert.equal(await m.signedClientIp(req(sign()), env), READER, 'the old key');
  assert.equal(await m.signedClientIp(req(sign({ key: 'new-key' })), env), READER, 'the new key');
  assert.equal(await m.signedClientIp(req(sign({ key: 'other' })), env), undefined);
  assert.equal(await m.signedClientIp(req(sign()), { MINIAPP_CLIENT_IP_KEY_PREVIOUS: KEY }), READER, 'the previous key alone still verifies');
});

test('signedClientIp: the exact contract', async () => {
  const env = { MINIAPP_CLIENT_IP_KEY: KEY };
  const req = (h, method = 'POST', url = 'https://bot.example/api/ask?q=1') => new Request(url, { method, headers: h });
  assert.equal(await m.signedClientIp(req(sign()), env), READER);
  assert.equal(await m.signedClientIp(req(sign({ ip: '2001:db8::1' })), env), '2001:db8::1');
  assert.equal(await m.signedClientIp(req(sign({ ts: nowS() - 59 })), env), READER, 'within 60 seconds');
  assert.equal(await m.signedClientIp(req(sign({ method: 'GET', path: '/api/search' }), 'get', 'https://bot.example/api/search'), env), READER, 'method compared uppercase');
  assert.equal(await m.signedClientIp(req({}), env), undefined);
});

test('clientIp is worked out once per request, however many limiters ask', async () => {
  const env = { MINIAPP_CLIENT_IP_KEY: KEY };
  const r = new Request('https://bot.example/api/ask', { method: 'POST', headers: { 'cf-connecting-ip': PROXY, ...sign() } });
  const a = m.clientAddress(r, env), b = m.clientAddress(r, env);
  assert.equal(a, b, 'the same promise');
  assert.deepEqual(await a, { ip: READER, signed: true });
  assert.equal(await m.clientIp(r, env), READER);
  assert.equal(await m.clientIp(new Request('https://bot.example/api/ask', { headers: { 'cf-connecting-ip': PROXY } }), env), PROXY);
});
