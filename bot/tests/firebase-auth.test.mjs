import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { signInitData } from '../src/initdata.mjs';

const out = new URL('./.build/firebase-auth.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/firebase-auth.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { firebaseAuth, telegramFirebaseUid } = await import(out);
const BOT_TOKEN = '123:bridge-test-only';
let env, publicKey;
before(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  publicKey = keys.publicKey;
  env = { BOT_TOKEN, FIREBASE_AUTH_LIMIT: { limit: async () => ({ success: true }) }, FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ type: 'service_account', project_id: 'cyberjudah-app', client_email: 'bridge@cyberjudah-app.iam.gserviceaccount.com', private_key: await exportPKCS8(keys.privateKey) }) };
});
const launch = (id = 77, age = 0) => signInitData({ user: { id, first_name: 'Fixture' }, auth_date: Math.floor(Date.now() / 1000) - age }, BOT_TOKEN);
const request = (raw, options = {}, bindings = env, route = '/token') => firebaseAuth.request(`https://example.test${route}`, { method: 'POST', headers: raw ? { authorization: `tma ${raw}` } : {}, ...options }, bindings);

test('two devices mint cryptographically valid custom tokens for exactly the same Telegram UID', async () => {
  for (const raw of [await launch(), await launch()]) {
    const response = await request(raw);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    const { payload } = await jwtVerify(body.token, publicKey, { algorithms: ['RS256'], audience: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', issuer: 'bridge@cyberjudah-app.iam.gserviceaccount.com' });
    assert.equal(body.uid, 'tg_77');
    assert.equal(payload.uid, body.uid);
    assert.equal(payload.sub, payload.iss);
    assert.equal(payload.exp - payload.iat, 3600);
    assert.equal(payload.claims, undefined, 'no client privileges are copied');
  }
});
test('missing, tampered, expired, duplicated and invalid Telegram identities never mint', async () => {
  const raw = await launch();
  const variants = [undefined, raw.replace('Fixture', 'Tampered'), await launch(77, 86460), `${raw}&user=${encodeURIComponent('{"id":88}')}`, `${raw}&hash=${new URLSearchParams(raw).get('hash')}`];
  for (const id of [0, -1, '77', 1.5, Number.MAX_SAFE_INTEGER + 1, null]) variants.push(await launch(id));
  for (const value of variants) {
    const response = await request(value);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).token, undefined);
  }
  assert.throws(() => telegramFirebaseUid('77'));
});
test('a supplied UID or claims cannot select a different Firebase account', async () => {
  for (const body of ['{"uid":"admin"}', '{"claims":{"admin":true}}']) assert.equal((await request(await launch(), { body })).status, 400);
  assert.equal((await request(await launch(), {}, env, '/token?uid=admin')).status, 400);
});
test('restored sessions verify identity without requiring a signing key or minting a token', async () => {
  const response = await request(await launch(), {}, { BOT_TOKEN }, '/identity');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { uid: 'tg_77' });
});
test('missing/wrong configuration and rate limiting fail closed without exposing credentials', async () => {
  assert.equal((await request(await launch(), {}, { BOT_TOKEN })).status, 503);
  assert.equal((await request(await launch(), {}, { ...env, FIREBASE_AUTH_LIMIT: { limit: async () => ({ success: false }) } })).status, 429);
  for (const value of ['invalid secret fixture', env.FIREBASE_SERVICE_ACCOUNT.replace('"project_id":"cyberjudah-app"', '"project_id":"other-project"')]) {
    const response = await request(await launch(), {}, { ...env, FIREBASE_SERVICE_ACCOUNT: value });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'firebase_sign_in_unavailable' });
  }
});
