#!/usr/bin/env node
/** Reproduce the verse-bound metadata from the existing approved Phase 2 source pins. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const lock = JSON.parse(await fs.readFile(new URL('resources/sources.lock.json', root), 'utf8'));
const cache = process.env.RESOURCE_SOURCE_CACHE;
if (!cache) throw new Error('Set RESOURCE_SOURCE_CACHE to the verified resource source cache directory.');
const sources = await Promise.all(lock.bible.map(async source => {
  const bytes = await fs.readFile(path.join(cache, source.sha256));
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Source checksum mismatch: ${source.path}`);
  return { source, data: JSON.parse(bytes) };
}));
const index = sources.find(s => s.source.path === 'data/bible/index.json').data;
const books = index.map(entry => {
  const { source, data } = sources.find(s => s.source.path === `data/bible/${entry.slug}.json`);
  return { book: data.book, slug: entry.slug, sha256: source.sha256, chapters: Object.fromEntries(Object.entries(data.chapters).map(([chapter, verses]) => [chapter, verses.length])) };
});
const output = JSON.stringify({ source: { repository: 'DevSecObie/cyberjudah', commit: lock.bible[0].revision }, books }) + '\n';
const target = new URL('shared/cms-bible.json', root);
if (process.argv.includes('--check')) {
  if (await fs.readFile(target, 'utf8') !== output) throw new Error('CMS Bible verse bounds differ from pinned source files.');
} else await fs.writeFile(target, output);
console.log(`Verified verse bounds for ${books.length} Bible books.`);
