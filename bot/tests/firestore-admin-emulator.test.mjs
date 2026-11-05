import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';

// Opt-in, isolated emulator only. This test never uses a production hostname or credential.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('A loopback emulator is required');
const out = new URL('./.build/firestore-admin-emulator.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/firestore-admin.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { deleteFirebaseAccountSyncMarks } = await import(out);

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
