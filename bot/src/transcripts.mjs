/**
 * The transcripts: every recording's captions, cut into chunks a search can point into, and
 * the exact-match query over them. Shared by the Worker (src/transcripts.ts), the loader
 * (scripts/load-transcripts.mjs) and the tests.
 *
 * A chunk is a run of caption segments of about 45 seconds or 70 words, whichever comes
 * first, that starts at its first segment's time. Chunks overlap by their last three
 * segments so a phrase that straddles a cut is still found once. A hit's time is the
 * chunk's start, so the recording opens a few seconds before the words.
 */
export const CHUNK_SECONDS = 45;
export const CHUNK_WORDS = 70;
export const OVERLAP_SEGMENTS = 3;

/** [[t, text], ...] -> [{ t, text }, ...] */
export function chunkSegments(segments) {
  const segs = (segments ?? []).filter((s) => Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "string" && s[1].trim()).map(([t, text]) => [t, text.replace(/\s+/g, " ").trim()]);
  const out = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i][0];
    let words = 0, j = i;
    while (j < segs.length && (j === i || (segs[j][0] - start < CHUNK_SECONDS && words < CHUNK_WORDS))) { words += segs[j][1].split(" ").length; j++; }
    out.push({ t: Math.max(0, Math.round((start - 3) * 10) / 10), text: segs.slice(i, j).map((s) => s[1]).join(" ") });
    if (j >= segs.length) break;
    i = Math.max(i + 1, j - OVERLAP_SEGMENTS);
  }
  return out;
}

/** The words FTS5's unicode61 tokenizer would make of the text: letters and digits, lower-cased. */
export const words = (s) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const q = (t) => `"${t.replace(/"/g, '""')}"`;

/**
 * The FTS5 expression for what was typed, taken exactly: the words in that order, next to
 * each other, ignoring case and punctuation. A scripture reference is the one exception
 * the captions force: "Matthew 15:24" is spoken "Matthew 15 verse 24" or "Matthew chapter
 * 15 and 24", so the reference's words may sit up to three words apart, and the book may be
 * "Psalm" or "Psalms". `ref`, when given, is the parsed reference.
 */
export function exactExpr(text, ref) {
  if (ref) {
    const book = words(ref.book);
    const head = book.length > 1 ? q(book.join(" ")) : book[0] === "psalms" ? '"psalm"*' : q(book[0]);
    const parts = [head, q(String(ref.chapter)), ...(ref.verse ? [q(String(ref.verse))] : [])];
    return `NEAR(${parts.join(" ")}, 3)`;
  }
  const w = words(text);
  return w.length ? q(w.join(" ")) : "";
}

/** The same hit twice, from overlapping chunks or a phrase said twice in a minute, is one hit. */
export function dedupeHits(hits, windowSeconds = 60) {
  const out = [];
  for (const h of hits) {
    if (out.some((o) => o.video === h.video && Math.abs(o.t - h.t) < windowSeconds)) continue;
    out.push(h);
  }
  return out;
}

/** The video id in a YouTube thumbnail URL, which the feeds carry instead of the id. */
export const videoOfThumb = (thumb) => /\/vi\/([A-Za-z0-9_-]{6,})\//.exec(thumb ?? "")?.[1] ?? null;

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS transcript_files (video TEXT PRIMARY KEY, sha TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '', duration REAL, chunks INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS transcript_chunks (id INTEGER PRIMARY KEY, video TEXT NOT NULL, t REAL NOT NULL, text TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS transcript_chunks_video ON transcript_chunks(video, t)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(text, content='transcript_chunks', content_rowid='id', tokenize='unicode61')",
];

const lit = (v) => v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;

/** The statements that replace one batch of transcripts: their old chunks out, the new ones in. */
export function batchSql(files) {
  const videos = files.map((f) => lit(f.video)).join(",");
  const stmts = [
    `INSERT INTO transcript_fts(transcript_fts, rowid, text) SELECT 'delete', id, text FROM transcript_chunks WHERE video IN (${videos})`,
    `DELETE FROM transcript_chunks WHERE video IN (${videos})`,
  ];
  const rows = files.flatMap((f) => f.chunks.map((c) => `(${lit(f.video)},${lit(c.t)},${lit(c.text)})`));
  for (let i = 0; i < rows.length; i += 80) stmts.push(`INSERT INTO transcript_chunks(video, t, text) VALUES ${rows.slice(i, i + 80).join(",")}`);
  stmts.push(`INSERT INTO transcript_fts(rowid, text) SELECT id, text FROM transcript_chunks WHERE video IN (${videos})`);
  stmts.push(`INSERT OR REPLACE INTO transcript_files(video, sha, kind, title, url, date, duration, chunks) VALUES ${files.map((f) => `(${lit(f.video)},${lit(f.sha)},${lit(f.kind)},${lit(f.title)},${lit(f.url)},${lit(f.date)},${lit(f.duration)},${f.chunks.length})`).join(",")}`);
  return stmts;
}
