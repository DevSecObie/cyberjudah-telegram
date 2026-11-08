import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';

// cyberjudah.io/privacy and /terms: the store listing's legal pages, served by this Worker as
// plain HTML. The Mini App's /app/privacy and /app/terms still come from the assets.
const out = new URL('./.build/site-legal.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/site-legal.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const m = await import(out);
const assets = [];
const env = { ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response('spa', { headers: { 'content-type': 'text/html' } }); } } };
const get = (path, method = 'GET', host = 'cyberjudah.io') => m.worker.fetch(new Request(`https://${host}${path}`, { method, redirect: 'manual' }), env, { waitUntil() {}, passThroughOnException() {} });

for (const [path, title, other] of [['/privacy', 'Privacy Policy', '/terms'], ['/terms', 'Terms of Use', '/privacy']]) {
  test(`${path} is a plain HTML page, cached, readable without JavaScript, linking to ${other}`, async () => {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const html = await res.text();
    assert.match(html, /^<!doctype html>/);
    assert.match(html, new RegExp(`<title>CyberJudah: ${title}</title>`));
    assert.match(html, /<h1>[^<]+<\/h1>/, 'one page title');
    assert.ok(html.includes(`<a href="${other}">`), 'links to the other page');
    assert.ok(!/<script/i.test(html), 'no script: the text is in the HTML itself');
  });
}

test('HEAD works, and the Mini App\'s /app/privacy and /app/terms still come from the assets', async () => {
  assert.equal((await get('/privacy', 'HEAD')).status, 200);
  assets.length = 0;
  await get('/app/privacy');
  await get('/app/terms');
  assert.deepEqual(assets, ['/app/privacy', '/app/terms']);
});

test('only on cyberjudah.io: on workers.dev or staging, /privacy and /terms stay the Mini App\'s own screens', async () => {
  assets.length = 0;
  for (const host of ['cyberjudah-telegram.example.workers.dev', 'staging.example.workers.dev']) {
    for (const p of ['/privacy', '/terms', '/privacy/', '/terms/']) assert.equal(await (await get(p, 'GET', host)).text(), 'spa', `${host}${p}`);
  }
  assert.equal(assets.length, 8);
});

