#!/usr/bin/env node
/**
 * Fills the Vectorize index of the teachings: every library document (search_docs) and every
 * transcript chunk embedded with bge-m3 through Workers AI, with the
 * passage kept in the vector's metadata so an answer needs no second lookup.
 *
 * Incremental: the table `embedded` in D1 keeps each record's content hash, so a run embeds
 * only what is new or changed. The first run is the big one (about 700,000 passages, an
 * hour or two); a nightly run after that takes minutes.
 *
 *   node scripts/embed.mjs [--limit N] [--only docs|spoken] [--dry]
 *
 * The transcripts are read from the cyberjudah repository (blog/transcripts, captains/transcripts,
 * history/transcripts) and cut into chunks of about 45 seconds; the marks in `embedded`
 * skip what was embedded before.
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; GITHUB_TOKEN raises GitHub's rate limit.
 */
import { chunkRecord, docRecord, EMBED_MODEL, hash } from "../src/ai.mjs";
import { chunkSegments, videoOfThumb } from "../src/transcripts.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const LIMIT = Number(opt("--limit")) || Infinity;
const ONLY = opt("--only");
const SPOKEN_FROM = opt("--spoken-from") ?? process.env.SPOKEN_SOURCE ?? "github";
const REPO = process.env.TRANSCRIPTS_REPO ?? "DevSecObie/cyberjudah", BRANCH = process.env.TRANSCRIPTS_BRANCH ?? "main";
const DATA_ORIGIN = process.env.DATA_ORIGIN ?? "https://data.cyberjudah.io";
const gh = { accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const getJson = async (url, headers = {}) => { for (let a = 1; ; a++) { const r = await fetch(url, { headers }); if (r.ok) return r.json(); if (a >= 4 || (r.status < 500 && r.status !== 403 && r.status !== 429)) throw new Error(`${url}: ${r.status}`); await new Promise((x) => setTimeout(x, 2000 * a)); } };
const DB = "cyberjudah-telegram", INDEX = "cyberjudah-teachings";
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID, TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) { console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed"); process.exit(1); }
const PAGE = 2000, EMBED_BATCH = 100, UPSERT_BATCH = 1000, CONCURRENCY = 4;

const cf = async (path, init = {}, raw = false) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success !== false) return raw ? body : body.result;
    const msg = `${path}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`;
    // A timeout (408) or a rate limit (429) from Workers AI is retried like a server error.
    if (attempt >= 5 || (res.status < 500 && res.status !== 429 && res.status !== 408)) throw new Error(msg);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
};
let dbId;
const sql = async (query) => {
  dbId ??= (await cf(`/accounts/${ACCOUNT}/d1/database?name=${DB}&per_page=100`)).find((d) => d.name === DB)?.uuid;
  if (!dbId) throw new Error(`no D1 database named ${DB}`);
  const r = await cf(`/accounts/${ACCOUNT}/d1/database/${dbId}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: query }) });
  return r[0]?.results ?? [];
};
const embedTexts = async (texts) => (await cf(`/accounts/${ACCOUNT}/ai/run/${EMBED_MODEL}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: texts }) })).data;
const deleteIds = async (ids) => { for (let i = 0; i < ids.length; i += 1000) await cf(`/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/delete_by_ids`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + 1000) }) }); };
const upsert = async (vectors) => cf(`/accounts/${ACCOUNT}/vectorize/v2/indexes/${INDEX}/upsert`, { method: "POST", headers: { "content-type": "application/x-ndjson" }, body: vectors.map((v) => JSON.stringify(v)).join("\n") });
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

await sql("CREATE TABLE IF NOT EXISTS embedded (id TEXT PRIMARY KEY, hash TEXT NOT NULL)");
const known = new Map();
for (let offset = 0; ; offset += 20000) {
  const rows = await sql(`SELECT id, hash FROM embedded LIMIT 20000 OFFSET ${offset}`);
  for (const r of rows) known.set(r.id, r.hash);
  if (rows.length < 20000) break;
}
console.error(`${known.size} passages embedded before`);
const knownByVideo = new Map();
for (const id of known.keys()) if (id.startsWith("t:")) { const v = id.slice(2, id.lastIndexOf(":")); if (!knownByVideo.has(v)) knownByVideo.set(v, []); knownByVideo.get(v).push(id); }
const stale = [];

