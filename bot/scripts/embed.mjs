#!/usr/bin/env node
/**
 * Fills the Vectorize index of the teachings: every library document (search_docs) and every
 * transcript chunk (transcript_chunks) embedded with bge-m3 through Workers AI, with the
 * passage kept in the vector's metadata so an answer needs no second lookup.
 *
 * Incremental: the table `embedded` in D1 keeps each record's content hash, so a run embeds
 * only what is new or changed. The first run is the big one (about 700,000 passages, an
 * hour or two); a nightly run after that takes minutes.
 *
 *   node scripts/embed.mjs [--limit N] [--only docs|spoken] [--dry]
 *
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
import { chunkRecord, docRecord, EMBED_MODEL, hash } from "../src/ai.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const LIMIT = Number(opt("--limit")) || Infinity;
const ONLY = opt("--only");
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
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(msg);
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
  if (ONLY !== "docs") {
    for (let last = 0; ; ) {
      const rows = await sql(`SELECT c.id, c.video, c.t, c.text, f.kind, f.title, f.url, f.date FROM transcript_chunks c JOIN transcript_files f ON f.video = c.video WHERE c.id > ${last} ORDER BY c.id LIMIT ${PAGE}`);
      for (const r of rows) yield chunkRecord(r);
      if (rows.length < PAGE) break;
      last = rows[rows.length - 1].id;
    }
  }
}

let seen = 0, todo = 0, done = 0;
let pending = [];
const inflight = new Set();
const flushEmbedded = async (batch) => {
  const vectors = (await embedTexts(batch.map((r) => r.text))).map((values, i) => ({ id: batch[i].id, values, metadata: batch[i].metadata }));
  if (DRY) return vectors.length;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) await upsert(vectors.slice(i, i + UPSERT_BATCH));
  const marks = batch.map((r) => `(${lit(r.id)},${lit(r.hash)})`);
  for (let i = 0; i < marks.length; i += 500) await sql(`INSERT OR REPLACE INTO embedded(id, hash) VALUES ${marks.slice(i, i + 500).join(",")}`);
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
console.error(`done: ${seen} passages seen, ${done} embedded this run${DRY ? " (dry)" : ""}`);