test('SITE_LEGAL_PAGES "off" (the end-to-end tests, where wrangler dev reports cyberjudah.io) leaves them to the Mini App', async () => {
  assets.length = 0;
  const off = { ...env, SITE_LEGAL_PAGES: 'off' };
  for (const p of ['/privacy', '/terms', '/privacy/', '/terms/']) {
    const res = await m.worker.fetch(new Request(`https://cyberjudah.io${p}`, { redirect: 'manual' }), off, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(await res.text(), 'spa', p);
  }
  assert.equal(assets.length, 4);
});

test('the trailing-slash form redirects to the page', async () => {
  for (const p of ['privacy', 'terms']) {
    const res = await get(`/${p}/`);
    assert.equal(res.status, 301);
    assert.equal(new URL(res.headers.get('location'), 'https://cyberjudah.io').pathname, `/${p}`);
  }
});

test('the pasted text is rendered as headings, lists and paragraphs, every character escaped', () => {
  const html = m.legalHtml('# Title\n\n## Section\n\nLine one\nline two & <b>three</b>\n\n- a "b"\n- c');
  assert.equal(html, '<h1>Title</h1>\n<h2>Section</h2>\n<p>Line one<br>line two &amp; &lt;b&gt;three&lt;/b&gt;</p>\n<ul><li>a &quot;b&quot;</li><li>c</li></ul>');
});

test('the approved files\' format: "## " title and "### " sections shift up, numbered items, bold and italic', () => {
  const html = m.legalHtml('## Title\n\n*Last updated soon*\n\n### Part\n\n1. **One.** first\n2. **Two.** <second>\n\n- **x** y');
  assert.equal(html, '<h1>Title</h1>\n<p><em>Last updated soon</em></p>\n<h2>Part</h2>\n<ol><li><strong>One.</strong> first</li><li><strong>Two.</strong> &lt;second&gt;</li></ol>\n<ul><li><strong>x</strong> y</li></ul>');
  assert.equal(m.legalHtml('3. c\n4. d'), '<ol start="3"><li>c</li><li>d</li></ol>');
  assert.equal(m.legalHtml('## T\n### A\nText\n- x\n- y\nAfter'), '<h1>T</h1>\n<h2>A</h2>\n<p>Text</p>\n<ul><li>x</li><li>y</li></ul>\n<p>After</p>', 'headings and lists need no blank line around them');
});

test('the routes reach this Worker on cyberjudah.io, before the Mini App\'s assets', () => {
  const src = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  for (const p of ['/privacy', '/terms']) {
    assert.ok(src.includes(`"cyberjudah.io${p}"`), `route cyberjudah.io${p}`);
    assert.ok(src.includes(`"cyberjudah.io${p}/"`), `route cyberjudah.io${p}/`);
    assert.match(src, new RegExp(`"run_worker_first": \\[[^\\]]*"${p}"`), `${p} runs the Worker first`);
  }
});

// The served pages carry the owner-approved text exactly: docs/legal/*.md are byte copies of the
// approved files (the part between the '---' lines), and every line of them appears in the page,
// HTML-escaped, in order, with only the markdown markers (and https links) turned into tags.
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
for (const [path, name, file] of [['/privacy', 'PRIVACY_TEXT', 'privacy.md'], ['/terms', 'TERMS_TEXT', 'terms.md']]) {
  test(`${path} serves the approved text in docs/legal/${file}, every line escaped and in order`, async () => {
    const approved = fs.readFileSync(new URL(`../../docs/legal/${file}`, import.meta.url), 'utf8');
    assert.equal(m[name], approved.replace(/\n$/, ''), `${name} is byte-identical to docs/legal/${file}`);
    const page = await (await get(path)).text();
    assert.ok(page.includes('<a href="mailto:privacy@cyberjudah.io">privacy@cyberjudah.io</a>'), 'the contact address is a mailto link');
    // The mailto links only wrap words already in the text.
    const html = page.replace(/<a href="mailto:[^"]+">([^<]+)<\/a>/g, '$1');
    let at = 0;
    for (const line of approved.split('\n').filter((l) => l.trim())) {
      const content = line.replace(/^#{1,6} /, '').replace(/^- /, '').replace(/^\d+\. /, '');
      const expected = esc(content).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(\S(?:.*?\S)?)\*/g, '<em>$1</em>');
      const found = html.indexOf(expected, at);
      assert.ok(found >= 0, `missing or out of order: ${content.slice(0, 60)}`);
      at = found + expected.length;
    }
    // Strip tags until nothing changes, so a tag rebuilt by one pass cannot survive (CodeQL js/incomplete-multi-character-sanitization).
    let text = html.replace(/<style>[\s\S]*?<\/style>/, '');
    for (let prev; prev !== text;) { prev = text; text = text.replace(/<[^>]+>/g, ''); }
    assert.ok(!/[*#<>]|\]\(/.test(text), 'no markdown or markup left in the text');
  });
}

test('markdown links in the policy become https links with their words unchanged', async () => {
  const html = await (await get('/privacy')).text();
  assert.match(html, /<li><a href="https:\/\/firebase\.google\.com\/support\/privacy">Firebase privacy and security<\/a><\/li>/);
  assert.match(html, /<a href="https:\/\/www\.cloudflare\.com\/privacypolicy\/">Cloudflare privacy policy<\/a>/);
  assert.doesNotMatch(html, /\]\(/);
});

test('only [text](https://...) becomes a link: javascript:, data: and http: stay plain text, and the URL is attribute-escaped', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.test/', 'JAVASCRIPT:alert(1)', ' https://example.test/']) {
    const html = m.legalHtml(`[click](${url})`);
    assert.doesNotMatch(html, /<a /, url);
    assert.ok(html.includes('[click]('), url);
  }
  const quoted = m.legalHtml('[x](https://a.test/"onmouseover="alert(1))');
  assert.match(quoted, /<a href="https:\/\/a\.test\/&quot;onmouseover=&quot;alert\(1">x<\/a>/);
  assert.doesNotMatch(quoted, /href="[^"]*" onmouseover/);
  const tagged = m.legalHtml('[x](https://a.test/<script>)');
  assert.ok(!tagged.includes('<script>') && tagged.includes('&lt;script&gt;'));
});

test('SITE_LEGAL_PAGES is on unless set to the literal "off": unset, empty and other values all serve the pages', async () => {
  for (const value of [undefined, '', 'on', 'OFF', 'false', '0']) {
    const res = await m.worker.fetch(new Request('https://cyberjudah.io/privacy'), { ...env, ...(value === undefined ? {} : { SITE_LEGAL_PAGES: value }) }, { waitUntil() {}, passThroughOnException() {} });
    assert.match(await res.text(), /<h1>Privacy Policy<\/h1>/, String(value));
  }
});
