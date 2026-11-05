import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({ stdin: { contents: `
  import { Hono } from 'hono';
  import { PublicationErasure } from './src/publication-erasure-rpc';
  import { erasePublicationsAcrossStores, publicationErasurePeer } from './src/publication-erasure';
  import { publishedStudies, publishedStudyPage } from './src/published-studies';
  export class TestPublicationErasure extends PublicationErasure {
    async block(ids) {
      const badAck = await this.env.DB.prepare('SELECT 1 FROM test_failure WHERE mode=2').first();
      if (badAck) return { version: 1, store: 'staging', phase: 'blocked', identities: ['bob'] };
      return super.block(ids);
    }
    async erase(ids) {
      const fail = await this.env.DB.prepare('SELECT 1 FROM test_failure WHERE mode=1').first();
      if (fail) throw new Error('synthetic peer outage');
      return super.erase(ids);
    }
  }
  const app = new Hono();
  app.route('/api/published-studies', publishedStudies);
  app.route('/app/published', publishedStudyPage);
  app.post('/fixture/erase', async c => {
    try { await erasePublicationsAcrossStores(c.env, await publicationErasurePeer(c.env), ['alice']); return c.text('complete'); }
    catch { return c.text('incomplete', 503); }
  });
  export default { fetch: app.fetch };`, resolveDir: new URL('..', import.meta.url).pathname,
}, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], write: false, logLevel: 'error' });

const token = uid => {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: uid, aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app', iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'apple.com' } })).toString('base64url'), 'synthetic'].join('.');
};
async function fixture(t, peerStore = 'staging', peerBound = true) {
  let pauseIdentity;
  const options = name => ({ name, modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01',
    d1Databases: { DB: `${name}-data` },
    bindings: { PUBLICATION_STORE_ID: name === 'primary' ? 'production' : peerStore, PRIVACY_KEY: `${name}-different-test-key` },
    serviceBindings: name === 'primary' && peerBound ? { PUBLICATION_ERASURE_PEER: { name: 'peer', entrypoint: 'TestPublicationErasure' } } : {},
    outboundService: async request => {
      assert.equal(new URL(request.url).hostname, 'identitytoolkit.googleapis.com');
      const { idToken } = await request.json();
      const uid = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url')).sub;
      if (pauseIdentity && uid === 'alice' && name === 'peer') { const p = pauseIdentity; pauseIdentity = undefined; p.entered(); await p.gate; }
      return Response.json({ users: [{ localId: uid, validSince: '1' }] });
    },
  });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [options('primary'), options('peer')] }));
  t.after(() => mf.dispose());
  const main = await mf.getWorker('primary'), peer = await mf.getWorker('peer');
  const mainDB = await mf.getD1Database('DB', 'primary'), peerDB = await mf.getD1Database('DB', 'peer');
  await peerDB.prepare('CREATE TABLE test_failure(mode INTEGER)').run();
  const publish = (worker, uid, id) => worker.fetch(`https://fixture/api/published-studies/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Synthetic', author: '', body: 'Synthetic test study' }) });
  for (const worker of [main, peer]) for (const uid of ['alice', 'bob']) assert.equal((await publish(worker, uid, `${uid}-study`)).status, 200);
  return { main, peer, mainDB, peerDB, publish,
    pausePeerIdentity() {
      let entered, resume;
      const paused = new Promise(r => { entered = r; }), gate = new Promise(r => { resume = r; });
      pauseIdentity = { entered, gate }; return { paused, resume };
    },
  };
}

test('real RPC erases only the verified owner from two separate D1 stores with different privacy keys', async t => {
  const f = await fixture(t);
  const late = f.pausePeerIdentity();
  const publishing = f.publish(f.peer, 'alice', 'late-study');
  await late.paused;
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 200);
  late.resume();
  assert.equal((await publishing).status, 409);
  for (const worker of [f.main, f.peer]) {
    assert.equal((await worker.fetch('https://fixture/app/published/alice-study')).status, 404);
    assert.equal((await worker.fetch('https://fixture/app/published/bob-study')).status, 200);
    assert.equal((await f.publish(worker, 'alice', 'new-study')).status, 409);
    assert.equal((await f.publish(worker, 'bob', 'bob-new')).status, 200);
  }
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 200, 'retry is idempotent');
});

test('peer cleanup failure remains incomplete and retry cleans it without releasing either barrier', async t => {
  const f = await fixture(t);
  await f.peerDB.prepare('INSERT INTO test_failure VALUES (1)').run();
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 503);
  assert.equal((await f.peer.fetch('https://fixture/app/published/alice-study')).status, 200);
  assert.equal((await f.publish(f.peer, 'alice', 'late-study')).status, 409);
  await f.peerDB.prepare('DELETE FROM test_failure').run();
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 200);
  assert.equal((await f.peer.fetch('https://fixture/app/published/alice-study')).status, 404);
});

test('a misbound peer fails topology verification before removing either owner publication', async t => {
  const f = await fixture(t, 'production');
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 503);
  for (const worker of [f.main, f.peer]) assert.equal((await worker.fetch('https://fixture/app/published/alice-study')).status, 200);
});

test('a missing peer binding fails before blocking or removing data in either store', async t => {
  const f = await fixture(t, 'staging', false);
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 503);
  for (const worker of [f.main, f.peer]) {
    assert.equal((await worker.fetch('https://fixture/app/published/alice-study')).status, 200);
    assert.equal((await f.publish(worker, 'alice', 'still-active')).status, 200);
  }
});

test('an acknowledgment for a different identity cannot authorize cleanup', async t => {
  const f = await fixture(t);
  await f.peerDB.prepare('INSERT INTO test_failure VALUES (2)').run();
  assert.equal((await f.main.fetch('https://fixture/fixture/erase', { method: 'POST' })).status, 503);
  for (const worker of [f.main, f.peer]) for (const uid of ['alice', 'bob']) {
    assert.equal((await worker.fetch('https://fixture/app/published/' + uid + '-study')).status, 200);
  }
});
