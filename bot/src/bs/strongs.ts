import { Hono } from 'hono';
import indexData from '../../data/bs-strong-index.json';
import { type App, type Ctx, type Verse, bookById, cmp, cursor, encodeCursor, html, integer, invalid, language, limit, load, metadata, missing, readChapter, sha, strongResource, version } from './core';

type Entry = { number: string; language: string; lemma: string; xlit: string; pron: string; derivation: string; def: string; kjv: string; source: string };
type IndexRow = { n: string; lemma: string; xlit: string; def: string; count: number };
type Span = { ordinal: number; startOffset: number; length: number; identities: { kind: 'strong'; code: string }[] };
const concordance = indexData as Record<string, string>;
export const strongBibles = new Hono<App>();
export const lexicon = new Hono<App>();
export function strongCode(raw: string, book?: number): string {
  const input = raw.trim().toUpperCase();
  const prefixed = /^[HG]/.test(input) ? input : book ? `${book <= 39 ? 'H' : 'G'}${input}` : input;
  const m = /^([HG])0*([1-9]\d*)$/.exec(prefixed);
  if (!m) return missing('STRONG_LEXICON_ENTRY_NOT_FOUND', 'Only classic Hebrew and Greek Strong identities are available');
  return `${m[1]}${Number(m[2])}`;
}
const id = (code: string) => Number(code.slice(1)) + (code[0] === 'G' ? 100000 : 0);
const identity = (code: string) => ({ kind: 'strong' as const, code });
const unavailableModule = (moduleId: string) => ({ moduleId, status: 'unavailable' as const });
export function spans(verse: Verse): Span[] {
  let offset = 0;
  return (verse.words ?? []).flatMap(([word, codes], ordinal) => {
    const startOffset = verse.text.indexOf(word, offset);
    if (startOffset < 0) throw new Error('Invalid Strong source alignment');
    offset = startOffset + word.length;
    return codes.length ? [{ ordinal, startOffset, length: word.length, identities: [...new Set(codes)].map(code => identity(strongCode(code))) }] : [];
  });
}
function occurrences(code: string) {
  const rows = new Map<number, { book: number; chapter: number; verse: number; spans: Span[] }>();
  const bytes = atob(concordance[code] ?? '');
  let offset = 0, location = 0;
  const number = () => {
    let value = 0, shift = 1, byte: number;
    do { byte = bytes.charCodeAt(offset++); value += (byte & 127) * shift; shift *= 128; } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    location += number();
    const ordinal = number(), startOffset = number(), length = number();
    const book = Math.floor(location / 1e6), chapter = Math.floor(location % 1e6 / 1e3), verse = location % 1e3;
    const row = rows.get(location) ?? { book, chapter, verse, spans: [] };
    row.spans.push({ ordinal, startOffset, length, identities: [identity(code)] }); rows.set(location, row);
  }
  return [...rows.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
}
function reference(c: Ctx) { version(c, true); return strongCode(c.req.param('reference') ?? '', bookById(c.req.param('book')).id); }
strongBibles.get('/:version/coverage', c => {
  version(c, true);
  return c.json({ resource: strongResource, books: Object.keys(metadata.strongChaptersByBook).map(Number), chaptersByBook: metadata.strongChaptersByBook, verseCountByBookChapter: metadata.strongVerseCountByBookChapter });
});
strongBibles.get('/:version/books/:book/chapters/:chapter', async c => {
  version(c, true);
  const book = bookById(c.req.param('book')).id, chapter = integer(c.req.param('chapter'), 1, 200);
  const data = await readChapter(c, book, chapter, true);
  return c.json({ resource: strongResource, book, chapter, verses: data.verses.map(v => ({ number: v.verse, spans: spans(v) })) });
});
strongBibles.get('/:version/books/:book/identities/:reference/counts', c => {
  const code = reference(c), counts = new Map<number, number>();
  for (const v of occurrences(code)) counts.set(v.book, (counts.get(v.book) ?? 0) + 1);
  return c.json({ resource: strongResource, identity: identity(code), counts: [...counts].map(([book, verseCount]) => ({ book, verseCount })) });
});
strongBibles.get('/:version/books/:book/identities/:reference/occurrences', c => {
  const code = reference(c), book = bookById(c.req.param('book')).id, take = limit(c, 500, 100);
  const allBooks = c.req.query('allBooks') ?? 'false';
  if (!['true', 'false'].includes(allBooks)) return invalid();
  if (c.req.query('lexemeId')) { integer(c.req.query('lexemeId'), 1, Number.MAX_SAFE_INTEGER); return c.json({ resource: strongResource, identity: identity(code), verses: [] }); }
  const raw = c.req.query('cursor');
  let after = [0, 0, 0];
  if (raw) {
    const m = /^strong:v1:(\d+):(\d+):(\d+)$/.exec(raw);
    if (!m) return invalid('Invalid Strong concordance cursor');
    after = m.slice(1).map(n => integer(n, 0, Number.MAX_SAFE_INTEGER));
  }
  const beyond = (v: { book: number; chapter: number; verse: number }) => v.book > after[0] || v.book === after[0] && (v.chapter > after[1] || v.chapter === after[1] && v.verse > after[2]);
  const rows = occurrences(code).filter(v => (allBooks === 'true' || v.book === book) && beyond(v));
  const verses = rows.slice(0, take), last = verses.at(-1);
  return c.json({ resource: strongResource, identity: identity(code), verses, ...(rows.length > take && last ? { nextCursor: `strong:v1:${last.book}:${last.chapter}:${last.verse}` } : {}) });
});
strongBibles.get('/:version/books/:book/identities/:reference/lemmas', c => {
  const code = reference(c);
  // The dataset has no lexeme/POS disambiguation. Do not invent STEP lemma IDs.
  return c.json({ resource: strongResource, identity: identity(code), lemmas: [] });
});
async function entry(c: Ctx, raw: string) {
  const code = strongCode(raw), data = await load<Entry | null>(c, `/api/strongs/${code}.json`, true);
  if (!data) return missing('STRONG_LEXICON_ENTRY_NOT_FOUND');
  return {
    resource: { revision: `cj-lexicon-${await sha(data)}` }, id: id(code), selectedIdentity: identity(code), stepCode: code, classicStrong: code, eStrong: '', dStrong: '',
    language: code[0] === 'H' ? 'hebrew' as const : 'greek' as const, baseCode: Number(code.slice(1)), original: data.lemma, transliteration: data.xlit || '',
    ...(data.pron ? { pronunciation: data.pron } : {}), gloss: data.def || data.kjv || '',
    definitionHtml: [data.def, data.derivation, data.kjv, data.source].filter(Boolean).map(t => `<p>${html(t)}</p>`).join(''),
    relations: [], resources: [], lsjAbsent: true, modules: { resources: unavailableModule('resources'), entities: unavailableModule('entities') },
  };
}
lexicon.get('/modules/:moduleId', c => {
  const moduleId = c.req.param('moduleId');
  if (!['core', 'resources', 'entities', 'simple-fr', 'simple-en'].includes(moduleId)) return missing('STRONG_LEXICON_ENTRY_NOT_FOUND');
  return c.json({ moduleId, status: moduleId === 'core' ? 'available' : 'unavailable', ...(moduleId === 'core' ? { revision: strongResource.strongRevision } : {}) });
});
lexicon.get('/entries/batch', async c => {
  language(c, 'STRONG_LEXICON_ENTRY_NOT_FOUND', true);
  const ids = c.req.query('identities')?.split(',');
  if (!ids?.length || ids.length > 100 || ids.some(s => !/^(strong|estrong|dstrong|ustrong):[^,]+$/.test(s))) return invalid();
  const entries = [];
  // Omit unsupported identities and unknown entries, as the batch contract permits.
  for (const item of [...new Set(ids)]) {
    if (!item.startsWith('strong:')) continue;
    try { entries.push(await entry(c, item.slice(7))); } catch (e) { if (!(e instanceof Error && 'status' in e && e.status === 404)) throw e; }
  }
  return c.json({ entries });
});
lexicon.get('/entries/:reference', async c => {
  language(c, 'STRONG_LEXICON_ENTRY_NOT_FOUND', true);
  if (c.req.query('kind') && c.req.query('kind') !== 'strong') return missing('STRONG_LEXICON_ENTRY_NOT_FOUND');
  return c.json(await entry(c, c.req.param('reference')));
});
async function browse(c: Ctx, random: boolean) {
  language(c, 'STRONG_LEXICON_ENTRY_NOT_FOUND', true);
  const index = await load<IndexRow[]>(c, '/api/strongs/index.json');
  const lexical = c.req.query('lexicalLanguage');
  if (lexical && !['hebrew', 'greek'].includes(lexical) || random && !lexical) return invalid();
  const search = (c.req.query('search') ?? '').toLowerCase(), prefix = (c.req.query('prefix') ?? '').toLowerCase();
  let rows = index.filter(r => (!lexical || r.n[0] === (lexical === 'hebrew' ? 'H' : 'G')) && (!search || [r.n, r.lemma, r.xlit, r.def].some(s => s.toLowerCase().includes(search))) && (!prefix || [r.n, r.lemma, r.xlit, r.def].some(s => s.toLowerCase().startsWith(prefix))));
  const key = (r: IndexRow) => ({ gloss: r.def, baseCode: Number(r.n.slice(1)), id: id(r.n) });
  const compare = (a: ReturnType<typeof key>, b: ReturnType<typeof key>) => cmp(a.gloss, b.gloss) || a.baseCode - b.baseCode || a.id - b.id;
  rows.sort((a, b) => compare(key(a), key(b)));
  const after = cursor(c) as ReturnType<typeof key> | undefined;
  if (after !== undefined && (!after || Array.isArray(after) || typeof after !== 'object' || typeof after.gloss !== 'string' || !Number.isInteger(after.id) || !Number.isInteger(after.baseCode))) return invalid();
  if (after) rows = rows.filter(r => compare(key(r), after) > 0);
  const take = random ? 1 : limit(c), page = random ? rows.slice(Math.floor(Math.random() * rows.length)).slice(0, 1) : rows.slice(0, take);
  return c.json({ resource: { revision: `cj-lexicon-${await sha(index)}` }, entries: page.map(r => ({ id: id(r.n), stepCode: r.n, classicStrong: r.n, language: r.n[0] === 'H' ? 'hebrew' : 'greek', original: r.lemma, transliteration: r.xlit || '', gloss: r.def })), ...(!random && rows.length > take ? { nextCursor: encodeCursor(key(page.at(-1)!)) } : {}) });
}
lexicon.get('/entries', c => browse(c, false));
lexicon.get('/random', c => browse(c, true));
lexicon.get('/morphologies', c => { language(c, 'STRONG_LEXICON_ENTRY_NOT_FOUND', true); if (!c.req.query('codes')) return invalid(); return c.json({ resource: { revision: strongResource.strongRevision }, morphologies: [] }); });
lexicon.get('/entities/chapters/:bookCode/:chapter', c => { language(c, 'STRONG_LEXICON_ENTITY_NOT_FOUND', true); integer(c.req.param('chapter'), 1, 200); return c.json({ resource: { revision: strongResource.strongRevision }, entities: [] }); });
lexicon.get('/entities/:uniqueName', c => missing('STRONG_LEXICON_ENTITY_NOT_FOUND'));
