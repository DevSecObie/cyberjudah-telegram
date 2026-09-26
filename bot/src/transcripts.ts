import { books } from "./data";
import type { Env, Exec } from "./env";
import { parseReference } from "./refs.mjs";
import { dedupeHits, exactExpr } from "./transcripts.mjs";

/**
 * The exact search over every recording's captions (transcript_chunks and its FTS5 index,
 * loaded by scripts/load-transcripts.mjs): the words typed, in that order, next to each
 * other; a scripture reference in its spoken forms. Hits carry the second the words were
 * spoken, and the page of the class when it has one.
 */
export type TranscriptHit = { video: string; t: number; snippet: string; kind: string; title: string; url: string; date: string };
export type TranscriptResult =
  | { ok: true; q: string; expr: string; total: number; recordings: number; hits: TranscriptHit[]; ms: number }
  | { ok: false; reason: string };

export async function searchTranscripts(env: Env, q: string, limit: number, offset: number, ctx?: Exec): Promise<TranscriptResult> {
  const t0 = Date.now();
  const text = q.trim();
  if (!text) return { ok: true, q, expr: "", total: 0, recordings: 0, hits: [], ms: 0 };
  const ref = /\d/.test(text) ? parseReference(text, (await books(env, ctx)) ?? []) : null;
  const expr = exactExpr(text, ref ? { book: ref.book, chapter: ref.chapter, verse: ref.verse } : null);
  if (!expr) return { ok: true, q, expr, total: 0, recordings: 0, hits: [], ms: 0 };
  // Newest recordings first; a few more rows than asked, so the overlap duplicates can go.
  const select = `SELECT c.video, c.t, snippet(transcript_fts, 0, '', '', '…', 16) AS snippet, f.kind, f.title, f.url, f.date
    FROM transcript_fts JOIN transcript_chunks c ON c.id = transcript_fts.rowid JOIN transcript_files f ON f.video = c.video
    WHERE transcript_fts MATCH ?1 ORDER BY f.date DESC, c.video, c.t LIMIT ?2 OFFSET ?3`;
  const count = "SELECT count(*) AS n, count(DISTINCT c.video) AS v FROM transcript_fts JOIN transcript_chunks c ON c.id = transcript_fts.rowid WHERE transcript_fts MATCH ?1";
  try {
    const [n, rows] = await env.DB.batch([env.DB.prepare(count).bind(expr), env.DB.prepare(select).bind(expr, limit + 12, offset)]);
    const c = (n.results as unknown as { n: number; v: number }[])[0] ?? { n: 0, v: 0 };
    const hits = dedupeHits(rows.results as unknown as TranscriptHit[]).slice(0, limit);
    return { ok: true, q, expr, total: c.n, recordings: c.v, hits, ms: Date.now() - t0 };
  } catch {
    console.error(JSON.stringify({ event: "transcript_search_failed", elapsedMs: Date.now() - t0 }));
    return { ok: false, reason: "search-unavailable" };
  }
}

export type TranscriptWindow = { ok: true; video: string; kind: string; title: string; url: string; date: string; duration: number | null; t: number; chunks: { t: number; text: string }[] } | { ok: false; reason: string };

/** The recording's details and its captions for about four minutes around a moment. */
export async function transcriptAround(env: Env, video: string, t: number, span = 120): Promise<TranscriptWindow> {
  try {
    const [f, c] = await env.DB.batch([
      env.DB.prepare("SELECT video, kind, title, url, date, duration FROM transcript_files WHERE video = ?1").bind(video),
      env.DB.prepare("SELECT t, text FROM transcript_chunks WHERE video = ?1 AND t BETWEEN ?2 AND ?3 ORDER BY t").bind(video, Math.max(0, t - span), t + span),
    ]);
    const file = (f.results as unknown as { video: string; kind: string; title: string; url: string; date: string; duration: number | null }[])[0];
    if (!file) return { ok: false, reason: "not-found" };
    return { ok: true, ...file, t, chunks: c.results as unknown as { t: number; text: string }[] };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
