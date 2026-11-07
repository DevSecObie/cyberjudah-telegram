import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/ask-source-links.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/ask-source-links.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { originalBookUrl, bookScanUrl, librarySourcePdf, withAskBookLinks } = await import(out);

test('recorded book addresses are retained exactly, with no URL guessed for missing metadata', () => {
  for (const address of ['https://archive.org/details/recorded-edition/page/n45', 'https://books.google.com/books?id=recorded', 'https://www.gutenberg.org/ebooks/recorded']) assert.equal(originalBookUrl(address), address);
  for (const value of [undefined, null, '', '/relative/scan', 'Josephus', 'javascript:alert(1)', 'https://user:secret@example.test/book']) assert.equal(originalBookUrl(value), undefined);
});

test('scan uses a recorded direct image and never invents one from a viewer or a page title', () => {
  for (const address of ['https://archive.org/download/recorded-edition/page/n45_w1200.jpg', 'https://archive.org/services/iiif/recorded-edition/full/full/0/default.jpg', 'https://archive.org/BookReader/BookReaderImages.php?zip=recorded.zip&file=recorded.jp2', 'https://cyberjudah.io/app/recorded-page.webp']) assert.equal(bookScanUrl(address), address);
  for (const address of ['https://archive.org/details/recorded-edition/page/n45', 'https://example.test/page.jpg?key=required', 'https://example.test/book.pdf', 'Josephus p. 45', undefined]) assert.equal(bookScanUrl(address), undefined);
});

test('PDF descriptors use the cited volume’s recorded identity and only a held, sendable public-domain file', async () => {
  const book = { slug: 'recorded-book', license: 'Public domain.', items: [{ id: 'recorded-volume-1' }, { id: 'recorded-volume-2' }] };
  const keys = [], env = { LIBRARY: { head: async key => { keys.push(key); return { size: 1000 }; } } };
  assert.deepEqual(await librarySourcePdf(env, book, 2), { slug: 'recorded-book', item: 'recorded-volume-2' });
  assert.deepEqual(keys, ['library/recorded-volume-2.pdf']);
  for (const unavailable of [{}, { LIBRARY: { head: async () => null } }, { LIBRARY: { head: async () => ({ size: 51 * 1024 * 1024 }) } }, { LIBRARY: { head: async () => { throw new Error('offline'); } } }]) assert.equal(await librarySourcePdf(unavailable, book, 1), undefined);
  assert.equal(await librarySourcePdf(env, { ...book, license: 'Copyright' }, 1), undefined);
  assert.equal(await librarySourcePdf(env, book, 3), undefined);
  assert.equal(await librarySourcePdf(env, book, 1.5), undefined);
  assert.equal(await librarySourcePdf(env, { ...book, slug: '../other' }, 1), undefined);
});

test('book reader links become absolute without changing the pinned release, page or source words', () => {
  const source = { kind: 'book', title: 'The existing edition', text: 'The existing text.', n: 3, url: '/resources/josephus/old-release?key=page%2F1%2F45#scan', original: 'https://archive.org/details/recorded-edition/page/n45' };
  const [result] = withAskBookLinks([source]);
  assert.deepEqual(result, { ...source, url: 'https://cyberjudah.io/app/resources/josephus/old-release?key=page%2F1%2F45#scan' });
  assert.equal(source.url, '/resources/josephus/old-release?key=page%2F1%2F45#scan');
  assert.deepEqual(withAskBookLinks([result]), [result]);
});

test('external originals and non-book source links stay unchanged; invalid originals are omitted', () => {
  const web = { kind: 'web', title: 'An outside source', text: 'Existing words.', url: 'https://en.wikipedia.org/wiki/Example' };
  const book = { ...web, kind: 'book', url: 'https://archive.org/details/recorded-edition' };
  assert.deepEqual(withAskBookLinks([web, book]), [web, book]);
  assert.deepEqual(withAskBookLinks([{ ...book, original: 'javascript:alert(1)' }]), [book]);
  assert.ok(!('original' in withAskBookLinks([book])[0]));
});
