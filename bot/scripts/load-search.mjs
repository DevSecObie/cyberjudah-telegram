#!/usr/bin/env node
/**
 * Loads the search index into D1: downloads ${DATA_ORIGIN}/search.sql.gz (or reads a local
 * .sql/.sql.gz given as an argument), gunzips it and runs it with wrangler. The SQL drops and
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
const DB = "cyberjudah-telegram";

let bytes;
if (/^https?:\/\//.test(source)) {
  console.error(`fetching ${source}`);
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${source}: ${res.status}`);
  bytes = Buffer.from(await res.arrayBuffer());
} else {
  bytes = readFileSync(source);
}
// gzip magic bytes; the CDN may already have decoded it.
const sql = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
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
