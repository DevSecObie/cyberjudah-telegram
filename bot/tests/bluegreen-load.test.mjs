import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bluegreenLoad, rollback, statements, toNext, batches, TEACHINGS, acquireLease, LEASE_MS } from "../scripts/bluegreen-load.mjs";
import { d1Query } from "../scripts/d1-query.mjs";

// The build's search.sql, in its shape (engine/build.mjs in DevSecObie/cyberjudah).
const searchSql = (words, rows = words.length) => [
  "DROP TABLE IF EXISTS search_docs;",
  "CREATE VIRTUAL TABLE search_docs USING fts5(kind UNINDEXED, title, url UNINDEXED, sub UNINDEXED, text, book UNINDEXED, chapter UNINDEXED, tokenize='porter unicode61');",
  `INSERT INTO search_docs(kind, title, url, sub, text, book, chapter) VALUES ${words.map((w, i) => `('verse','T ${i}','/v/${i}','','${w}','Genesis',1)`).join(",")};`,
  "DROP TABLE IF EXISTS search_meta;",
  "CREATE TABLE search_meta(k TEXT PRIMARY KEY, v TEXT);",
  `INSERT INTO search_meta VALUES ('built', '2026-11-05'), ('rows', ${rows});`,
  "-- loaded 2026-11-05T15:00:00Z",
].join("\n");

