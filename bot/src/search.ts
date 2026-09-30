/**
 * Library search against the FTS5 table in D1 (search_docs, loaded from the engine's
 * search.sql.gz by scripts/load-search.mjs). A port of the site's search: phrases in quotes
 * match exactly; bare words must all appear; when that finds little, a looser "any of these
 * words" pass fills in. Results come back per kind, ranked by bm25 with the title weighted.
 */
export type SearchHit = { kind: string; title: string; url: string; sub: string; snippet: string; text?: string; loose?: boolean };
export type SearchResult =
  | { ok: true; q: string; mode: "strict" | "loose" | "mixed"; counts: Record<string, number>; hits: SearchHit[]; ms: number }
  | { ok: false; reason: string };

export const KINDS = ["verse", "law", "precept", "case", "study", "class", "captains", "history", "encyclopedia", "book"] as const;

/** Quoted phrases retain all words; only unquoted terms drop common stop words. */
const STOP = new Set(["and", "or", "not", "the", "a", "of"]);
const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).map((t) => t.replace(/^'+|'+$/g, "")).filter(Boolean);
const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;

export function parseQuery(q: string): { phrases: string[]; terms: string[] } {
  const phrases: string[] = [];
  const rest = q.replace(/"([^"]+)"/g, (_m, p: string) => {
    const words = tokens(p);
    if (words.length) phrases.push(words.join(" "));
    return " ";
  });
  return { phrases, terms: tokens(rest).filter((t) => !STOP.has(t)) };
}

export function ftsExpr(p: { phrases: string[]; terms: string[] }, join: "AND" | "OR"): string {
  // A loose pass may relax bare terms, but must never discard a requested phrase.
  const terms = p.terms.map(quote).join(` ${join} `);
  return [...p.phrases.map(quote), ...(terms ? [join === "OR" && p.terms.length > 1 ? `(${terms})` : terms] : [])].join(" AND ");
}

type Row = { kind: string; title: string; url: string; sub: string; snippet: string; text?: string };

export async function runSearch(db: D1Database, q: string, only: string | readonly string[] | undefined, limit: number, withText = false): Promise<SearchResult> {
  const t0 = Date.now();
  const parsed = parseQuery(q);
  if (!parsed.phrases.length && !parsed.terms.length) return { ok: true, q, mode: "strict", counts: {}, hits: [], ms: 0 };
  const strict = ftsExpr(parsed, "AND");
  const loose = parsed.terms.length + parsed.phrases.length > 1 ? ftsExpr(parsed, "OR") : null;
  const wanted = typeof only === "string" ? [only] : only ?? KINDS;
  const kinds = wanted.filter((k) => (KINDS as readonly string[]).includes(k));
  if (!kinds.length) kinds.push(...KINDS);
  // Columns: kind, title, url, sub, text, book, chapter. Title matches count four times a body match.
  const rank = "bm25(search_docs, 0, 4.0, 0, 0, 1.0, 0, 0)";
  // withText adds the whole row text (a verse, or a note piece of a few KB) for the inline bot.
  const select = `SELECT kind, title, url, sub, snippet(search_docs, 4, '', '', '…', 18) AS snippet${withText ? ", text" : ""} FROM search_docs WHERE search_docs MATCH ?1 AND kind = ?2 ORDER BY ${rank} LIMIT ?3`;
  const countSql = "SELECT kind, count(*) AS n FROM search_docs WHERE search_docs MATCH ?1 GROUP BY kind";
  try {
    // One round trip: the per-kind counts and the top rows of every kind, together.
    const pass = async (expr: string) => {
      const res = await db.batch<Row & { n?: number }>([db.prepare(countSql).bind(expr), ...kinds.map((k) => db.prepare(select).bind(expr, k, limit))]);
      const counts: Record<string, number> = {};
      for (const r of res[0].results as unknown as { kind: string; n: number }[]) if (kinds.includes(r.kind)) counts[r.kind] = r.n;
      return { counts, hits: dedupe(res.slice(1).flatMap((r) => r.results)) };
    };
    const strictPass = await pass(strict);
    const counts = strictPass.counts;
    let hits = strictPass.hits;
    let mode: "strict" | "loose" | "mixed" = "strict";
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (loose && total < 8) {
      const loosePass = await pass(loose);
      const seen = new Set(hits.map((h) => `${h.kind}|${h.url}`));
      const extra = loosePass.hits.filter((h) => !seen.has(`${h.kind}|${h.url}`)).map((h) => ({ ...h, loose: true }));
      for (const [k, n] of Object.entries(loosePass.counts)) counts[k] = Math.max(counts[k] ?? 0, n);
      hits = [...hits, ...extra];
      mode = total ? "mixed" : "loose";
    }
    return { ok: true, q, mode, counts, hits, ms: Date.now() - t0 };
  } catch {
    // Do not log queries, SQL, or raw database errors: those can contain visitor input.
    console.error(JSON.stringify({ event: "search_failed", elapsedMs: Date.now() - t0 }));
    return { ok: false, reason: "search-unavailable" };
  }
}

function dedupe(rows: Row[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const r of rows) { const k = `${r.kind}|${r.url}`; if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

/** Verse-only paging for the public resource feed. Filters and ordering are applied in
 * SQL before LIMIT/OFFSET, so later pages and book-restricted searches remain complete.
 * Uses the same query parser and strict/loose matching policy as the library search.
 */
export async function runBibleSearch(db: D1Database, q: string, bookNames: string[], limit: number, offset: number, bookOrder: boolean): Promise<{ ok: true; hits: SearchHit[]; count: number } | { ok: false }> {
  const parsed = parseQuery(q);
  if ((!parsed.terms.length && !parsed.phrases.length) || !bookNames.length) return { ok: true, hits: [], count: 0 };
  const strict = ftsExpr(parsed, 'AND');
  const loose = parsed.terms.length + parsed.phrases.length > 1 ? ftsExpr(parsed, 'OR') : strict;
  const placeholders = bookNames.map((_, i) => `?${i + 2}`).join(',');
  const where = `search_docs MATCH ?1 AND kind = 'verse' AND book IN (${placeholders})`;
  const countSql = `SELECT count(*) AS n FROM search_docs WHERE ${where}`;
  const count = async (expr: string) => Number((await db.prepare(countSql).bind(expr, ...bookNames).first<{ n: number }>())?.n ?? 0);
  try {
    let expr = strict, total = await count(strict);
    if (loose !== strict && total < 8) { expr = loose; total = await count(loose); }
    const bibleOrder = `CASE book ${bookNames.map((_, i) => `WHEN ?${i + 2} THEN ${i}`).join(' ')} END, CAST(chapter AS INTEGER), CAST(substr(url, instr(url, '#v') + 2) AS INTEGER)`;
    const order = bookOrder ? bibleOrder : `bm25(search_docs, 0, 4.0, 0, 0, 1.0, 0, 0), ${bibleOrder}`;
    const sql = `SELECT kind, title, url, sub, text, text AS snippet FROM search_docs WHERE ${where} ORDER BY ${order} LIMIT ?${bookNames.length + 2} OFFSET ?${bookNames.length + 3}`;
    const result = await db.prepare(sql).bind(expr, ...bookNames, limit, offset).all<SearchHit>();
    return { ok: true, hits: result.results, count: total };
  } catch { return { ok: false }; }
}
