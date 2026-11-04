import { Hono } from 'hono';
import type { Env } from '../env';
import { type App, cursor, encodeCursor, integer, invalid, limit, missing, unavailable } from './core';

type Publication = { revision: string; entries: number };
type Entry = { id: number; word: string; normalized_word: string; definition: string; plain_text: string };
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const resource = (revision: string) => ({ kind: 'dictionary' as const, work: 'jewish-encyclopedia', language: 'en' as const, revision });
export async function jewishPublication(env: Env): Promise<Publication> {
  const publication = await env.DB.prepare("SELECT revision,entries FROM app_reference_publications WHERE work='jewish-encyclopedia'").first<Publication>();
  if (!publication?.revision || publication.entries < 1) return unavailable('The Jewish Encyclopedia has not been published for online reading');
  return publication;
}
export async function searchJewishEncyclopedia(env: Env, query: string) {
  const terms = (query.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map(term => `"${term}"`).join(' AND ');
  if (!terms) return [];
  const { revision } = await jewishPublication(env);
  const result = await env.DB.prepare(`SELECT e.id,e.word,e.plain_text FROM app_reference_search s
    JOIN app_reference_entries e ON e.revision=s.revision AND e.id=s.entry_id
    WHERE app_reference_search MATCH ? AND s.revision=? ORDER BY CASE WHEN e.normalized_word=? THEN 0 ELSE 1 END, bm25(app_reference_search,0,0,8,1) LIMIT 3`).bind(terms, revision, normalize(query)).all<{ id: number; word: string; plain_text: string }>();
  return result.results;
}

/** Our own publication, never forwarded to Bible Strong's upstream. IDs and HTML are
 * byte-for-byte from the same dictionary edition used by the device's Offline copy. */
export const jewishEncyclopedia = new Hono<App>();
jewishEncyclopedia.use('/:language/*', async (c, next) => {
  if (c.req.param('language') !== 'en') return missing('DICTIONARY_UNSUPPORTED');
  await next();
});
jewishEncyclopedia.get('/:language/entries', async c => {
  const { revision } = await jewishPublication(c.env);
  const take = limit(c, 100), after = cursor(c);
  if (after !== undefined && (!Array.isArray(after) || typeof after[0] !== 'string' || !Number.isSafeInteger(after[1]) || after[1] < 1)) return invalid();
  const search = normalize(c.req.query('search') ?? ''), initial = normalize(c.req.query('initial') ?? '');
  if (search.length > 120 || initial.length > 10) return invalid();
  const last = after as [string, number] | undefined;
  const rows = await c.env.DB.prepare(`SELECT id,word,normalized_word FROM app_reference_entries
    WHERE revision=? AND instr(normalized_word,?)>0 AND substr(normalized_word,1,length(?))=?
    AND (normalized_word>? OR (normalized_word=? AND id>?)) ORDER BY normalized_word,id LIMIT ?`)
    .bind(revision, search, initial, initial, last?.[0] ?? '', last?.[0] ?? '', last?.[1] ?? 0, take + 1).all<Entry>();
  const page = rows.results.slice(0, take), end = page.at(-1);
  return c.json({ resource: resource(revision), entries: page.map(e => ({ id: e.id, word: e.word, normalizedWord: e.normalized_word })), limit: take,
    ...(rows.results.length > take && end ? { nextCursor: encodeCursor([end.normalized_word, end.id]) } : {}) });
});
jewishEncyclopedia.get('/:language/entries/batch', async c => {
  const words = c.req.query('words')?.split(',');
  if (!words?.length || words.length > 100 || words.some(w => !w.trim() || w.length > 200)) return invalid();
  const { revision } = await jewishPublication(c.env);
  const normalized = [...new Set(words.map(normalize))];
  const rows = await c.env.DB.prepare(`SELECT id,word,definition FROM app_reference_entries WHERE revision=? AND normalized_word IN (${normalized.map(() => '?').join(',')})`).bind(revision, ...normalized).all<Entry>();
  return c.json({ resource: resource(revision), entries: rows.results });
});
jewishEncyclopedia.get('/:language/entries/by-id/:id', async c => {
  const id = integer(c.req.param('id'), 1, 100000000), { revision } = await jewishPublication(c.env);
  const entry = await c.env.DB.prepare('SELECT id,word,definition FROM app_reference_entries WHERE revision=? AND id=?').bind(revision, id).first<Entry>();
  return entry ? c.json({ resource: resource(revision), entry }) : missing('DICTIONARY_ENTRY_NOT_FOUND');
});
jewishEncyclopedia.get('/:language/entries/:word', async c => {
  const word = c.req.param('word');
  if (word.length > 200) return invalid();
  const { revision } = await jewishPublication(c.env);
  const entry = await c.env.DB.prepare('SELECT id,word,definition FROM app_reference_entries WHERE revision=? AND normalized_word=? ORDER BY id LIMIT 1').bind(revision, normalize(word)).first<Entry>();
  return entry ? c.json({ resource: resource(revision), entry }) : missing('DICTIONARY_ENTRY_NOT_FOUND');
});
