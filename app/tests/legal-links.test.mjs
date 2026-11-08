import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SECTIONS } from '../../shared/links.mjs';

// The Mini App is served under /app on cyberjudah.io (and at / on workers.dev). A plain
// <a href="/privacy"> renders that path literally, so opened outside the SPA (a new tab, a
// long-press in Telegram, a copied link) it lands on cyberjudah.io/privacy: since the backend's
// site legal pages (bot/src/site-legal.ts), that is the phone app's policy, and for any other
// section the site root has nothing. Every in-app link goes through the router instead
// (<Link to>, navigate(), or Row's href, which renders a Link), which adds the base path.
const src = fileURLToPath(new URL('../src', import.meta.url));
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx?|jsx?)$/.test(e.name) ? [path.join(dir, e.name)] : []);

/** Each <a ...> opening tag in JSX, read to its closing '>' outside braces (so `=>` in an onClick does not end it). */
export function anchorTags(code) {
  const tags = [];
  for (const m of code.matchAll(/<a(?=[\s>])/g)) {
    let depth = 0, i = m.index + 2, quote = null;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (quote) { if (ch === quote && code[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(code.slice(m.index, i + 1));
  }
  return tags;
}
const sections = new Set(APP_SECTIONS);
/** A literal href to one of the Mini App's own routes ("/privacy", {"/terms#x"}, {`/delete-account`}). */
const inAppHref = (tag) => {
  const m = /\bhref\s*=\s*\{?\s*["'`]\/([a-z0-9-]+)(?:[/?#][^"'`]*)?["'`]/.exec(tag);
  return m && sections.has(m[1]) ? m[0] : null;
};

test('no app/src anchor uses a plain href to one of the Mini App\'s own routes', () => {
  const found = files(src).flatMap((f) => anchorTags(fs.readFileSync(f, 'utf8')).map(inAppHref).filter(Boolean).map((h) => `${path.relative(src, f)}: ${h}`));
  assert.deepEqual(found, []);
});

test('the guard catches the old forms, including an onClick with => before href, and leaves other links alone', () => {
  const caught = (code) => anchorTags(code).map(inAppHref).filter(Boolean).length;
  assert.equal(caught('<a href="/privacy" onClick={go("/privacy")}>Privacy</a>'), 1);
  assert.equal(caught('<a onClick={(e) => { e.preventDefault(); navigate("/terms"); }} href="/terms">Terms</a>'), 1);
  assert.equal(caught('<a href={`/delete-account`}>Delete</a>'), 1);
  assert.equal(caught('<a href="https://cyberjudah.io/privacy">x</a><a href={`mailto:${c}`}>y</a><a href="/api/backup">z</a>'), 0);
});

test('the policy links are still there, through the router', () => {
  const all = files(src).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const p of ['privacy', 'terms', 'delete-account']) assert.ok(new RegExp(`<Link to="/${p}"`).test(all), `a <Link to="/${p}"> exists`);
});
