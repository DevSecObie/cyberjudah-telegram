import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: [new URL('../src/bible/offline-search.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm' });
const { searchOfflineChapters } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const books = [{ book: 'Genesis', slug: 'genesis', testament: 'Old Testament', chapterIds: [1, 2] }, { book: 'John', slug: 'john', testament: 'New Testament', chapterIds: [1] }];
const opts = { books, offset: 0, limit: 20, sort: 'book', read: async (slug, chapter) => chapter === 2 ? null : ({ verses: Array.from({ length: 25 }, (_, i) => ({ verse: i + 1, text: slug === 'genesis' ? 'In the beginning God created the heaven and the earth.' : 'The beginning of the Word.' })) }) };
test('offline search pages only downloaded chapters, with deterministic order and truthful missing coverage', async () => {
 const first = await searchOfflineChapters('beginning', opts), second = await searchOfflineChapters('beginning', { ...opts, offset: 20 });
 assert.equal(first.count, 50); assert.equal(first.results.length, 20); assert.equal(second.results[0].verse, 21);
 assert.deepEqual(first.offline, { books: 2, chapters: 2, missing: 1 });
 assert.equal(first.results[0].book, 1); assert.equal(second.results[5].book, 43);
 assert.equal((await searchOfflineChapters('beginning', { ...opts, canon: 'New Testament' })).count, 25);
 assert.equal((await searchOfflineChapters('beginning', { ...opts, book: 'genesis' })).count, 25);
});
test('quoted phrases stay exact, common words inside phrases survive, and sparse searches retain all phrases', async () => {
 assert.equal((await searchOfflineChapters('"the beginning"', opts)).count, 50);
 assert.equal((await searchOfflineChapters('"beginning God" absent earth', opts)).count, 25);
 assert.equal((await searchOfflineChapters('"God beginning"', opts)).count, 0);
 assert.equal((await searchOfflineChapters('!!!', opts)).count, 0);
});
test('cancelling an offline search stops before scanning cached chapters', async () => {
 const controller = new AbortController(); controller.abort();
 await assert.rejects(searchOfflineChapters('beginning', { ...opts, signal: controller.signal, read: () => { throw new Error('must not read'); } }), { name: 'AbortError' });
});
