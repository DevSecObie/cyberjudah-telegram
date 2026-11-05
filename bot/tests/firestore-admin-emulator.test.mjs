import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

// Opt-in, isolated emulator only. This test never uses a production hostname or credential.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('A loopback emulator is required');
const out = new URL('./.build/firestore-admin-emulator.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/firestore-admin.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { deleteFirebaseAccountSyncMarks, inventoryOrphanedStudyParents, deleteOwnedStudy } = await import(out);

test('actual Firestore traverses missing parents, preserves failed study parents, and retries without touching other owners', { skip: !host }, async () => {
  const uid = `deletion-test-${randomUUID()}`;
  const study = `studies/${uid}`;
  const root = 'projects/demo-cyberjudah/databases/(default)/documents';
  const base = `http://${host}/v1/${root}`;
  const env = { FIRESTORE_EMULATOR_HOST: host, DB: { prepare: () => ({ bind() { return this; }, run: async () => ({}), first: async () => null }) } };
  const owned = [
    `users/${uid}/notes/missing/revisions/r1`, `users/${uid}/notes/missing/revisions/r2`,
    `users/${uid}/studies/missing/revisions/r1`, `users/${uid}/cyberJudahConversations/missing/turns/t1`,
    `staging_users/${uid}/notes/missing/revisions/r1`, `staging_users-status/${uid}`,
    `${study}/revisions/r1`, study,
  ];
  const untouched = [`users/other-${uid}/notes/missing/revisions/r1`, `studies/unknown-${uid}/revisions/r1`];
  const originalFetch = globalThis.fetch;
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const request = async (path, init = {}) => {
    const response = await originalFetch(`${base}${path}`, { headers, ...init });
    return response;
  };
  try {
    for (const path of [...owned, ...untouched]) {
      const fields = path === study ? { user: { mapValue: { fields: { id: { stringValue: uid } } } } } : { fixture: { booleanValue: true } };
      const response = await request(`/${path}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
      assert.equal(response.status, 200, await response.text());
    }
    for (const path of [`users/${uid}`, `users/${uid}/notes/missing`, `staging_users/${uid}/notes/missing`]) assert.equal((await request(`/${path}`)).status, 404);
    const listing = await (await request(`/users/${uid}/notes?showMissing=true`)).json();
    assert.equal(listing.documents[0].name, `${root}/users/${uid}/notes/missing`);
    assert.equal(listing.documents[0].createTime, undefined);
    const inventory = await inventoryOrphanedStudyParents(env);
    assert.deepEqual(inventory, { version: 1, orphanParents: [`${root}/studies/unknown-${uid}`], ownershipResolved: false });

    // Return a realistic mixed-success batch: forward successful deletes to the actual emulator,
    // retain one revision, and report its transient failure without letting the parent disappear.
    let failRevision = true;
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).startsWith(base), 'cleanup must never contact production');
      if (String(url).endsWith(':batchWrite') && failRevision) {
        const { writes } = JSON.parse(init.body);
        const blocked = `${root}/${study}/revisions/r1`;
        const successful = writes.filter(write => write.delete !== blocked);
        if (successful.length) {
          const result = await originalFetch(url, { ...init, body: JSON.stringify({ writes: successful }) });
          assert.equal(result.status, 200);
          const body = await result.json();
          assert.ok(body.status.every(status => !status.code));
        }
        return Response.json({ status: writes.map(write => write.delete === blocked ? { code: 14 } : {}) });
      }
      return originalFetch(url, init);
    };
    await assert.rejects(deleteFirebaseAccountSyncMarks(env, uid), /deletion failed/i);
    assert.equal((await request(`/${study}`)).status, 200);
    assert.equal((await request(`/${study}/revisions/r1`)).status, 200);
    failRevision = false;
    await deleteFirebaseAccountSyncMarks(env, uid);
    for (const path of owned) assert.equal((await request(`/${path}`)).status, 404, path);
    for (const path of untouched) assert.equal((await request(`/${path}`)).status, 200, path);
    assert.equal(await deleteFirebaseAccountSyncMarks(env, uid), 0);
  } finally {
    globalThis.fetch = originalFetch;
    // Only this test's unique synthetic paths are removed; no collection/database-wide reset.
    for (const path of [...owned, ...untouched]) await request(`/${path}`, { method: 'DELETE' });
  }
});

test('ordinary deletion atomically retains ownership, rejects changed parents, and cleans late history on retry and account erasure', { skip: !host }, async () => {
  const originalFetch = globalThis.fetch;
  const root = 'projects/demo-cyberjudah/databases/(default)/documents';
  const base = `http://${host}/v1/${root}`;
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const env = { FIRESTORE_EMULATOR_HOST: host, DB: { prepare: () => ({ bind() { return this; }, run: async () => ({}), first: async () => null }) } };
  for (const scope of process.env.FIRESTORE_RULES_TEST_SCOPE === 'production' ? ['production'] : ['production', 'staging']) {
    const uid = `study-delete-test-${randomUUID()}`;
    const studyRoot = scope === 'staging' ? 'staging_studies' : 'studies';
    const path = `${studyRoot}/${uid}`, ledgerPath = `study_deletion_owners/${studyRoot}:${uid}`;
    const paths = [path, ledgerPath, `${path}/revisions/r1`, `${path}/revisions/late`, `${path}/revisions/after-retry`];
    const request = (suffix, init = {}) => originalFetch(`${base}/${suffix}`, { headers, ...init });
    const parentFields = { user: { mapValue: { fields: { id: { stringValue: uid } } } } };
    const now = Math.floor(Date.now() / 1000);
    const clientToken = [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify({
      sub: uid, user_id: uid, aud: 'demo-cyberjudah', iss: 'https://securetoken.google.com/demo-cyberjudah',
      iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'custom', identities: {} },
    })).toString('base64url'), ''].join('.');
    const clientHeaders = { ...headers, authorization: `Bearer ${clientToken}` };
    const seed = async (p, fields = {}) => {
      const response = await request(p, { method: 'PATCH', body: JSON.stringify({ fields }) });
      assert.equal(response.status, 200, await response.text());
    };
    let mode = 'concurrent-edit', postCommitFailure = false;
    const batches = [];
    try {
      await seed(path, parentFields); await seed(`${path}/revisions/r1`);
      assert.equal((await request(path, { headers: clientHeaders })).status, 200, 'the fixture client can read its owned study');
      assert.equal((await request(path, { method: 'DELETE', headers: clientHeaders })).status, 403, 'old clients cannot discard the owner parent');
      await assert.rejects(deleteOwnedStudy(env, 'another-reader', scope, uid), error => error.status === 403);
      globalThis.fetch = async (url, init) => {
        assert.ok(String(url).startsWith(base));
        if (String(url).endsWith(':commit')) {
          if (mode === 'concurrent-edit') await seed(path, { ...parentFields, edit: { stringValue: 'newer' } });
          const response = await originalFetch(url, init);
          if (response.ok && mode === 'late-history') {
            await seed(`${path}/revisions/late`);
            postCommitFailure = true;
          }
          return response;
        }
        if (postCommitFailure && String(url).endsWith(':listCollectionIds')) {
          postCommitFailure = false;
          return new Response('', { status: 503 });
        }
        if (String(url).endsWith(':batchWrite')) batches.push(JSON.parse(init.body).writes.map(w => w.delete));
        return originalFetch(url, init);
      };
      await assert.rejects(deleteOwnedStudy(env, uid, scope, uid));
      assert.equal((await request(path)).status, 200, 'a concurrent parent edit fails its commit precondition');
      assert.equal((await request(ledgerPath)).status, 404, 'the failed atomic commit creates no ledger');
      mode = 'late-history';
      await assert.rejects(deleteOwnedStudy(env, uid, scope, uid));
      assert.equal((await request(path)).status, 404);
      const ledger = await (await request(ledgerPath)).json();
      assert.equal(ledger.fields.user.mapValue.fields.id.stringValue, uid);
      assert.equal((await request(ledgerPath, { headers: clientHeaders })).status, 403, 'clients cannot read ownership evidence');
      assert.equal((await request(ledgerPath, { method: 'PATCH', headers: clientHeaders, body: JSON.stringify({ fields: parentFields }) })).status, 403, 'clients cannot forge ownership evidence');
      assert.equal((await request(path, { method: 'PATCH', headers: clientHeaders, body: JSON.stringify({ fields: parentFields }) })).status, 403, 'a deleted study ID cannot be recreated');
      assert.equal((await request(`${path}/revisions/late`)).status, 200);
      mode = 'normal';
      await assert.rejects(deleteOwnedStudy(env, 'another-reader', scope, uid), error => error.status === 409);
      await deleteOwnedStudy(env, uid, scope, uid);
      assert.equal((await request(`${path}/revisions/late`)).status, 404);
      assert.equal((await request(ledgerPath)).status, 200, 'ordinary deletion retains owner evidence');

      // A delayed writer or historical repair must remain attributable even after an earlier success.
      await seed(`${path}/revisions/after-retry`);
      batches.length = 0;
      await deleteFirebaseAccountSyncMarks(env, uid);
      assert.equal((await request(`${path}/revisions/after-retry`)).status, 404);
      assert.equal((await request(ledgerPath)).status, 404);
      assert.deepEqual(batches.at(-1), [`${root}/${ledgerPath}`], 'account deletion removes ownership evidence last');
    } finally {
      globalThis.fetch = originalFetch;
      for (const p of paths) await request(p, { method: 'DELETE' });
    }
  }
});
