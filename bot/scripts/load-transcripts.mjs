#!/usr/bin/env node
/**
 * Loads the transcripts into D1 for the exact search: every caption file in the cyberjudah
 * repository (blog/transcripts for the classes, captains/transcripts, history/transcripts),
 * cut into chunks (src/transcripts.mjs), into transcript_chunks with an FTS5 index over it.
 *
 * Incremental: the git blob sha of each file is kept in transcript_files, so a run fetches
 * and loads only the files that are new or changed since the last one, in batches that are
 * committed as they go. The first run loads everything (about 8,500 recordings); a daily run
 * after that loads the hour's new transcripts in a minute.
 *
 *   node scripts/load-transcripts.mjs [--local] [--limit N] [--feed classes|captains|history] [--dry] [--from <checkout>]
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (or --local), and reaches GitHub
 * unauthenticated (GITHUB_TOKEN raises the rate limit when set). --from reads a local
 * checkout of the cyberjudah repository instead of GitHub.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA, batchSql, chunkSegments, videoOfThumb } from "../src/transcripts.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const LOCAL = args.includes("--local"), DRY = args.includes("--dry");
const LIMIT = Number(opt("--limit")) || Infinity;
const ONLY = opt("--feed");
const FROM = opt("--from");
const DB = "cyberjudah-telegram";
const REPO = process.env.TRANSCRIPTS_REPO ?? "DevSecObie/cyberjudah";
const BRANCH = process.env.TRANSCRIPTS_BRANCH ?? "main";
const DATA_ORIGIN = process.env.DATA_ORIGIN ?? "https://data.cyberjudah.io";
const FEEDS = { classes: "blog/transcripts", captains: "captains/transcripts", history: "history/transcripts" };
const KIND = { classes: "class", captains: "captains", history: "history" };
const BATCH_BYTES = 2_000_000;
const CWD = new URL("..", import.meta.url);
const gh = { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

/**
 * Remote runs go through D1's HTTP query API (no import lock on the database, no database
 * id in the config); --local goes through wrangler into the dev database.
 */
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const cfApi = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`Cloudflare API ${path}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
  return body.result;
};
let dbId = null;
const databaseId = async () => {
  if (dbId) return dbId;
  if (!ACCOUNT || !TOKEN) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed (or --local)");
  const list = await cfApi(`/accounts/${ACCOUNT}/d1/database?name=${encodeURIComponent(DB)}&per_page=100`);
  const found = list.find((d) => d.name === DB);
  if (!found) throw new Error(`no D1 database named ${DB}`);
  return (dbId = found.uuid);
};
const REQUEST_BYTES = 90_000;
/** One HTTP request per ~90 KB of SQL, in order; a failure is retried, then thrown. */
const remoteSql = async (stmts) => {
  const id = await databaseId();
  const out = [];
  let group = [], size = 0;
  const send = async () => {
    if (!group.length) return;
    const sql = group.map((x) => `${x};`).join("\n");
    for (let attempt = 1; ; attempt++) {
      try { out.push(...await cfApi(`/accounts/${ACCOUNT}/d1/database/${id}/query`, { method: "POST", body: JSON.stringify({ sql }) })); break; }
      catch (e) {
        // D1's free plan allows 100,000 row writes a day; what loaded so far stays, the rest waits.
        if (/7500|row write limit/.test(e.message)) throw Object.assign(new Error("D1's daily row-write limit is reached (free plan). What loaded so far is kept; the nightly run continues, or the full set loads at once on Workers Paid."), { quota: true });
        if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    group = []; size = 0;
  };
  for (const st of stmts) {
    if (size && size + st.length > REQUEST_BYTES) await send();
    group.push(st); size += st.length + 2;
  }
  await send();
  return out;
};
const d1 = (extra) => execFileSync("npx", ["wrangler", "d1", "execute", DB, "--local", "--yes", ...extra], { cwd: CWD, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64e6 });
const runSql = async (stmts) => {
  if (DRY) { console.error(`dry: ${stmts.length} statements, ${(stmts.join(";\n").length / 1e6).toFixed(1)} MB`); return; }
  if (!LOCAL) { await remoteSql(stmts); return; }
  const dir = mkdtempSync(join(tmpdir(), "cj-transcripts-"));
  const file = join(dir, "batch.sql");
  writeFileSync(file, stmts.map((s) => `${s};`).join("\n"));
  try { d1(["--file", file]); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const query = async (sql) => {
  if (!LOCAL) return (await remoteSql([sql]))[0]?.results ?? [];
  const out = d1(["--json", "--command", sql]); const start = out.indexOf("["); return JSON.parse(out.slice(start))[0]?.results ?? [];
};

async function getJson(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (attempt >= 4 || (res.status < 500 && res.status !== 403 && res.status !== 429)) throw new Error(`${url}: ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

