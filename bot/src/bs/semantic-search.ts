import { embed } from '../ai-embeddings';
import { type Ctx, VERSION, html, mapLimit, metadata, readChapter, unavailable } from './core';

/** Vectorize exposes a bounded nearest-neighbour window, not an exhaustive matching count.
 * Fetch all 100 IDs first, then metadata separately (full-metadata queries cap topK at 50).
 * Book/canon scope is applied IN the index before ranking, never to an unfiltered shortlist. */
export async function semanticBibleSearch(c: Ctx, query: string, books: number[], take: number, offset: number, sort: string) {
  const index = c.env.BIBLE_VEC;
  if (!index || !c.env.AI || !c.env.BIBLE_SEMANTIC_LIMIT || c.env.BIBLE_SEMANTIC_REVISION !== metadata.textSha256) {
    return unavailable('Semantic Bible search is not available for this publication');
  }
  const admission = await c.env.BIBLE_SEMANTIC_LIMIT.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' });
  if (!admission.success) return null;
  if (!books.length) return { results: [], count: 0 };
  const work = async () => {
    const [vector] = await embed(c.env, [query]);
    if (!Array.isArray(vector) || vector.length !== 1024 || vector.some(n => !Number.isFinite(n))) return unavailable();
    const found = await index.query(vector, { topK: 100, returnMetadata: 'none', returnValues: false,
      filter: { book: { $in: books }, revision: metadata.textSha256 } });
    if (!Array.isArray(found.matches) || found.matches.length > 100 || found.matches.some(m => !m.id || !Number.isFinite(m.score))) return unavailable();
    const matches = [...found.matches].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (new Set(matches.map(m => m.id)).size !== matches.length) return unavailable();
    const rows = matches.length ? await index.getByIds(matches.map(m => m.id)) : [];
    if (!Array.isArray(rows) || rows.length !== matches.length || new Set(rows.map(row => row.id)).size !== rows.length) return unavailable();
    const byId = new Map(rows.map(row => [row.id, row]));
    const references = matches.map(match => {
      const row = byId.get(match.id), md = row?.metadata;
      const book = md?.book, chapter = md?.chapter, verse = md?.verse;
      if (md?.revision !== metadata.textSha256 || typeof book !== 'number' || !books.includes(book) ||
          typeof chapter !== 'number' || !Number.isInteger(chapter) || !metadata.chaptersByBook[book]?.includes(chapter) ||
          typeof verse !== 'number' || !Number.isInteger(verse) || verse < 1 ||
          match.id !== `KJV:${book}:${chapter}:${verse}` || typeof md.text !== 'string') return unavailable('The semantic index is inconsistent with its publication');
      return { book, chapter, verse, indexedText: md.text };
    });
    const chapterRefs = [...new Map(references.map(r => [`${r.book}-${r.chapter}`, r])).values()];
    const chapters = new Map(await mapLimit(chapterRefs, async r => [`${r.book}-${r.chapter}`, await readChapter(c, r.book, r.chapter)] as const));
    const results = references.map(ref => {
      const text = chapters.get(`${ref.book}-${ref.chapter}`)!.verses.find(v => v.verse === ref.verse)?.text;
      // Canonical hash-verified text is authoritative; stale embedding payloads never surface.
      if (text === undefined || text !== ref.indexedText) return unavailable('The semantic index needs publication refresh');
      return { version: VERSION, book: ref.book, chapter: ref.chapter, verse: ref.verse, text, highlighted: html(text), match: { kind: 'semantic' as const } };
    });
    if (sort === 'book') results.sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
    return { results: results.slice(offset, offset + take), count: results.length };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Semantic search deadline')), 20_000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
