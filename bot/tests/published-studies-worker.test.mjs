import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// The publish routes in the real Workers runtime, with a real D1 and Google's sign-in check stood in.
const { outputFiles } = await build({
  stdin: {
    contents: `import { Hono } from "hono";
      import { publishedStudies, publishedStudyPage, takeDownStudy } from "./src/published-studies.ts";
      import { firebaseAuth } from "./src/firebase-auth.ts";
      const app = new Hono();
      app.use("*", async (c, next) => { c.env.FIREBASE_AUTH_LIMIT = { limit: async () => ({ success: true }) }; await next(); });
      app.route("/api/published-studies", publishedStudies);
      app.route("/app/published", publishedStudyPage);
      app.route("/api/firebase", firebaseAuth);
      // Test only: the admin takedown the bot's /takedown runs (its admin check is tested in takedown-command.test.mjs).
      app.delete("/test/takedown/:id", async c => c.json({ removed: await takeDownStudy(c.env, c.req.param("id")) }));
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
const takedown = (mf, id) => mf.dispatchFetch(`https://cyberjudah.test/test/takedown/${encodeURIComponent(id)}`, { method: 'DELETE' });

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


// Reporting, as Bible Strong does it: an email with the study's link (Terms, "Your notes and shared studies").
test('every published page has a plain "Report this study" mailto with only its link and title, and no added footer line', async () => {
  const mf = worker();
  try {
    assert.equal((await put(mf, 'study-report1', 'reader-one', { title: 'Judah & "the" <Tribes>', author: 'Asahel', body: 'Text' })).status, 200);
    const res = await view(mf, 'study-report1');
    const html = await res.text();
    // Owner: match Bible Strong, whose study page has no report line, so none is added.
    assert.doesNotMatch(html, /24 hours|Reported studies/);
    assert.match(html, /<footer><p>Written in the CyberJudah app\.<\/p><p><a href="mailto:/);
    const links = [...html.matchAll(/<a href="(mailto:[^"]*)">Report this study<\/a>/g)];
    assert.equal(links.length, 1, 'one visible report link');
    // The attribute is HTML-escaped; unescaped it is a mailto to the contact address.
    const href = links[0][1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    const url = new URL(href);
    assert.equal(url.protocol, 'mailto:');
    assert.equal(url.pathname, 'privacy@cyberjudah.io');
    assert.deepEqual([...url.searchParams.keys()], ['subject', 'body']);
    assert.equal(url.searchParams.get('subject'), 'Report: Judah & "the" <Tribes>');
    assert.equal(url.searchParams.get('body'), 'Study: https://cyberjudah.test/app/published/study-report1\n\nReason:\n');
    // No author, owner hash or tracking in it, and no raw quote or bracket breaks out of the attribute.
    assert.doesNotMatch(href, /Asahel|reader-one|utm_|owner/i);
    assert.doesNotMatch(links[0][1], /["<>]/);
    // No script anywhere, and the page's CSP still allows none.
    assert.doesNotMatch(html, /<script|\son[a-z]+=/i);
    assert.doesNotMatch(res.headers.get('content-security-policy'), /script-src/);
    // The missing-study page offers no report link.
    assert.doesNotMatch(await (await view(mf, 'study-absent1')).text(), /Report this study/);
  } finally { await mf.dispose(); }
});

test('a study an admin took down 404s, cannot be published again under its id, and other studies stay', async () => {
  const mf = worker();
  try {
    for (const id of ['study-down01', 'study-keep01']) assert.equal((await put(mf, id, 'reader-one', { title: id, body: 'text' })).status, 200);
    assert.deepEqual(await (await takedown(mf, 'study-down01')).json(), { removed: true });
    assert.equal((await view(mf, 'study-down01')).status, 404);
    assert.equal((await mf.dispatchFetch('https://cyberjudah.test/api/published-studies/study-down01')).status, 404);
    assert.equal((await view(mf, 'study-keep01')).status, 200);
    const res = await put(mf, 'study-down01', 'reader-one', { title: 'again', body: 'text' });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'taken_down');
    assert.equal((await view(mf, 'study-down01')).status, 404);
    // Kept: only the id and when; nothing about the writer or a reporter.
    const db = await mf.getD1Database('DB');
    const rows = (await db.prepare('SELECT * FROM published_takedowns').all()).results;
    assert.deepEqual(rows.map(r => Object.keys(r).sort()), [['at', 'id']]);
    assert.equal(rows[0].id, 'study-down01');
    // A missing or malformed id removes nothing and keeps nothing.
    assert.deepEqual(await (await takedown(mf, 'study-never1')).json(), { removed: false });
    assert.deepEqual(await (await takedown(mf, 'bad id!')).json(), { removed: false });
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM published_takedowns').first()).n, 1);
    assert.equal((await put(mf, 'study-never1', 'reader-two', { title: 't', body: 'b' })).status, 200);
  } finally { await mf.dispose(); }
});

test('a title with an emoji at the subject cut still renders its page', async () => {
  const mf = worker();
  try {
    const title = 'a'.repeat(149) + '\u{1F600}' + 'b'.repeat(40);
    assert.equal((await put(mf, 'study-emoji1', 'reader-one', { title, body: 'text' })).status, 200);
    const res = await view(mf, 'study-emoji1');
    assert.equal(res.status, 200);
    const href = /<a href="(mailto:[^"]*)">Report this study<\/a>/.exec(await res.text())[1].replace(/&amp;/g, '&');
    assert.equal(new URL(href).searchParams.get('subject'), `Report: ${'a'.repeat(149)}\u{1F600}`);
  } finally { await mf.dispose(); }
});
