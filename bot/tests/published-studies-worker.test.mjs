import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The publish routes in the real Workers runtime, with a real D1 and Google's sign-in check stood in.
const { outputFiles } = await build({
  stdin: {
    contents: `import { Hono } from "hono";
      import { publishedStudies, publishedStudyPage } from "./src/published-studies.ts";
      import { firebaseAuth } from "./src/firebase-auth.ts";
      const app = new Hono();
      app.use("*", async (c, next) => { c.env.FIREBASE_AUTH_LIMIT = { limit: async () => ({ success: true }) }; await next(); });
      app.route("/api/published-studies", publishedStudies);
      app.route("/app/published", publishedStudyPage);
      app.route("/api/firebase", firebaseAuth);
      export default app;`,
    resolveDir: new URL('..', import.meta.url).pathname,
  },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error',
});

const token = uid => {
  const now = Math.floor(Date.now() / 1000);
  return [Buffer.from('{"alg":"RS256"}').toString('base64url'), Buffer.from(JSON.stringify({
    sub: uid, aud: 'cyberjudah-app', iss: 'https://securetoken.google.com/cyberjudah-app',
    iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'apple.com' },
  })).toString('base64url'), 'synthetic-signature'].join('.');
};

const worker = (bindings = { PRIVACY_KEY: 'test-privacy-key' }) => new Miniflare(convertV4MiniflareOptions({
  modules: true, script: outputFiles[0].text, compatibilityDate: '2026-10-01',
  d1Databases: { DB: 'published-test' }, bindings,
  // Google's accounts:lookup: the token's own subject is the signed-in reader.
  outboundService: async request => {
    const { idToken } = await request.json();
    const sub = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).sub;
    return Response.json({ users: [{ localId: sub, validSince: '1' }] });
  },
}));

const put = (mf, id, uid, study) => mf.dispatchFetch(`https://cyberjudah.test/api/published-studies/${id}`, {
  method: 'PUT', headers: { authorization: `Bearer ${token(uid)}`, 'content-type': 'application/json' }, body: JSON.stringify(study),
});
const del = (mf, id, uid) => mf.dispatchFetch(`https://cyberjudah.test/api/published-studies/${id}`, {
  method: 'DELETE', headers: { authorization: `Bearer ${token(uid)}` },
});
const view = (mf, id) => mf.dispatchFetch(`https://cyberjudah.test/app/published/${id}`);

test('both independent Worker stores remove native publications and links while preserving Telegram', async () => {
  const workers = [worker({ PRIVACY_KEY:'production-test-key' }), worker({ PRIVACY_KEY:'staging-test-key' })];
  try {
    for (const mf of workers) {
      for (const [id, uid] of [['native-alice', 'alice'], ['native-bob', 'bob'], ['telegram-77', 'tg_77']]) {
        assert.equal((await put(mf, id, uid, { title:'Study', body:'Preserve each owner' })).status, 200);
      }
      const db = await mf.getD1Database('DB');
      await db.prepare('CREATE TABLE account_links (firebase_uid TEXT PRIMARY KEY, telegram_owner TEXT NOT NULL UNIQUE, sealed TEXT NOT NULL, created_at INTEGER NOT NULL)').run();
      await db.prepare("INSERT INTO account_links VALUES ('alice','tg-owner-77','sealed-alice',1),('bob','tg-owner-78','sealed-bob',1)").run();
      await db.prepare('CREATE TABLE device_signins (code TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, firebase_uid TEXT)').run();
      await db.prepare("INSERT INTO device_signins VALUES ('a','sa',9999999999999,'alice'),('b','sb',9999999999999,'bob')").run();
      for (const path of ['/api/published-studies', '/api/firebase/link']) {
        const response = await mf.dispatchFetch(`https://cyberjudah.test${path}`, { method:'DELETE', headers:{authorization:`Bearer ${token('alice')}`} });
        assert.equal(response.status, 200, await response.text());
      }
      assert.equal((await view(mf, 'native-alice')).status, 404);
      assert.equal((await view(mf, 'native-bob')).status, 200);
      assert.equal((await view(mf, 'telegram-77')).status, 200);
      assert.deepEqual((await db.prepare('SELECT firebase_uid FROM account_links').all()).results, [{firebase_uid:'bob'}]);
      assert.deepEqual((await db.prepare('SELECT firebase_uid FROM device_signins').all()).results, [{firebase_uid:'bob'}]);
    }
  } finally { await Promise.all(workers.map(mf=>mf.dispose())); }
});

