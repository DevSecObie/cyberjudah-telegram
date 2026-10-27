import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { signInitData } from '../src/initdata.mjs';

const out = new URL('./.build/account-links.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/account-links.ts"; export * from "./src/firebase-auth.ts"; export * from "./src/device-auth.ts"; export * from "./src/credits.ts"; export { startMeter } from "./src/ai.ts"; export * from "./src/chats.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const now = () => Math.floor(Date.now() / 1000);
const token = (uid = 'firebase-alice', more = {}) => [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app', iat: now(), exp: now()+3600, auth_time: now(), firebase: { sign_in_provider: 'google.com' }, ...more })).toString('base64url'), 'fixture-signature-verified-only-by-google-stand-in'].join('.');
function fixture() {
  const db = new DatabaseSync(':memory:');
  const prepare = (sql, values = []) => ({ bind: (...a) => prepare(sql, a), first: async () => db.prepare(sql).get(...values) ?? null, all: async () => ({ results: db.prepare(sql).all(...values) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }) });
  const kv = new Map();
  const env = { DB: { prepare, batch: async statements => { db.exec('BEGIN'); try { const results = []; for (const s of statements) results.push(await s.all()); db.exec('COMMIT'); return results; } catch(e) { db.exec('ROLLBACK'); throw e; } } }, SUBS: { get: async (k, type) => kv.has(k) ? type === 'json' ? JSON.parse(kv.get(k)) : kv.get(k) : null, put: async (k, v) => { kv.set(k,v); }, delete: async k => { kv.delete(k); } }, BOT_TOKEN: '100:local-test', PRIVACY_KEY: 'account-link-test', FIREBASE_AUTH_LIMIT: { limit: async () => ({ success: true }) }, FIREBASE_SESSION_LIMIT: { limit: async () => ({ success: true }) }, ASK_BILLING: 'on', ASK_USD_PER_STAR: '0.013' };
  return { env, db };
}
async function withGoogle(fn, response) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).origin, 'https://identitytoolkit.googleapis.com');
    assert.equal(new URL(String(input)).pathname, '/v1/accounts:lookup');
    assert.equal(init.redirect, 'manual');
    const claims = JSON.parse(Buffer.from(JSON.parse(init.body).idToken.split('.')[1], 'base64url'));
    return response ? response(claims) : Response.json({ users: [{ localId: claims.sub, validSince: '1', displayName: 'Reader' }] });
  };
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const launch = (id = 77, age = 0) => signInitData({ user: { id, first_name: 'Telegram reader' }, auth_date: now()-age }, '100:local-test');

