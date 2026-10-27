import type { Book, Chapter } from "@/api/data";
import type { PassagePage } from "./search";
import { alternatives, parseQuery } from "../../../shared/search-query.mjs";
import bookRows from "../../../bot/data/bs-books.json";

export type OfflinePage = PassagePage & { offline: { books: number; chapters: number; missing: number } };
type Options = { books: Book[]; canon?: string; book?: string; offset: number; limit: number; sort: string; signal?: AbortSignal; read: (slug: string, chapter: number) => Promise<Chapter | null> };
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).map(t => t.replace(/^'+|'+$/g, "")).filter(Boolean);
/** Bible Strong's local-search page contract, adapted to CyberJudah's downloaded KJV chapters.
 * Reads only saved text. Missing/evicted chapters are reported, never fetched or called complete.
 */
export async function searchOfflineChapters(query: string, options: Options): Promise<OfflinePage> {
  const { books, canon, book, offset, limit, sort, signal, read } = options;
  const parsed = parseQuery(query.slice(0, 200));
  const candidates = books.filter(b => (!canon || b.testament === canon) && (!book || b.slug === book));
  const jobs = candidates.flatMap(b => b.chapterIds.map(chapter => ({ b, chapter })));
  const hits: (PassagePage["results"][number] & { score: number })[] = [];
  const saved = new Set<string>(); let chapters = 0, missing = 0;
  for (let start = 0; start < jobs.length; start += 8) {
    signal?.throwIfAborted();
    await Promise.all(jobs.slice(start, start + 8).map(async ({ b, chapter }) => {
      const data = await read(b.slug, chapter); signal?.throwIfAborted();
      if (!data || !Array.isArray(data.verses)) { missing++; return; }
      chapters++; saved.add(b.slug);
      const id = bookRows.find(row => row.slug === b.slug)?.id;
      if (!id || (!parsed.terms.length && !parsed.phrases.length)) return;
      for (const verse of data.verses) {
        if (!Number.isSafeInteger(verse.verse) || typeof verse.text !== "string") continue;
        const words = normalized(verse.text), line = ` ${words.join(" ")} `;
        const phrasesMatch = parsed.phrases.every(phrase => line.includes(` ${phrase} `));
        const score = parsed.terms.filter(term => alternatives(term).some(word => words.includes(word))).length;
        if (phrasesMatch && (!parsed.terms.length || score > 0)) hits.push({ book: id, chapter, verse: verse.verse, text: verse.text, score });
      }
    }));
  }
  signal?.throwIfAborted();
  // Match the live Bible query's strict-first, loose-when-sparse behavior. Quoted phrases never relax.
  const strict = hits.filter(hit => hit.score === parsed.terms.length);
  const selected = strict.length >= 8 ? strict : hits;
  selected.sort((a, b) => (sort === "book" ? 0 : b.score - a.score) || a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
  return { results: selected.slice(offset, offset + limit).map(({ score: _score, ...hit }) => hit), count: selected.length, offline: { books: saved.size, chapters, missing } };
}
