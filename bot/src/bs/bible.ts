import { Hono } from 'hono';
import { runBibleSearch } from '../search';
import { type App, type Ctx, BOOKS, VERSION, bibleResource, bookById, emptyPresentation, html, integer, invalid, limit, load, location, mapLimit, metadata, missing, readChapter, unavailable, verseKey, version, versions } from './core';

export const bible = new Hono<App>();
async function chapterDto(c: Ctx, book: number, chapter: number) {
  const data = await readChapter(c, book, chapter);
  // Swete's Greek text is a parallel layer, not word-aligned Strong's annotations.
  const lxx = book > 66 ? await load<{ source: string; verses: Record<string, string> } | null>(c, `/api/lxx/${bookById(book).slug}/${chapter}.json`, true) : null;
  return { resource: bibleResource, book, chapter, verses: data.verses.map(v => {
    const presentation = emptyPresentation();
    const greek = lxx?.verses[v.verse];
    if (greek) presentation.notes.push({ offset: 0, order: 0, kind: 'note', markup: `<p>${html(lxx!.source)} (Greek parallel; verse numbering may differ)</p><p lang="el">${html(greek)}</p>` });
    return { number: v.verse, text: v.text, presentation };
  }) };
}
bible.get('/chapters', async c => {
  versions(c);
  const book = bookById(c.req.query('book')).id, chapter = integer(c.req.query('chapter'), 1, 200);
  return c.json({ chapters: [await chapterDto(c, book, chapter)] });
});
async function search(c: Ctx, multi: boolean, semantic: boolean) {
  if (multi) versions(c); else version(c);
  const q = c.req.query('q')?.trim();
  if (!q || q.length > 200) return invalid('Expected a search query of 1 to 200 characters');
  const take = limit(c, 100, 20), offset = integer(c.req.query('offset'), 0, Number.MAX_SAFE_INTEGER, 0);
  const b = c.req.query('book'), section = c.req.query('section'), canon = c.req.query('canon'), lang = c.req.query('language'), sort = c.req.query('sortOrder') ?? 'relevance';
  if (section && !['ot', 'nt'].includes(section) || lang && !['en', 'fr'].includes(lang) || !['relevance', 'book'].includes(sort)) return invalid();
  if (canon && !['protestant-66', 'catholic-73', 'clementine-vulgate', 'theotex-septuagint', 'kjv-1611'].includes(canon)) return invalid();
  // Version coverage supplies our canon; never silently reinterpret another canon's numbering.
  if (canon && !['protestant-66', 'kjv-1611'].includes(canon)) return missing('BIBLE_UNSUPPORTED', 'This canon is not provided by CyberJudah');
  const selected = b ? bookById(b).id : undefined;
  const books = BOOKS.filter(row => (!selected || row.id === selected) && (!section || (section === 'nt' ? row.id >= 40 && row.id <= 66 : row.id <= 39)) && (canon !== 'protestant-66' || row.id <= 66));
  let results: { version: string; book: number; chapter: number; verse: number; text: string; highlighted: string; match: { kind: 'lexical' } }[] = [], count = 0;
  if (!semantic && books.length) {
    const found = await runBibleSearch(c.env.DB, q, books.map(b => b.sourceName), take, offset, sort === 'book');
    if (!found.ok) return unavailable();
    count = found.count;
    results = found.hits.map(hit => {
      const ref = location(hit.url);
      if (!ref?.verse || !books.some(b => b.id === ref.book) || typeof hit.text !== 'string') return unavailable('The search index contains an invalid verse');
      return { version: VERSION, ...ref, text: hit.text, highlighted: html(hit.text), match: { kind: 'lexical' as const } };
    });
  }
  return c.json(multi ? { resources: [bibleResource], results, count } : { resource: bibleResource, results, count });
}
bible.get('/search', c => search(c, true, false));
bible.get('/semantic-search', c => search(c, true, true));
bible.get('/:version/search', c => search(c, false, false));
bible.get('/:version/semantic-search', c => search(c, false, true));
bible.get('/:version/books/:book/chapters/:chapter', async c => {
  version(c);
  return c.json(await chapterDto(c, bookById(c.req.param('book')).id, integer(c.req.param('chapter'), 1, 200)));
});
bible.get('/:version/verses', async c => {
  version(c);
  const keys = c.req.query('references')?.split(',');
  if (!keys?.length || keys.length > 200) return invalid('Expected 1 to 200 references');
  const refs = keys.map(k => verseKey(k));
  const groups = [...new Map(refs.map(r => [`${r.book.id}-${r.chapter}`, r])).values()];
  // Batch by chapter, retaining request order (including duplicate keys).
  const chapters = new Map((await mapLimit(groups, async r => [`${r.book.id}-${r.chapter}`, await readChapter(c, r.book.id, r.chapter)] as const)));
  const verses = refs.map(r => {
    const verse = chapters.get(`${r.book.id}-${r.chapter}`)!.verses.find(v => v.verse === r.verse);
    if (!verse) return missing('BIBLE_VERSES_NOT_FOUND');
    return { book: r.book.id, chapter: r.chapter, number: verse.verse, text: verse.text };
  });
  return c.json({ resource: bibleResource, verses });
});
bible.get('/:version/coverage', c => {
  version(c);
  return c.json({ resource: bibleResource, canon: { id: 'kjv-1611', orderedBooks: BOOKS.map(b => b.id) }, versification: 'kjv-1611', books: BOOKS.map(b => b.id), chaptersByBook: metadata.chaptersByBook, verseCountByBookChapter: metadata.verseCountByBookChapter });
});
bible.get('/:version/pericopes', c => { version(c); return c.json({ resource: bibleResource, verses: [] }); });
