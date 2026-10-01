/** Build coverage and the complete concordance from a single CyberJudah data publication.
 * Usage: node scripts/build-bs-index.mjs /path/to/cyberjudah-data-checkout
 * No Bible Strong content is read. Only counts, hashes and numeric offsets are retained.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('Pass a CyberJudah data publication directory');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const books = JSON.parse(await readFile(new URL('../data/bs-books.json', import.meta.url), 'utf8'));
const manifest = await read('manifest.json');
const sourceBooks = await read('api/kjv/books.json');
const text = [], packed = {}, previous = {}, chapters = {}, strongChapters = {}, chapterHashes = {}, strongChapterHashes = {}, counts = {}, strongCounts = {};
for (const book of books) {
  const row = sourceBooks.find(row => row.slug === book.slug);
  if (!row) throw new Error(`Missing book ${book.slug}`);
  chapters[book.id] = row.chapterIds;
  for (const chapter of row.chapterIds) {
    const data = await read(`api/kjv/${book.slug}/${chapter}.json`);
    const key = `${book.id}-${chapter}`;
    const verses = data.verses.map(v => [v.verse, v.text]);
    text.push([book.id, chapter, verses]);
    chapterHashes[key] = hash(verses);
    strongChapterHashes[key] = hash(data.verses.map(v => [v.verse, v.text, v.words ?? []]));
    counts[key] = data.verses.length;
    let taggedVerses = 0;
    for (const verse of data.verses) {
      let offset = 0, tagged = false;
      for (const [ordinal, [word, codes]] of (verse.words ?? []).entries()) {
        const start = verse.text.indexOf(word, offset);
        if (start < 0) throw new Error(`Unaligned source word at ${key}-${verse.verse}`);
        offset = start + word.length;
        for (const code of new Set(codes)) {
          if (!/^[HG][1-9]\d*$/.test(code)) throw new Error(`Unexpected Strong identity ${code}`);
          // Unsigned LEB128 tuples, base64 per identity. Delta-encode the ordered
          // location to keep complete concordance data inside the Worker size budget.
          const location = book.id * 1e6 + chapter * 1e3 + verse.verse;
          const bytes = packed[code] ??= [];
          for (let value of [location - (previous[code] ?? 0), ordinal, start, word.length]) {
            do { const byte = value % 128; value = Math.floor(value / 128); bytes.push(byte + (value ? 128 : 0)); } while (value);
          }
          previous[code] = location;
          tagged = true;
        }
      }
      if (tagged) taggedVerses++;
    }
    if (taggedVerses) {
      (strongChapters[book.id] ??= []).push(chapter);
      strongCounts[key] = taggedVerses;
    }
  }
}
const strong = Object.fromEntries(Object.entries(packed).map(([code, bytes]) => [code, Buffer.from(bytes).toString('base64')]));
const metadata = {
  sourceCommit: manifest.commit, built: manifest.built,
  textSha256: hash(text), strongSha256: hash(strong),
  chaptersByBook: chapters, verseCountByBookChapter: counts, chapterHashes,
  strongChaptersByBook: strongChapters, strongVerseCountByBookChapter: strongCounts, strongChapterHashes,
};
await writeFile(new URL('../data/bs-metadata.json', import.meta.url), JSON.stringify(metadata) + '\n');
await writeFile(new URL('../data/bs-strong-index.json', import.meta.url), JSON.stringify(strong) + '\n');
console.log(`Indexed ${text.length} chapters and ${Object.keys(strong).length} Strong identities from ${manifest.commit}`);
