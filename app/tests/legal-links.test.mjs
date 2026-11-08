import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// cyberjudah.io/privacy and /terms are the phone app's policy pages (bot site-legal.ts). The Mini
// App's own screens are /privacy and /terms inside its router (/app/privacy on cyberjudah.io). A
// plain <a href="/privacy"> renders that path literally, so opened outside the SPA (a new tab, a
// long-press in Telegram, a copied link) it would land on the other app's policy. Every in-app
// link to them goes through the router (<Link to>, navigate(), or Row's href, which uses Link),
// which adds the base path.
const src = fileURLToPath(new URL('../src', import.meta.url));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []);

test('no app/src anchor points at a bare /privacy or /terms', () => {
  const bare = /<a\b[^>]*?\bhref\s*=\s*(?:\{\s*)?["'`]\/(?:privacy|terms)(?:[/?#][^"'`]*)?["'`]/g;
  const found = files(src).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(bare)].map((m) => `${path.relative(src, f)}: ${m[0]}`));
  assert.deepEqual(found, []);
});

test('the policy links are still there, through the router', () => {
  const all = files(src).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const p of ['privacy', 'terms']) assert.ok(new RegExp(`<Link to="/${p}"`).test(all), `a <Link to="/${p}"> exists`);
  // The guard itself catches the old form.
  assert.match('<a href="/privacy" onClick={go("/privacy")}>', /<a\b[^>]*?\bhref\s*=\s*(?:\{\s*)?["'`]\/(?:privacy|terms)/);
});
