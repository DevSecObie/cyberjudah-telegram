import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const { outputFiles } = await build({ stdin: { contents: `
  import { Hono } from 'hono';
  import { PublicationErasure } from './src/publication-erasure-rpc';
  import { erasePublicationsAcrossStores, publicationErasurePeer, unlinkNativeAcrossStores } from './src/publication-erasure';
  import { linkAccounts, linkedFirebase } from './src/account-links';
  import { publishedStudies, publishedStudyPage } from './src/published-studies';
  export class TestPublicationErasure extends PublicationErasure {
    async block(ids) {
      const badAck = await this.env.DB.prepare('SELECT 1 FROM test_failure WHERE mode=2').first();
      if (badAck) return { version: 1, store: 'staging', phase: 'blocked', identities: ['bob'] };
      return super.block(ids);
    }
    async unlinkNative(uid) {
      const fail = await this.env.DB.prepare('SELECT mode FROM test_failure WHERE mode IN (3,4,5)').first();
      if (fail?.mode === 3) throw new Error('synthetic unlink outage');
      const receipt = await super.unlinkNative(uid);
      if (fail?.mode === 4) throw new Error('synthetic lost unlink acknowledgment');
      if (fail?.mode === 5) return { ...receipt, identities: ['bob'] };
      return receipt;
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
  app.post('/fixture/link/:uid', async c => {
    try { await linkAccounts(c.env, 77, c.req.param('uid')); return c.text('linked'); }
    catch { return c.text('conflict', 409); }
  });
  app.get('/fixture/link', async c => c.json({ uid: await linkedFirebase(c.env, 77) }));
  app.post('/fixture/native', async c => {
    try {
      const peer = await publicationErasurePeer(c.env, true);
      await unlinkNativeAcrossStores(c.env, peer, 'alice');
      await erasePublicationsAcrossStores(c.env, peer, ['alice']);
      return c.text('complete');
    } catch { return c.text('incomplete', 503); }
  });
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

for (const mode of [0, 3, 4, 5]) test(`native unlink preserves Telegram publications and newer links across retry (failure ${mode})`, async t => {
  const f = await fixture(t);
  for (const worker of [f.main, f.peer]) {
    assert.equal((await worker.fetch('https://fixture/fixture/link/alice', { method: 'POST' })).status, 200);
    assert.equal((await f.publish(worker, 'tg_77', 'telegram-study')).status, 200);
  }
  if (mode) await f.peerDB.prepare('INSERT INTO test_failure VALUES (?)').bind(mode).run();
  const erase = () => f.main.fetch('https://fixture/fixture/native', { method: 'POST' });
  assert.equal((await erase()).status, mode ? 503 : 200);
  for (const worker of [f.main, f.peer]) {
    assert.equal((await worker.fetch('https://fixture/app/published/telegram-study')).status, 200);
    assert.equal((await f.publish(worker, 'tg_77', 'telegram-still-active')).status, 200);
    assert.equal((await worker.fetch('https://fixture/fixture/link/alice', { method: 'POST' })).status, 409);
    if (mode) assert.equal((await worker.fetch('https://fixture/app/published/alice-study')).status, 200, 'no cleanup before both unlink receipts');
  }
  // The primary link was removed even if the peer failed. A new app link is independent.
  assert.equal((await f.main.fetch('https://fixture/fixture/link/new-owner', { method: 'POST' })).status, 200);
  await f.peerDB.prepare('DELETE FROM test_failure').run();
  assert.equal((await erase()).status, 200);
  assert.equal((await erase()).status, 200);
  assert.equal((await (await f.main.fetch('https://fixture/fixture/link')).json()).uid, 'new-owner');
  assert.equal((await (await f.peer.fetch('https://fixture/fixture/link')).json()).uid, null);
  for (const db of [f.mainDB, f.peerDB]) {
    assert.equal(await db.prepare("SELECT 1 FROM account_deletion_blocks WHERE firebase_uid='tg_77'").first(), null);
    assert.equal(await db.prepare("SELECT 1 FROM account_links WHERE firebase_uid='alice'").first(), null);
  }
});