// The pages a recording has, by video id, from the published feeds; most recordings have none yet.
const pages = new Map();
try {
  for (const f of ["classes", "captains"]) for (const r of await getJson(`${DATA_ORIGIN}/search/${f}.json`)) { const v = videoOfThumb(r.thumb); if (v) pages.set(v, { url: r.url, title: r.title, date: r.date ?? "" }); }
  for (const r of await getJson(`${DATA_ORIGIN}/api/history/index.json`)) if (r.videoId) pages.set(r.videoId, { url: r.url, title: r.title, date: r.date ?? "" });
} catch (e) { console.error(`feeds: ${e.message} (recordings will load without their pages)`); }

await runSql(SCHEMA);
const loaded = new Map(DRY ? [] : (await query("SELECT video, sha FROM transcript_files")).map((r) => [r.video, r.sha]));
console.error(`${loaded.size} transcripts already loaded`);

const todo = [];
for (const [feed, dir] of Object.entries(FEEDS)) {
  if (ONLY && ONLY !== feed) continue;
  const tree = FROM ? localTree(dir) : await getJson(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}:${dir}`, gh);
  if (tree.truncated) console.error(`${dir}: the tree listing is truncated; some files will wait for the next run`);
  for (const e of tree.tree) {
    if (e.type !== "blob" || !e.path.endsWith(".json")) continue;
    const video = e.path.slice(0, -5);
    if (loaded.get(video) === e.sha) continue;
    todo.push({ feed, dir, path: e.path, video, sha: e.sha, size: e.size });
  }
}
function localTree(dir) {
  const out = execFileSync("git", ["-C", FROM, "ls-tree", `HEAD:${dir}`], { encoding: "utf8", maxBuffer: 64e6 });
  return { tree: out.trim().split("\n").filter(Boolean).map((l) => { const [meta, path] = l.split("\t"); const [, type, sha] = meta.split(/\s+/); return { type, sha, path }; }) };
}
const readTranscript = (w) => FROM ? JSON.parse(readFileSync(join(FROM, w.dir, w.path), "utf8")) : getJson(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${w.dir}/${w.path}`);
console.error(`${todo.length} transcripts to load${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""}`);
const work = todo.slice(0, LIMIT);

// Fetch eight at a time; commit a batch as soon as it holds about 6 MB of SQL.
let batch = [], bytes = 0, done = 0, chunksTotal = 0;
const flush = async () => {
  if (!batch.length) return;
  try { await runSql(batchSql(batch)); }
  catch (e) { if (!e.quota) throw e; console.error(`::warning::${e.message} ${done} of ${work.length} loaded this run.`); process.exit(0); }
  done += batch.length;
  console.error(`loaded ${done}/${work.length} (${chunksTotal} chunks so far)`);
  batch = []; bytes = 0;
};
for (let i = 0; i < work.length; i += 8) {
  const files = await Promise.all(work.slice(i, i + 8).map(async (w) => {
    const t = await readTranscript(w);
    const chunks = chunkSegments(t.segments ?? []);
    const page = pages.get(w.video);
    return { video: w.video, sha: w.sha, kind: KIND[w.feed], title: page?.title || t.cleanTitle || t.title || w.video, url: page?.url ?? "", date: t.date || page?.date || "", duration: t.duration ?? null, chunks };
  }));
  for (const f of files) {
    batch.push(f); chunksTotal += f.chunks.length;
    bytes += f.chunks.reduce((n, c) => n + c.text.length + 40, 0);
    if (bytes >= BATCH_BYTES) await flush();
  }
}
await flush();
console.error(`done: ${done} transcripts loaded, ${todo.length - work.length} left for the next run`);
