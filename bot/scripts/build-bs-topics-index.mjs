/** Build verse-to-topic associations from one local CyberJudah data publication.
 * Only topic identities, labels and numeric associations are retained.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildTopicIndex({ rows, books, readTopic, manifest }) {
  const topics = [], verses = {}, chapters = {}, slugs = new Set();
  const append = (index, key, id) => {
    const ids = index[key] ??= [];
    if (ids.at(-1) !== id) ids.push(id);
  };
  for (const row of [...rows].sort((a, b) => a.slug.localeCompare(b.slug, 'en'))) {
    if (!/^[a-z0-9-]{1,100}$/.test(row.slug) || slugs.has(row.slug)) throw new Error(`Invalid or duplicate topic ${row.slug}`);
    slugs.add(row.slug);
    const topic = await readTopic(row.slug);
    if (topic.slug !== row.slug || topic.label !== row.label || !row.label) throw new Error(`Inconsistent topic ${row.slug}`);
    const id = topics.length;
    topics.push({ normalizedName: row.slug, name: row.label });
    for (const stop of topic.thread ?? []) {
      const match = /^\/bible\/([a-z0-9-]+)\/([1-9]\d*)(?:\?[^#]*)?(?:#v[1-9]\d*)?$/.exec(stop.url);
      const book = match && books.find(b => b.slug === match[1]);
      if (!book || Number(match[2]) > 200 || typeof stop.verses !== 'string') throw new Error(`Invalid topic reference in ${row.slug}: ${stop.url}`);
      const key = `${book.id}-${Number(match[2])}`;
      if (!stop.verses.trim()) { append(chapters, key, id); continue; }
      for (const part of stop.verses.split(/[,;]/)) {
        const range = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
        const start = Number(range?.[1]), end = Number(range?.[2] ?? range?.[1]);
        if (!range || start < 1 || end > 200 || end < start) throw new Error(`Invalid topic verses in ${row.slug}: ${stop.verses}`);
        for (let verse = start; verse <= end; verse++) append(verses, `${key}-${verse}`, id);
      }
    }
  }
  // Sort keys so source thread order does not affect the association revision.
  const sorted = index => Object.fromEntries(Object.entries(index).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const associations = { topics, verses: sorted(verses), chapters: sorted(chapters) };
  const revision = `cj-topics-${createHash('sha256').update(JSON.stringify(associations)).digest('hex')}`;
  return { sourceCommit: manifest.commit, built: manifest.built, revision, ...associations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.argv[2];
  if (!root) throw new Error('Pass a CyberJudah data publication directory');
  const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const books = JSON.parse(await readFile(new URL('../data/bs-books.json', import.meta.url), 'utf8'));
  const result = await buildTopicIndex({ books, rows: await read('api/topics/index.json'), manifest: await read('manifest.json'), readTopic: slug => read(`api/topics/${slug}.json`) });
  await writeFile(new URL('../data/bs-topics-index.json', import.meta.url), JSON.stringify(result) + '\n');
  console.log(`Indexed ${result.topics.length} topics and ${Object.keys(result.verses).length} verse associations from ${result.sourceCommit}`);
}