/** The records to embed, streamed page by page from D1. */
async function* records() {
  if (ONLY !== "spoken") {
    for (let last = 0; ; ) {
      const rows = await sql(`SELECT rowid AS id, kind, title, url, sub, text FROM search_docs WHERE rowid > ${last} ORDER BY rowid LIMIT ${PAGE}`);
      for (const r of rows) yield docRecord(r);
      if (rows.length < PAGE) break;
      last = rows[rows.length - 1].id;
    }
  }
  if (ONLY !== "docs" && SPOKEN_FROM === "github") {
    // The recordings' pages, by video id, so a spoken passage links to its class notes.
    const pages = new Map();
    try {
      for (const f of ["classes", "captains"]) for (const r of await getJson(`${DATA_ORIGIN}/search/${f}.json`)) { const v = videoOfThumb(r.thumb); if (v) pages.set(v, { url: r.url, title: r.title, date: r.date ?? "" }); }
      for (const r of await getJson(`${DATA_ORIGIN}/api/history/index.json`)) if (r.videoId) pages.set(r.videoId, { url: r.url, title: r.title, date: r.date ?? "" });
    } catch (e) { console.error(`feeds: ${e.message}`); }
    const FEEDS = { classes: "blog/transcripts", captains: "captains/transcripts", history: "history/transcripts" };
    const KIND = { classes: "class", captains: "captains", history: "history" };
    for (const [feed, dir] of Object.entries(FEEDS)) {
      const tree = await getJson(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}:${dir}`, gh);
      const files = tree.tree.filter((e) => e.type === "blob" && e.path.endsWith(".json"));
      console.error(`${dir}: ${files.length} transcripts`);
      for (let i = 0; i < files.length; i += 8) {
        const batch = await Promise.all(files.slice(i, i + 8).map((e) => getJson(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${dir}/${e.path}`).catch(() => null)));
        for (const t of batch) {
          if (!t?.segments?.length) continue;
          const page = pages.get(t.videoId);
          const title = page?.title || t.cleanTitle || t.title || t.videoId;
          const produced = new Set();
          for (const c of chunkSegments(t.segments)) { const r = chunkRecord({ video: t.videoId, t: c.t, text: c.text, kind: KIND[feed], title, url: page?.url ?? "", date: t.date || page?.date || "" }); produced.add(r.id); yield r; }
          // Chunks embedded before that the chunker no longer makes (the scraps) leave the index.
          for (const id of knownByVideo.get(t.videoId) ?? []) if (!produced.has(id)) stale.push(id);
        }
      }
    }
  }
}

let seen = 0, todo = 0, done = 0, marksBlocked = false;
let pending = [];
const inflight = new Set();
const flushEmbedded = async (batch) => {
  const vectors = (await embedTexts(batch.map((r) => r.text))).map((values, i) => ({ id: batch[i].id, values, metadata: batch[i].metadata }));
  if (DRY) return vectors.length;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) await upsert(vectors.slice(i, i + UPSERT_BATCH));
  const marks = batch.map((r) => `(${lit(r.id)},${lit(r.hash)})`);
  if (!marksBlocked) {
    try { for (let i = 0; i < marks.length; i += 500) await sql(`INSERT OR REPLACE INTO embedded(id, hash) VALUES ${marks.slice(i, i + 500).join(",")}`); }
    catch (e) { if (!/7500|row write limit/.test(e.message)) throw e; marksBlocked = true; console.error("::warning::D1 is at its daily write limit; the vectors still load, and the nightly run re-embeds these once to mark them."); }
  }
  return vectors.length;
};
const schedule = async (batch) => {
  while (inflight.size >= CONCURRENCY) await Promise.race(inflight);
  const p = flushEmbedded(batch).then((n) => { done += n; if (done % 5000 < n) console.error(`embedded ${done}/${todo}`); }).finally(() => inflight.delete(p));
  inflight.add(p);
};
for await (const r of records()) {
  seen++;
  const h = hash(r.text);
  if (known.get(r.id) === h) continue;
  todo++;
  if (todo > LIMIT) break;
  pending.push({ ...r, hash: h });
  if (pending.length >= EMBED_BATCH) { await schedule(pending); pending = []; }
}
if (pending.length) await schedule(pending);
await Promise.all(inflight);
if (stale.length && !DRY) {
  await deleteIds(stale);
  for (let i = 0; i < stale.length; i += 500) await sql(`DELETE FROM embedded WHERE id IN (${stale.slice(i, i + 500).map(lit).join(",")})`);
  console.error(`${stale.length} stale passages removed from the index`);
}
console.error(`done: ${seen} passages seen, ${done} embedded this run${DRY ? " (dry)" : ""}`);
