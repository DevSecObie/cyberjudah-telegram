import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { signInitData } from '../src/initdata.mjs';

// The per-IP Ask backstop (ASK_IP_DAILY_LIMIT) skips requests signed with Telegram launch data,
// which the Mini App sends through its own Worker (one Cloudflare address for every reader), and
// still holds every other sign-in. Only the verified sign-in decides; no header the caller sends does.
const out = new URL('./.build/ask-ip-backstop.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/account-links.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const now = () => Math.floor(Date.now() / 1000);
const IP = '203.0.113.9';
const ipKey = `ask_ip:${IP}:${new Date().toISOString().slice(0, 10)}`;
const token = (uid = 'firebase-alice') => [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app', iat: now(), exp: now() + 3600, auth_time: now(), firebase: { sign_in_provider: 'google.com' } })).toString('base64url'), 'fixture-signature-verified-only-by-google-stand-in'].join('.');
const launch = (id = 77) => signInitData({ user: { id, first_name: 'Telegram reader' }, auth_date: now() }, '100:local-test');

function fixture() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => ({ bind: (...a) => prepare(sql, a), first: async () => db.prepare(sql).get(...values) ?? null, all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }) });
  const kv = new Map();
  const env = { DB: { prepare, batch: async (statements) => { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; } catch (e) { db.exec('ROLLBACK'); throw e; } } }, SUBS: { get: async (k, type) => kv.has(k) ? type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } }, BOT_TOKEN: '100:local-test', PRIVACY_KEY: 'ask-ip-test', FIREBASE_AUTH_LIMIT: { limit: async () => ({ success: true }) }, FIREBASE_SESSION_LIMIT: { limit: async () => ({ success: true }) }, ASK_BILLING: 'on', ASK_USD_PER_STAR: '0.013', ASK_IP_DAILY_LIMIT: '1000' };
  // This address has already used the whole day's backstop.
  db.exec('CREATE TABLE rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)');
  db.prepare('INSERT INTO rate_counts (key, n) VALUES (?, ?)').run(ipKey, 1000);
  const count = () => db.prepare('SELECT n FROM rate_counts WHERE key = ?').get(ipKey)?.n;
  return { env, count };
}
async function withGoogle(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (new URL(String(input)).origin !== 'https://identitytoolkit.googleapis.com') throw new Error(`no network in tests: ${input}`);
    const claims = JSON.parse(Buffer.from(JSON.parse(init.body).idToken.split('.')[1], 'base64url'));
    return Response.json({ users: [{ localId: claims.sub, validSince: '1', displayName: 'Reader' }] });
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const ask = (env, headers) => m.worker.fetch(new Request('https://test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': IP, ...headers }, body: JSON.stringify({ q: 'hi' }) }), env, { waitUntil() {} });
const ipLimited = async (res) => res.status === 429 && (await res.clone().json()).error === 'limit';
// Past the backstop, ask() runs and (with no consent on file) answers 428 consent: proof the request reached it.
const reachedAsk = async (res) => res.status === 428 && (await res.clone().json()).reason === 'consent';

test('Telegram launch data passes an address whose backstop is spent, without counting against it', async () => {
  const { env, count } = fixture();
  const res = await ask(env, { authorization: `tma ${await launch()}` });
  assert.equal(await reachedAsk(res), true, `got ${res.status} ${await res.clone().text()}`);
  assert.equal(count(), 1000, 'the address counter is untouched');
});

test('a linked Firebase login from the same address is still held by the backstop', async () => {
  const { env, count } = fixture();
  await m.linkAccounts(env, 77, 'firebase-alice');
  const res = await withGoogle(() => ask(env, { authorization: `Bearer ${token()}` }));
  assert.equal(await ipLimited(res), true, `got ${res.status} ${await res.clone().text()}`);
  assert.equal(count(), 1001);
});

test('a header the caller sends changes nothing: no sign-in, a bad signature, or a claimed path', async () => {
  const { env, count } = fixture();
  const good = await launch();
  const spoof = { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.1', 'x-auth-via': 'initdata', 'x-telegram-init-data': good };
  assert.equal((await ask(env, spoof)).status, 401, 'no sign-in is refused before any quota');
  assert.equal((await ask(env, { ...spoof, authorization: `tma ${good.replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64))}` })).status, 401, 'a forged launch is refused');
  assert.equal(count(), 1000);
  await m.linkAccounts(env, 77, 'firebase-alice');
  const res = await withGoogle(() => ask(env, { ...spoof, authorization: `Bearer ${token()}` }));
  assert.equal(await ipLimited(res), true, 'a Firebase login claiming to be Telegram is still held');
  const ok = await ask(env, { ...spoof, authorization: `tma ${good}` });
  assert.equal(await reachedAsk(ok), true, 'launch data with extra headers still reaches the ask');
});
