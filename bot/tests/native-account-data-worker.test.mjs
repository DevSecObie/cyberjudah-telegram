import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Real Worker + D1, synthetic Google and Firestore REST services. No production data or credentials.
const { outputFiles } = await build({ stdin: {
  contents: `import { Hono } from "hono";
    import { nativeAccountData } from "./src/native-account-data.ts";
    import { linkAccounts } from "./src/account-links.ts";
    const app = new Hono();
    app.route("/api/native-account-data", nativeAccountData);
    app.post("/fixture/link", async c => { await linkAccounts(c.env, 7, "reader-one"); return c.text("ok"); });
    export default { fetch(request, env, ctx) {
      env.FIREBASE_SESSION_LIMIT = { limit: async () => ({ success: env.TEST_RATE_LIMIT !== "blocked" }) };
      env.FIREBASE_UID_LIMIT = { limit: async () => ({ success: true }) };
      return app.fetch(request, env, ctx);
    } };`, resolveDir: new URL('..', import.meta.url).pathname,
}, bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error' });
const root = 'projects/demo-cyberjudah/databases/(default)/documents';
const token = (uid = 'reader-one', claims = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({
    sub: uid, aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app',
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'apple.com' }, ...claims,
  })).toString('base64url'), 'synthetic-signature'].join('.');
};
const fixture = (bindings = {}) => {
  const ownedStudy = 'studies/owned';
  const store = new Map([
    ['users/reader-one/notes/missing/revisions/r1', {}],
    ['staging_users/reader-one/studies/missing/revisions/r1', {}],
    [ownedStudy, { user: { mapValue: { fields: { id: { stringValue: 'reader-one' } } } } }],
    [`${ownedStudy}/revisions/r1`, {}],
    ['users/reader-two/notes/missing/revisions/r1', {}],
    ['users/tg_7/notes/missing/revisions/r1', {}],
    ['studies/unattributable/revisions/r1', {}],
  ]);
  const state = { failRevision: false, googleStatus: 200, googleUser: undefined, firestoreCalls: 0, batches: [] };
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01',
    d1Databases: { DB: 'native-account-data-test' },
    bindings: { PRIVACY_KEY: 'synthetic-test-privacy-key', BOT_TOKEN: 'synthetic-test-bot-token', NATIVE_ACCOUNT_DELETION_READY: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8089', ...bindings },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.hostname === 'identitytoolkit.googleapis.com') {
        if (state.googleStatus !== 200) return new Response('', { status: state.googleStatus });
        const { idToken } = await request.json();
        const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).sub;
        return Response.json({ users: [state.googleUser ?? { localId: uid, validSince: '1' }] });
      }
      assert.equal(url.hostname, '127.0.0.1', 'no unexpected outbound service or production access');
      state.firestoreCalls++;
      const doc = path => ({ name: `${root}/${path}`, fields: store.get(path), createTime: '2026-11-05T00:00:00Z' });
      if (url.pathname.endsWith(':batchWrite')) {
        const { writes } = await request.json();
        const paths = writes.map(w => w.delete.slice(root.length + 1));
        state.batches.push(paths);
        return Response.json({ status: paths.map(path => {
          if (state.failRevision && path === `${ownedStudy}/revisions/r1`) return { code: 14 };
          store.delete(path); return {};
        }) });
      }
      if (url.pathname.endsWith(':runQuery')) {
        const { structuredQuery: q } = await request.json();
        return Response.json([...store].filter(([path, fields]) => path.split('/').length === 2 && path.split('/')[0] === q.from[0].collectionId && fields.user?.mapValue.fields.id.stringValue === q.where.fieldFilter.value.stringValue).map(([path]) => ({ document: doc(path) })));
      }
      const path = decodeURIComponent(url.pathname.slice(url.pathname.indexOf('/documents/') + '/documents/'.length));
      if (path.endsWith(':listCollectionIds')) {
        const parent = path.slice(0, -':listCollectionIds'.length);
        return Response.json({ collectionIds: [...new Set([...store.keys()].filter(p => p.startsWith(`${parent}/`)).map(p => p.slice(parent.length + 1).split('/')[0]))] });
      }
      if (path.split('/').length % 2 === 0) return store.has(path) ? Response.json(doc(path)) : new Response('', { status: 404 });
      assert.equal(url.searchParams.get('showMissing'), 'true');
      const children = [...new Set([...store.keys()].filter(p => p.startsWith(`${path}/`)).map(p => `${path}/${p.slice(path.length + 1).split('/')[0]}`))];
      return Response.json({ documents: children.map(p => store.has(p) ? doc(p) : { name: `${root}/${p}` }) });
    },
  }));
  return { mf, store, state };
};
const remove = (mf, idToken = token(), suffix = '', body) => mf.dispatchFetch(`https://cyberjudah.test/api/native-account-data${suffix}`, {
  method: 'DELETE', headers: idToken ? { authorization: `Bearer ${idToken}` } : {}, ...(body ? { body } : {}),
});

