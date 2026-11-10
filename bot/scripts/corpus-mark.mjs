/**
 * Corpus release marks (src/ask-versions.ts corpusRelease): one row per kind in D1 corpus_marks,
 * so every Ask answer can name the library and index it searched. load-search.mjs marks the
 * library ("lib-" + the loaded search file's SHA-256, cut to 12) after its blue-green switch;
 * embed.mjs marks the index ("idx-" + the run's UTC minute) after a run that changed it. Only
 * these ids and the time are kept: nothing about readers.
 */
import { createHash } from "node:crypto";

export const libraryMark = (bytes) => `lib-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
export const indexMark = (date = new Date()) => `idx-${date.toISOString().slice(0, 16).replace(/[-:]/g, "")}Z`;

const MARK = /^(lib|idx)-[A-Za-z0-9-]{1,40}$/;

/** Writes one mark through a SQL runner (a function taking one SQL string). A failure only warns: the load or embed itself stands. */
export async function writeCorpusMark(run, kind, id, now = Date.now(), log = console.error) {
  if (!["library", "index"].includes(kind) || !MARK.test(id)) throw new Error(`bad corpus mark ${kind} ${id}`);
  try {
    await run("CREATE TABLE IF NOT EXISTS corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
    await run(`INSERT OR REPLACE INTO corpus_marks (kind, id, at) VALUES ('${kind}', '${id}', ${Math.trunc(now)})`);
    log(`corpus mark ${kind} = ${id}`);
    return true;
  } catch (e) {
    log(`::warning::the corpus ${kind} mark was not written (${String(e?.message ?? e).slice(0, 200)}); answers keep naming the previous one`);
    return false;
  }
}