test('Firebase verification rejects wrong project, missing/future/expired claims and anonymous sessions before any lookup', async () => {
  const variants = ['invalid', token('x', { aud: 'other' }), token('x', { iss: 'https://evil.test' }), token('', {}), token('x', { exp: now()-1 }), token('x', { iat: now()+120 }), token('x', { auth_time: now()+10 }), token('x', { auth_time: null }), token('x', { firebase: { sign_in_provider: 'anonymous' } })];
  await withGoogle(async () => { for (const t of variants) await assert.rejects(m.verifyFirebaseIdentity(t), { status: 401 }); }, () => { throw new Error('No network call expected'); });
});
test('Google rejection, disabled accounts, mismatched UID and revoked ID tokens fail closed; service failures stay 503', async () => {
  for (const result of [() => new Response('', { status: 400 }), () => Response.json({ users: [{ localId: 'other', validSince: '1' }] }), () => Response.json({ users: [{ localId: 'firebase-alice', disabled: true, validSince: '1' }] }), () => Response.json({ users: [{ localId: 'firebase-alice', validSince: String(now()+1) }] })]) {
    await withGoogle(() => assert.rejects(m.verifyFirebaseIdentity(token()), { status: 401 }), result);
  }
  await withGoogle(() => assert.rejects(m.verifyFirebaseIdentity(token()), { status: 503 }), () => new Response('', { status: 503 }));
  await withGoogle(() => assert.rejects(m.verifyFirebaseIdentity(token('x', { auth_time: now()-301 }), true), { reason: 'recent_sign_in_required' }));
});
test('fresh double proof links Google, Apple and email identities; replay is idempotent and never creates a credit balance', async () => {
  const { env, db } = fixture();
  await withGoogle(async () => {
    for (const provider of ['google.com', 'apple.com', 'password']) {
      const r = await m.firebaseAuth.request('https://test/link', { method: 'POST', headers: { authorization: `tma ${await launch()}`, 'content-type': 'application/json' }, body: JSON.stringify({ idToken: token('firebase-alice', { firebase: { sign_in_provider: provider } }) }) }, env);
      assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
      const principal = await m.firebaseAccount(new Request('https://test/api/ask', { headers: { authorization: `Bearer ${token('firebase-alice', { firebase: { sign_in_provider: provider } })}` } }), env);
      assert.equal(principal.user.id, 77);
    }
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account_links').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'credit_%'").get().n, 0);
});
test('linking requires both identities, recent Telegram proof and an exact body without a client UID', async () => {
  const { env } = fixture();
  for (const [authorization, body] of [[undefined, {idToken: token()}], [`tma ${await launch(77, 301)}`, {idToken:token()}], [`tma ${await launch()}`, {idToken: token(), uid: 'other'}]]) {
    const r = await m.firebaseAuth.request('https://test/link', {method:'POST', headers:authorization ? {authorization} : {}, body:JSON.stringify(body)}, env);
    assert.ok([400,401].includes(r.status));
  }
  assert.equal(await m.linkedTelegram(env, 'firebase-alice'), null);
});
test('concurrent conflicting links cannot steal either account; only the reserved Telegram bridge can be replaced', async () => {
  const { env } = fixture();
  await m.linkAccounts(env, 77, 'tg_77'); await m.linkAccounts(env, 77, 'firebase-alice');
  assert.equal(await m.linkedTelegram(env, 'tg_77'), null);
  const results = await Promise.allSettled([m.linkAccounts(env, 78, 'firebase-alice'), m.linkAccounts(env, 77, 'firebase-bob')]);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.status === 409));
  assert.equal(await m.linkedTelegram(env, 'firebase-alice'), 77);
  assert.equal(await m.linkedTelegram(env, 'firebase-bob'), null);
  await assert.rejects(m.linkAccounts(env, 78, 'tg_77'), {status:409});
});
test('actual API reads the existing wallet and sealed chat for linked Firebase; payment and admin routes remain blocked', async () => {
  const { env } = fixture();
  const owner = await m.ownerOfUser(env, 77);
  await m.adjust(env, owner, 1_000_000, 'test-grant', 'Synthetic test only');
  await m.saveExchange(env, 77, 'chat123456', 'Question one', { content: 'Answer one' });
  await m.linkAccounts(env, 77, 'firebase-alice');
  const request = (path, method = 'GET', idToken = token()) => m.worker.fetch(new Request(`https://test${path}`, { method, headers: { authorization: `Bearer ${idToken}` } }), env, { waitUntil() {} });
  await withGoogle(async () => {
    const balance = await request('/api/ask/account'); assert.equal(balance.status, 200); assert.equal((await balance.json()).wallet.total_mc, 1_000_000);
    const chats = await request('/api/chats'); assert.equal((await chats.json()).chats[0].id, 'chat123456');
    assert.equal((await request('/api/chats', 'GET', token('someone-else'))).status, 401);
    const report = (idToken = token()) => m.worker.fetch(new Request('https://test/api/report', { method:'POST', headers:{ authorization:`Bearer ${idToken}`, 'content-type':'application/json' }, body:JSON.stringify({kind:'ask',chat:'chat123456',turn:1,reason:'harmful'}) }), env, {waitUntil(){}});
    assert.equal((await report(token('someone-else'))).status,401);
    for (let i=0;i<10;i++) assert.equal((await report()).status,200,'linked accounts can report without a Telegram launch');
    assert.equal((await report()).status,429,'the original reader quota also limits Firebase reports');
    for (const [path, method] of [['/api/admin/usage', 'GET'], ['/api/ask/buy', 'POST'], ['/api/subscribe', 'POST'], ['/api/backup', 'POST']]) assert.equal((await request(path, method)).status, 403);
    const principal = await m.firebaseAccount(new Request('https://test/api/ask', {headers:{authorization:`Bearer ${token()}`}}), env);
    const model = { id:'anthropic/claude-sonnet-5', name:'Synthetic paid model', format:'anthropic', input:3, output:15, context:200000, maxOutput:8192 };
    const held = await m.startMeter(env, principal.user.id, model, { request:'synthetic-paid-hold', maxMc:100000 });
    assert.equal(held.ok,true); assert.equal(held.meter.owner,owner);
    assert.ok((await m.wallet(env,owner)).total_mc < 1_000_000,'Firebase requests reserve the original Telegram balance');
    await m.settle(env,owner,held.meter.request,{actualMc:0,costUsd:0,status:'cancelled'});
    await m.removeAccountLink(env, 77);
    assert.equal((await request('/api/chats')).status, 401, 'deleting the link revokes bearer access');
  });
  assert.equal((await m.wallet(env, owner)).total_mc, 1_000_000, 'identity changes never move or duplicate money');
});
test('native device handoff needs approval and a separate secret, expires, and redeems exactly once', async () => {
  const { env, db } = fixture();
  const keys = await generateKeyPair('RS256', { extractable: true });
  env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ type:'service_account', project_id:'cyberjudah-app', client_email:'bridge@cyberjudah-app.iam.gserviceaccount.com', private_key: await exportPKCS8(keys.privateKey) });
  await m.linkAccounts(env, 77, 'firebase-alice');
  const req = (path, body, bearer) => m.deviceAuth.request(`https://test${path}`, { method:'POST', headers:{ ...(bearer ? {authorization:`Bearer ${bearer}`} : {}), 'content-type':'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  const flow = await (await req('/start')).json();
  assert.notEqual(flow.code, flow.secret);
  assert.equal((await req('/exchange', {secret:flow.code})).status, 401);
  assert.equal((await req('/exchange', {secret:flow.secret})).status, 202);
  assert.equal((await req('/approve', {code:flow.code})).status, 401);
  await withGoogle(async () => {
    assert.equal((await req('/approve', {code:flow.code}, token('someone-else'))).status, 409);
    assert.equal((await req('/approve', {code:flow.code}, token())).status, 200);
    assert.equal((await req('/approve', {code:flow.code}, token())).status, 409);
  });
  const results = await Promise.all([req('/exchange', {secret:flow.secret}), req('/exchange', {secret:flow.secret})]);
  assert.deepEqual(results.map(r=>r.status).sort(), [200,401]);
  const minted = await results.find(r=>r.status===200).json();
  const verified = await jwtVerify(minted.token, keys.publicKey, {audience:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'});
  assert.equal(verified.payload.uid,'firebase-alice');
  const expired = await (await req('/start')).json(); db.prepare('UPDATE device_signins SET expires=0').run();
  assert.equal((await req('/exchange', {secret:expired.secret})).status,401);
});
