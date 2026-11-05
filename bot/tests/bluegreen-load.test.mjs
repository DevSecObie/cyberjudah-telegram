import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bluegreenLoad, rollback, statements, toNext, batches } from "../scripts/bluegreen-load.mjs";
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
  const next = list.map(toNext);
  ["DROP TABLE IF EXISTS search_docs_next;", "CREATE VIRTUAL TABLE search_docs_next USING", "INSERT INTO search_docs_next(",
   "DROP TABLE IF EXISTS search_meta_next;", "CREATE TABLE search_meta_next(", "INSERT INTO search_meta_next VALUES"]
    .forEach((prefix, i) => assert.ok(next[i].startsWith(prefix), next[i].slice(0, 60)));
  assert.ok(!next.some((s) => s.includes("-- loaded")), "the loader's comment is not a statement");
  assert.throws(() => toNext("DELETE FROM teaching_passages;"), /unexpected statement/);
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
