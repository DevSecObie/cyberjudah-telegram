import type { Env, Exec } from "./env";
import { ftsExpr, parseQuery } from "./search";
import { FEEDS, noteUrl, passageExcerpt } from "./teachings.mjs";
import { chunkSegments } from "./transcripts.mjs";

/**
 * The site's /teachings search and its "where was this chapter taught", read from the site's
 * own D1 database (env.TEACH, the `cyberjudah` database the cyberjudah repository fills), so
 * the app and the site answer alike and nothing is loaded twice.
 */
export type TeachingHit = { title: string; matchedTitle: string; excerpt: string; feed: string; date: string; video: string; start: number; note: string; timing: "caption" | "passage" };
export type TeachingsResult = { ok: true; q: string; feed: string; page: number; hits: TeachingHit[]; more: boolean; ms: number } | { ok: false; reason: string };
type Row = { title: string; matchedTitle: string; matchedText: string; feed: string; date: string; video: string; start: number; note: string | null; cues: string | null };

export async function searchTeachings(env: Env, q: string, feed: string, page: number): Promise<TeachingsResult> {
  const t0 = Date.now();
  const text = q.slice(0, 200);
  const parsed = parseQuery(text);
  const f = FEEDS.includes(feed) ? feed : "";
  if (!parsed.terms.length && !parsed.phrases.length) return { ok: true, q: text, feed: f, page, hits: [], more: false, ms: 0 };
  const sql = `SELECT title, highlight(teaching_passages,0,char(57344),char(57345)) AS matchedTitle, highlight(teaching_passages,1,char(57344),char(57345)) AS matchedText, feed, date, video, start, note, cues FROM teaching_passages WHERE teaching_passages MATCH ?1 AND (?2 = '' OR feed = ?2) ORDER BY bm25(teaching_passages,4,1), rowid LIMIT 21 OFFSET ?3`;
  try {
    const res = await env.TEACH.prepare(sql).bind(ftsExpr(parsed, "AND"), f, page * 20).all<Row>();
    const hits = res.results.slice(0, 20).map(({ matchedText, cues, note, ...hit }) => ({ ...hit, note: noteUrl(note), ...passageExcerpt(matchedText, cues, hit.start) }));
    return { ok: true, q: text, feed: f, page, hits, more: res.results.length > 20, ms: Date.now() - t0 };
  } catch (e) {
    console.error(JSON.stringify({ event: "teachings_failed", elapsedMs: Date.now() - t0, message: (e as Error).message?.slice(0, 120) }));
    return { ok: false, reason: "unavailable" };
  }
}

export type TaughtRow = { first: number; last: number | null; video: string; start: number; timing: string; title: string; feed: string; date: string; note: string; heard: string };
const taughtSql = `WITH hits AS (
  SELECT * FROM teaching_refs WHERE slug = ?1 AND chapter = ?2
    AND (?3 = '[]' OR EXISTS (SELECT 1 FROM json_each(?3) AS v WHERE v.value BETWEEN first AND coalesce(last, first)))
), top AS (
  SELECT video, count(*) AS n, max(coalesce(date, '')) AS d FROM hits GROUP BY video ORDER BY n DESC, d DESC, video LIMIT 100
)
SELECT h.first, h.last, h.video, h.start, h.timing, h.title, h.feed, h.date, h.note, h.heard,
  (SELECT count(DISTINCT video) FROM hits) AS total
FROM hits AS h JOIN top USING (video) ORDER BY top.n DESC, top.d DESC, h.video, h.start`;

/** The recordings that taught a chapter (or the verses), most first, with every moment each did. */
export async function taughtIn(env: Env, slug: string, chapter: number, verses: number[]): Promise<{ ok: true; rows: TaughtRow[]; total: number } | { ok: false; reason: string }> {
  try {
    const res = await env.TEACH.prepare(taughtSql).bind(slug, chapter, JSON.stringify(verses)).all<TaughtRow & { total: number }>();
    return { ok: true, rows: res.results.map((r) => ({ ...r, note: noteUrl(r.note) })), total: res.results[0]?.total ?? 0 };
  } catch { return { ok: false, reason: "unavailable" }; }
}

export type TranscriptWindow = { ok: true; video: string; kind: string; title: string; url: string; date: string; duration: number | null; t: number; chunks: { t: number; text: string }[] } | { ok: false; reason: string };
const DIRS: [string, string][] = [["blog/transcripts", "class"], ["captains/transcripts", "captains"], ["history/transcripts", "history"]];

/** The captions around a moment, from the recording's transcript file in the repository (cached a day). */
export async function transcriptAround(env: Env, video: string, t: number, ctx?: Exec, span = 120): Promise<TranscriptWindow> {
  const repo = env.TRANSCRIPTS_REPO ?? "DevSecObie/cyberjudah";
  for (const [dir, kind] of DIRS) {
    const url = `https://raw.githubusercontent.com/${repo}/main/${dir}/${encodeURIComponent(video)}.json`;
    const cache = caches.default;
    let res = await cache.match(url);
    if (!res) {
      const live = await fetch(url);
      if (live.status === 404) continue;
      if (!live.ok) return { ok: false, reason: "unavailable" };
      res = new Response(live.body, live);
      res.headers.set("cache-control", "public, max-age=86400");
      const put = cache.put(url, res.clone());
      if (ctx) ctx.waitUntil(put); else await put;
    }
    const file = await res.json<{ title?: string; cleanTitle?: string; date?: string | null; duration?: number | null; slug?: string; segments?: [number, string][] }>();
    const chunks = chunkSegments(file.segments ?? []).filter((c) => c.t >= t - span && c.t <= t + span);
    const note = await noteFor(env, video, ctx);
    return { ok: true, video, kind, title: note?.title || file.cleanTitle || file.title || video, url: note?.url ?? "", date: file.date ?? note?.date ?? "", duration: file.duration ?? null, t, chunks };
  }
  return { ok: false, reason: "not-found" };
}

/** The page a recording has, when it is written up: from teaching_refs/teaching_passages' note column. */
async function noteFor(env: Env, video: string, _ctx?: Exec): Promise<{ url: string; title: string; date: string } | null> {
  try {
    const row = await env.TEACH.prepare("SELECT note, title, date FROM teaching_refs WHERE video = ?1 AND note IS NOT NULL LIMIT 1").bind(video).first<{ note: string; title: string; date: string }>();
    return row?.note ? { url: noteUrl(row.note), title: row.title, date: row.date ?? "" } : null;
  } catch { return null; }
}
