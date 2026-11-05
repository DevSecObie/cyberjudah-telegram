#!/usr/bin/env node
/**
 * Loads the search index into D1: downloads ${DATA_ORIGIN}/search-index/parts.json and its parts
 * (or ${DATA_ORIGIN}/search.sql.gz where there are no parts, or reads a local .sql/.sql.gz
 * given as an argument), gunzips it and loads it blue-green (bluegreen-load.mjs): a spare copy is
 * built beside the live index, checked, then switched in one step, so readers never lose search
 * and a bad load never goes live. The deploy workflow runs it on every deploy.
 *
 *   node scripts/load-search.mjs [path/to/search.sql(.gz)] [--local]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { bluegreenLoad } from "./bluegreen-load.mjs";
import { d1Query } from "./d1-query.mjs";

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
  // The data origin serves the index in parts under search-index/ (the whole file is over the size a
  // Workers asset may be); an older origin, or another URL, still gives the whole file.
  const partsUrl = source.endsWith("/search.sql.gz") ? source.replace(/search\.sql\.gz$/, "search-index/parts.json") : null;
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

if (local) {
  // A local database (wrangler dev) has no readers to keep: the plain import is fine there.
  const dir = mkdtempSync(join(tmpdir(), "cj-search-"));
  const file = join(dir, "search.sql");
  writeFileSync(file, sql);
  try {
    const run = spawnSync("npx", ["wrangler", "d1", "execute", DB, "--local", "--yes", "--file", file], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] });
    if (run.status !== 0) throw new Error(`the local search index load failed (exit ${run.status ?? run.signal})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  // Production and staging: blue-green, through D1's query API (no import, so no lock), see
  // bluegreen-load.mjs.
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed");
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const dbs = await fetch(`${api}?name=${encodeURIComponent(DB)}`, { headers }).then((r) => r.json());
  const id = dbs.result?.find((d) => d.name === DB)?.uuid;
  if (!id) throw new Error(`no D1 database named ${DB}`);
  await bluegreenLoad(sql.toString("utf8"), d1Query(`${api}/${id}/query`, headers), { log: (m) => console.error(m) });
}