test('a reader publishes, updates and unpublishes their own study', async () => {
  const mf = worker();
  try {
    let res = await put(mf, 'study-abc123', 'reader-one', { title: 'Judah in Egypt', author: 'Asahel', body: '## Opening\n\n> **Genesis 46:12** And the sons of Judah...\n\nMy notes.' });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal((await res.json()).path, '/app/published/study-abc123');

    res = await view(mf, 'study-abc123');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>Judah in Egypt<\/h1>/);
    assert.match(html, /Asahel/);
    assert.match(html, /<blockquote>/);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);

    res = await put(mf, 'study-abc123', 'reader-one', { title: 'Judah in Egypt (revised)', author: 'Asahel', body: 'New text' });
    assert.equal(res.status, 200);
    assert.match(await (await view(mf, 'study-abc123')).text(), /revised/);

    assert.equal((await mf.dispatchFetch('https://cyberjudah.test/api/published-studies/study-abc123')).status, 200);
    res = await del(mf, 'study-abc123', 'reader-one');
    assert.equal(res.status, 200);
    assert.equal((await view(mf, 'study-abc123')).status, 404);
    assert.equal((await mf.dispatchFetch('https://cyberjudah.test/api/published-studies/study-abc123')).status, 404);
  } finally { await mf.dispose(); }
});

test("another reader can neither replace nor take down someone's study", async () => {
  const mf = worker();
  try {
    assert.equal((await put(mf, 'study-owned1', 'reader-one', { title: 'Mine', body: 'Original' })).status, 200);
    assert.equal((await put(mf, 'study-owned1', 'reader-two', { title: 'Taken', body: 'Replaced' })).status, 403);
    assert.equal((await del(mf, 'study-owned1', 'reader-two')).status, 403);
    const html = await (await view(mf, 'study-owned1')).text();
    assert.match(html, /Original/);
    assert.doesNotMatch(html, /Replaced/);
  } finally { await mf.dispose(); }
});

test('publishing needs a sign-in, a valid study and the privacy key', async () => {
  const mf = worker();
  try {
    let res = await mf.dispatchFetch('https://cyberjudah.test/api/published-studies/study-nologin', { method: 'PUT', body: '{"title":"x","body":"y"}' });
    assert.equal(res.status, 401);
    assert.equal((await put(mf, 'study-empty1', 'reader-one', { title: '', body: 'text' })).status, 400);
    assert.equal((await put(mf, 'bad id!', 'reader-one', { title: 't', body: 'b' })).status, 400);
    assert.equal((await put(mf, 'study-huge01', 'reader-one', { title: 't', body: 'x'.repeat(210_000) })).status, 413);
  } finally { await mf.dispose(); }
  const keyless = worker({});
  try { assert.equal((await put(keyless, 'study-nokey1', 'reader-one', { title: 't', body: 'b' })).status, 503); }
  finally { await keyless.dispose(); }
});

test("a reader's text never runs as code on the page", async () => {
  const mf = worker();
  try {
    const body = '<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://cyberjudah.io/app)\n\n![img](https://evil.test/x.png)\n\n<img src=x onerror=alert(1)>';
    assert.equal((await put(mf, 'study-xss001', 'reader-one', { title: '<b>Title</b>', body })).status, 200);
    const html = await (await view(mf, 'study-xss001')).text();
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.doesNotMatch(html, /evil\.test/);
    assert.match(html, /<a href="https:\/\/cyberjudah\.io\/app" rel="noopener noreferrer nofollow">good<\/a>/);
    assert.match(html, /&lt;b&gt;Title&lt;\/b&gt;/);
  } finally { await mf.dispose(); }
});

test('deleting the account takes down every study the reader published, and only theirs', async () => {
  const mf = worker();
  try {
    for (const id of ['study-mine01', 'study-mine02']) assert.equal((await put(mf, id, 'reader-one', { title: id, body: 'text' })).status, 200);
    assert.equal((await put(mf, 'study-other1', 'reader-two', { title: 'other', body: 'text' })).status, 200);
    const res = await mf.dispatchFetch('https://cyberjudah.test/api/published-studies', { method: 'DELETE', headers: { authorization: `Bearer ${token('reader-one')}` } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).removed, 2);
    assert.equal((await view(mf, 'study-mine01')).status, 404);
    assert.equal((await view(mf, 'study-mine02')).status, 404);
    assert.equal((await view(mf, 'study-other1')).status, 200);
  } finally { await mf.dispose(); }
});
