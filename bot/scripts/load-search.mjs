#!/usr/bin/env node
/**
 * Loads the search index into D1: downloads ${DATA_ORIGIN}/search/parts.json and its parts
 * (or ${DATA_ORIGIN}/search.sql.gz where there are no parts, or reads a local .sql/.sql.gz
 * given as an argument), gunzips it and runs it with wrangler. The SQL drops and
 * recreates search_docs, so the load is a full replace; the deploy workflow runs it on every
 * deploy and the site's data workflow republishes the file a few times a week.
 *
 *   node scripts/load-search.mjs [path/to/search.sql(.gz)] [--local]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const local = args.includes("--local");
const source = args.find((a) => !a.startsWith("--")) ?? `${process.env.DATA_ORIGIN ?? "https://data.cyberjudah.io"}/search.sql.gz`;
// Staging loads the same file into its own database: SEARCH_DB=cyberjudah-telegram-staging.
const DB = process.env.SEARCH_DB ?? "cyberjudah-telegram";

// gzip magic bytes; the CDN may already have decoded it.
const plain = (bytes) => (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
const download = async (url) => { const res = await fetch(url); if (!res.ok) throw new Error(`${url}: ${res.status}`); return Buffer.from(await res.arrayBuffer()); };
let sql;
if (/^https?:\/\//.test(source)) {
  // The data origin serves the index in parts under search/ (the whole file is over the size a
  // Workers asset may be); an older origin, or another URL, still gives the whole file.
  const partsUrl = source.endsWith("/search.sql.gz") ? source.replace(/search\.sql\.gz$/, "search/parts.json") : null;
  const list = partsUrl ? await fetch(partsUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
  if (list?.parts?.length) {
    console.error(`fetching ${list.parts.length} parts from ${partsUrl.replace(/parts\.json$/, "")} (built ${list.built}, ${list.rows} rows)`);
    const chunks = [];
    for (const part of list.parts) chunks.push(plain(await download(partsUrl.replace(/parts\.json$/, part.file))));
    sql = Buffer.concat(chunks);
  } else {
    console.error(`fetching ${source}`);
    sql = plain(await download(source));
  }
} else {
  sql = plain(readFileSync(source));
}
console.error(`${(sql.length / 1e6).toFixed(1)} MB of SQL`);

const dir = mkdtempSync(join(tmpdir(), "cj-search-"));
const file = join(dir, "search.sql");
// A byte-identical file re-imported soon after the last one makes D1 "resume" a finished import
// and fail; a comment with the time keeps every run's upload fresh.
writeFileSync(file, Buffer.concat([sql, Buffer.from(`\n-- loaded ${new Date().toISOString()}\n`)]));
try {
  // D1's import occasionally drops mid-way ("Not currently importing anything"); one more try covers it.
  for (let attempt = 1; ; attempt++) {
    try { execFileSync("npx", ["wrangler", "d1", "execute", DB, local ? "--local" : "--remote", "--yes", "--file", file], { stdio: "inherit", cwd: new URL("..", import.meta.url) }); break; }
    catch (e) { if (attempt >= 2) throw e; console.error("the import failed; trying once more in 15 s"); await new Promise((r) => setTimeout(r, 15000)); }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
