import { Hono } from 'hono';
import entries from '../../data/easton.json';
import provenance from '../../data/provenance.json';
import { lookup } from '../dictionary';
import { type App, type Ctx, cmp, cursor, encodeCursor, invalid, language, limit, missing, paragraphs, readChapter, verseKey } from './core';

export const dictionaries = new Hono<App>();
const resource = { kind: 'dictionary' as const, work: 'easton', language: 'en' as const, revision: `cj-easton-${provenance.sha256}` };
const work = { resource, resourceId: 'easton-en', title: "Easton's Bible Dictionary", abbreviation: 'Easton', authors: ['Matthew George Easton'], description: "Easton's Bible Dictionary as published by CyberJudah.", edition: '1897', source: 'https://data.cyberjudah.io', attribution: "Easton's Bible Dictionary; CyberJudah dataset. See bot/data/provenance.json for source attribution.", onlineAccess: true, offlineDownload: false };
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const rows = entries.map((entry, i) => ({ ...entry, id: i + 1, word: entry.term, normalizedWord: normalize(entry.term) }));
const summary = (e: typeof rows[number]) => ({ id: e.id, word: e.word, normalizedWord: e.normalizedWord });
const full = (e: typeof rows[number]) => ({ id: e.id, word: e.word, definition: e.definitions.map(paragraphs).join('') });
const source = (e: typeof rows[number]) => ({ resource, resourceId: work.resourceId, title: work.title, abbreviation: work.abbreviation, ...summary(e) });
function requireWork(c: Ctx) { language(c, 'DICTIONARY_UNSUPPORTED'); if (c.req.param('work') !== 'easton') return missing('DICTIONARY_UNSUPPORTED'); }
function find(word: string) { return rows.find(e => e.normalizedWord === normalize(word) || e.slug === word); }
function filtered(c: Ctx) {
  const initial = normalize(c.req.query('initial') ?? ''), search = normalize(c.req.query('search') ?? '');
  return rows.filter(e => (!initial || e.normalizedWord.startsWith(initial)) && (!search || e.normalizedWord.includes(search))).sort((a, b) => cmp(a.normalizedWord, b.normalizedWord) || a.id - b.id);
}
dictionaries.get('/', c => {
  const lang = c.req.query('language');
  if (lang && !['en', 'fr'].includes(lang)) return invalid();
  return c.json({ dictionaries: !lang || lang === 'en' ? [work] : [] });
});
dictionaries.get('/directory', c => {
  const lang = c.req.query('language');
  if (!lang || !['en', 'fr'].includes(lang)) return invalid();
  const take = limit(c), after = cursor(c);
  if (after !== undefined && (!Array.isArray(after) || typeof after[0] !== 'string' || typeof after[1] !== 'string')) return invalid();
  const itemKey = (e: typeof rows[number]) => `easton:${e.slug}`;
  const selected = lang === 'fr' ? [] : filtered(c).filter(e => !after || cmp(e.normalizedWord, (after as string[])[0]) > 0 || e.normalizedWord === (after as string[])[0] && cmp(itemKey(e), (after as string[])[1]) > 0);
  selected.sort((a, b) => cmp(a.normalizedWord, b.normalizedWord) || cmp(itemKey(a), itemKey(b)));
  const page = selected.slice(0, take), last = page.at(-1);
  return c.json({ language: lang, items: page.map(e => ({ key: itemKey(e), label: e.word, normalizedLabel: e.normalizedWord, sources: [source(e)] })), limit: take, ...(selected.length > take && last ? { nextCursor: encodeCursor([last.normalizedWord, itemKey(last)]) } : {}) });
});
async function passage(c: Ctx) {
  const ref = verseKey(c.req.param('verseKey') ?? '');
  const chapter = await readChapter(c, ref.book.id, ref.chapter);
  const text = chapter.verses.find(v => v.verse === ref.verse)?.text;
  if (text === undefined) return missing('BIBLE_VERSES_NOT_FOUND');
  // Literal term/phrase matches only. No invented source-citation evidence.
  const normalized = ` ${normalize(text).replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ')} `;
  return rows.filter(e => normalized.includes(` ${e.normalizedWord} `)).map(e => ({ ...summary(e), evidenceKind: 'verse-phrase' as const }));
}
dictionaries.get('/verses/:verseKey/entries', async c => {
  const lang = c.req.query('language') ?? 'en';
  if (!['en', 'fr'].includes(lang)) return invalid();
  verseKey(c.req.param('verseKey') ?? '');
  return c.json({ verseKey: c.req.param('verseKey'), entries: lang === 'en' ? (await passage(c)).map(e => ({ resource, resourceId: work.resourceId, title: work.title, abbreviation: work.abbreviation, ...e })) : [] });
});
dictionaries.get('/:work/:language/entries', c => {
  requireWork(c);
  const take = limit(c), after = cursor(c);
  if (after !== undefined && (!Array.isArray(after) || typeof after[0] !== 'string' || !Number.isInteger(after[1]))) return invalid();
  const selected = filtered(c).filter(e => !after || cmp(e.normalizedWord, (after as [string, number])[0]) > 0 || e.normalizedWord === (after as [string, number])[0] && e.id > (after as [string, number])[1]);
  const page = selected.slice(0, take), last = page.at(-1);
  return c.json({ resource, entries: page.map(summary), limit: take, ...(selected.length > take && last ? { nextCursor: encodeCursor([last.normalizedWord, last.id]) } : {}) });
});
dictionaries.get('/:work/:language/entries/batch', c => {
  requireWork(c);
  const words = c.req.query('words')?.split(',');
  if (!words?.length || words.length > 200 || words.some(w => !w.trim())) return invalid();
  return c.json({ resource, entries: [...new Set(words)].flatMap(w => { const e = find(w); return e ? [full(e)] : []; }) });
});
dictionaries.get('/:work/:language/entries/by-id/:id', c => {
  requireWork(c);
  const raw = c.req.param('id');
  if (!/^[1-9]\d*$/.test(raw)) return invalid();
  const entry = rows.find(e => e.id === Number(raw));
  return entry ? c.json({ resource, entry: full(entry) }) : missing('DICTIONARY_ENTRY_NOT_FOUND');
});
dictionaries.get('/:work/:language/entries/:word', c => {
  requireWork(c);
  const exact = find(c.req.param('word')), related = exact ? undefined : lookup(c.req.param('word'));
  const entry = exact ?? (related ? rows.find(e => e.slug === related.slug) : undefined);
  return entry ? c.json({ resource, entry: full(entry) }) : missing('DICTIONARY_ENTRY_NOT_FOUND');
});
dictionaries.get('/:work/:language/verses/:verseKey/words', async c => { requireWork(c); return c.json({ resource, verseKey: c.req.param('verseKey'), words: (await passage(c)).map(e => e.word) }); });
dictionaries.get('/:work/:language/verses/:verseKey/entries', async c => { requireWork(c); return c.json({ resource, verseKey: c.req.param('verseKey'), entries: await passage(c) }); });