// A runner like D1's /query, over node:sqlite: the statements run as one transaction, and
// readers' queries are logged so a test can see what readers would have seen mid-load.
function sqlite() {
  const db = new DatabaseSync(":memory:");
  const seen = [];
  const run = async (sql) => {
    const parts = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
    db.exec("BEGIN");
    try {
      const out = parts.map((p) => ({ results: /^select/i.test(p) ? db.prepare(p).all() : (db.exec(p.endsWith(";") ? p : p + ";"), []) }));
      db.exec("COMMIT");
      // A reader between batches: the live index must answer the whole time.
      try { seen.push(db.prepare("SELECT count(*) AS n FROM search_docs WHERE search_docs MATCH 'god'").get().n); } catch { seen.push("missing"); }
      return out;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { db, run, seen };
}

test("statements are rewritten to the spare tables only", () => {
  const list = statements(searchSql(["god is love"]));
  assert.equal(list.length, 6);
  const next = list.map((s) => toNext(s));
  ["DROP TABLE IF EXISTS search_docs_next;", "CREATE VIRTUAL TABLE search_docs_next USING", "INSERT INTO search_docs_next(",
   "DROP TABLE IF EXISTS search_meta_next;", "CREATE TABLE search_meta_next(", "INSERT INTO search_meta_next VALUES"]
    .forEach((prefix, i) => assert.ok(next[i].startsWith(prefix), next[i].slice(0, 60)));
  assert.ok(!next.some((s) => s.includes("-- loaded")), "the loader's comment is not a statement");
  assert.throws(() => toNext("DELETE FROM teaching_passages;"), /unexpected statement/);
});

// The teachings index's file, in its shape (scripts/corpus/index.py in DevSecObie/cyberjudah).
const teachingsSql = (texts) => [
  "DROP TABLE IF EXISTS teaching_passages;",
  "CREATE VIRTUAL TABLE teaching_passages USING fts5(title, text, feed UNINDEXED, date UNINDEXED, video UNINDEXED, start UNINDEXED, note UNINDEXED, cues UNINDEXED);",
  "DROP TABLE IF EXISTS teaching_refs;",
  "CREATE TABLE teaching_refs(slug TEXT NOT NULL, chapter INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER, video TEXT NOT NULL, start REAL NOT NULL, timing TEXT NOT NULL, title TEXT, feed TEXT, date TEXT, note TEXT, heard TEXT);",
  ...texts.flatMap((t, i) => [
    `INSERT INTO teaching_passages VALUES('Class ${i}','${t}','sabbath','2025-01-01','vid${i}',${i},NULL,'[]');`,
    `INSERT INTO teaching_refs VALUES('genesis',1,1,2,'vid${i}',${i},'read','Class ${i}','sabbath','2025-01-01',NULL,'');`,
  ]),
  "CREATE INDEX teaching_refs_chapter ON teaching_refs(slug, chapter);",
].join("\n");

test("the teachings index loads blue-green too, its index renamed per load", async () => {
  const { db, run } = sqlite();
  const opts = { ...TEACHINGS, maxBytes: 300 };
  await bluegreenLoad(teachingsSql(["god said", "more"]), run, opts);
  await bluegreenLoad(teachingsSql(["god again", "x", "y"]), run, opts);
  assert.equal(db.prepare("SELECT count(*) AS n FROM teaching_passages").get().n, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM teaching_refs").get().n, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM teaching_refs_prev").get().n, 2);
  const indexes = db.prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'teaching_refs_chapter%'").all().map((r) => r.tbl_name).sort();
  assert.deepEqual(indexes, ["teaching_refs", "teaching_refs_prev"]);
  await assert.rejects(bluegreenLoad(teachingsSql(["nothing matches"]), run, opts), /0 hits/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM teaching_passages").get().n, 3);
});

test("batches stay under the size, one oversized statement goes alone", () => {
  assert.deepEqual(batches(["aaaa", "bbbb", "cccc", "x".repeat(20)], 10).map((b) => b.length), [2, 1, 1]);
});

test("a load keeps the live index answering throughout, then switches and keeps the old copy", async () => {
  const { db, run, seen } = sqlite();
  await bluegreenLoad(searchSql(["god old", "other"]), run, { maxBytes: 200 });
  await bluegreenLoad(searchSql(["god new", "god again", "more"]), run, { maxBytes: 200 });
  // After the first switch, every reader query found the index (never "missing").
  const afterFirst = seen.slice(seen.indexOf(1));
  assert.ok(afterFirst.length > 3 && afterFirst.every((n) => n !== "missing"), JSON.stringify(seen));
  assert.equal(db.prepare("SELECT count(*) AS n FROM search_docs").get().n, 3);
  assert.equal(db.prepare("SELECT count(*) AS n FROM search_docs_prev").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'search_docs_next'").get().n, 0);
  await rollback(run);
  assert.equal(db.prepare("SELECT count(*) AS n FROM search_docs").get().n, 2);
});

test("a load that fails its check leaves the live index untouched", async () => {
  const { db, run } = sqlite();
  await bluegreenLoad(searchSql(["god kept"]), run);
  await assert.rejects(bluegreenLoad(searchSql(["god a", "b"], 5), run), /failed its check \(rows 2 of 5/);
  assert.equal(db.prepare("SELECT text FROM search_docs").get().text, "god kept");
  await assert.rejects(bluegreenLoad(searchSql(["no match here"]), run), /0 hits/);
  assert.equal(db.prepare("SELECT text FROM search_docs").get().text, "god kept");
});

test("two loads at once take turns instead of dropping each other's spare tables", async () => {
  const { db, run } = sqlite();
  // Each D1 call yields, as a network call would, so the two loads interleave.
  const slow = async (sql) => { await new Promise((r) => setImmediate(r)); return run(sql); };
  const lease = { pollMs: 0, sleep: () => new Promise((r) => setImmediate(r)) };
  const logs = [];
  const [a, b] = await Promise.all([
    bluegreenLoad(searchSql(["god a1", "a2", "a3", "a4"]), slow, { maxBytes: 200, lease }),
    bluegreenLoad(searchSql(["god b1", "b2"]), slow, { maxBytes: 200, lease, log: (m) => logs.push(m) }),
  ]);
  assert.deepEqual([a.rows.search_docs, b.rows.search_docs], [4, 2]);
  assert.ok(logs.some((m) => /waiting for it to finish/.test(m)), logs.join("\n"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM search_docs").get().n, 2);
  assert.equal(db.prepare("SELECT count(*) AS n FROM search_docs_prev").get().n, 4);
  assert.equal(db.prepare("SELECT count(*) AS n FROM load_locks").get().n, 0, "the lease is released");
});

test("a lease left by a crashed load expires; a live one makes the next load give up untouched", async () => {
  const { db, run } = sqlite();
  let t = 1_000_000;
  const now = () => t;
  await acquireLease(run, "search_docs", "crashed", { now });
  await assert.rejects(bluegreenLoad(searchSql(["god x"]), run, { lease: { now, waitMs: 60_000, pollMs: 30_000, sleep: async (ms) => { t += ms; } } }), /still holds search_docs/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'search_docs'").get().n, 0);
  t += LEASE_MS + 1;
  await bluegreenLoad(searchSql(["god x"]), run, { lease: { now } });
  assert.equal(db.prepare("SELECT text FROM search_docs").get().text, "god x");
});

test("the REST runner retries a passing D1 error and stops on a real one", async () => {
  let calls = 0;
  const replies = [
    { status: 503, body: { success: false, errors: [{ message: "D1 DB is overloaded" }] } },
    { status: 200, body: { success: true, result: [{ results: [{ n: 1 }] }] } },
  ];
  const fetchImpl = async () => { const r = replies[calls++]; return { ok: r.status === 200, status: r.status, json: async () => r.body }; };
  const q = d1Query("https://x/query", {}, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(await q("SELECT 1"), [{ results: [{ n: 1 }] }]);
  assert.equal(calls, 2);
  const bad = d1Query("https://x/query", {}, { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ success: false, errors: [{ message: "near \"x\": syntax error" }] }) }), sleep: async () => {} });
  await assert.rejects(bad("x"), /syntax error/);
});