test('an unlinked Firebase account deletes its missing-parent histories; the acknowledgment is scoped and retryable', async () => {
  const { mf, store } = fixture();
  try {
    const response = await remove(mf);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { version: 1, uid: 'reader-one', firestoreDeleted: true, removed: 4 });
    assert.deepEqual([...store.keys()].sort(), ['studies/unattributable/revisions/r1', 'users/reader-two/notes/missing/revisions/r1', 'users/tg_7/notes/missing/revisions/r1']);
    const retry = await remove(mf);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).removed, 0);
  } finally { await mf.dispose(); }
});

test('a linked legacy identity comes only from the server link and its evidence remains available for retry', async () => {
  const { mf, store, state } = fixture();
  try {
    assert.equal((await mf.dispatchFetch('https://cyberjudah.test/fixture/link', { method: 'POST' })).status, 200);
    state.failRevision = true;
    const failed = await remove(mf);
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'account_deletion_incomplete' });
    assert.ok(store.has('studies/owned'));
    assert.ok(store.has('studies/owned/revisions/r1'));
    assert.ok(state.batches.every(batch => !batch.includes('studies/owned')));
    state.failRevision = false;
    assert.equal((await remove(mf)).status, 200);
    assert.equal(store.has('users/tg_7/notes/missing/revisions/r1'), false);
    assert.deepEqual([...store.keys()].sort(), ['studies/unattributable/revisions/r1', 'users/reader-two/notes/missing/revisions/r1']);
  } finally { await mf.dispose(); }
});

test('missing, stale, forged, disabled and revoked identities never reach Firestore', async () => {
  const { mf, state } = fixture();
  try {
    for (const value of ['', 'not-a-token', token('reader-one', { auth_time: 1 }), token('reader-one', { aud: 'another-project' }), token('../other')]) assert.equal((await remove(mf, value)).status, 401);
    for (const googleUser of [{ localId: 'reader-two', validSince: '1' }, { localId: 'reader-one', validSince: '1', disabled: true }, { localId: 'reader-one', validSince: String(Math.floor(Date.now() / 1000) + 1) }]) {
      state.googleUser = googleUser;
      assert.equal((await remove(mf)).status, 401);
    }
    state.googleStatus = 400;
    assert.equal((await remove(mf)).status, 401);
    state.googleStatus = 503;
    assert.equal((await remove(mf)).status, 503);
    assert.equal(state.firestoreCalls, 0);
  } finally { await mf.dispose(); }
});

test('client identities, paths and scopes are rejected rather than overriding the verified identity', async () => {
  const { mf, state } = fixture();
  try {
    for (const suffix of ['?uid=reader-two', '?scope=production', '?path=users/reader-two']) assert.equal((await remove(mf, token(), suffix)).status, 400);
    assert.equal((await remove(mf, token(), '', '{"uid":"reader-two"}')).status, 400);
    assert.equal(state.firestoreCalls, 0);
  } finally { await mf.dispose(); }
});

test('reconciliation gate, unavailable Firestore and rate limits fail closed without writes', async () => {
  for (const [bindings, expected] of [
    [{ NATIVE_ACCOUNT_DELETION_READY: '' }, 503],
    [{ FIRESTORE_EMULATOR_HOST: '' }, 503],
    [{ TEST_RATE_LIMIT: 'blocked' }, 429],
  ]) {
    const { mf, state, store } = fixture(bindings);
    try {
      assert.equal((await remove(mf)).status, expected);
      assert.equal(state.firestoreCalls, 0);
      assert.equal(store.size, 7);
    } finally { await mf.dispose(); }
  }
});
