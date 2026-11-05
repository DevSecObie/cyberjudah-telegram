/**
 * Blue-green load of the search index into a live D1 database.
 *
 * The old load ran the whole search.sql as a D1 import: the import locks the entire database for
 * a minute or two ("Currently processing a long-running import"), and the SQL drops search_docs
 * first, so readers had no search while it ran and a load that failed part-way left them with a
 * broken index. Now:
 *
 *   1. every statement is rewritten to build search_docs_next / search_meta_next beside the live
 *      tables, and sent as ordinary queries in small batches, so readers keep the live index and
 *      the database is never locked;
 *   2. the spare copy is checked (its row count matches what the build says it wrote, and a word
 *      search finds rows);
 *   3. one transaction renames live -> _prev and next -> live, so readers switch in one step;
 *   4. the previous copy stays as search_docs_prev for an instant rollback (`rollback()`), and
 *      is dropped at the start of the next load.
 *
 * `run(sql)` executes SQL (one or more statements, run as one transaction) and resolves to an
 * array with one `{ results: [...] }` per statement, like D1's REST /query. load-search.mjs
 * passes the REST API; the tests pass node:sqlite.
 */

export const TABLES = ["search_docs", "search_meta"];
const START = /^(DROP TABLE IF EXISTS |CREATE (?:VIRTUAL )?TABLE |INSERT INTO )(search_docs|search_meta)\b/;

/** Splits the build's search.sql into statements (each starts a line with DROP, CREATE or INSERT). */
export function statements(sql) {
  const out = [];
  let cur = "";
  for (const line of String(sql).split("\n")) {
    if (START.test(line) && cur.trim()) { out.push(cur.trim()); cur = ""; }
    if (line.startsWith("-- ")) continue;
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The same statement, writing the spare copy (search_docs_next) instead of the live table. */
export function toNext(statement) {
  const m = START.exec(statement);
  if (!m) throw new Error(`unexpected statement in the search index: ${statement.slice(0, 80)}`);
  return m[1] + m[2] + "_next" + statement.slice(m[0].length);
}

/** Groups statements into batches of at most `maxBytes` (one statement may be over it alone). */
export function batches(list, maxBytes) {
  const out = [];
  let cur = [], size = 0;
  for (const s of list) {
    if (cur.length && size + s.length > maxBytes) { out.push(cur); cur = []; size = 0; }
    cur.push(s); size += s.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

const first = (res) => res?.[0]?.results?.[0] ?? {};

async function exists(run, table) {
  return Boolean(first(await run(`SELECT count(*) AS n FROM sqlite_master WHERE name = '${table}'`)).n);
}

/**
 * Loads `sql` into the spare tables, checks them and switches readers over.
 * Resolves to { rows } on success; throws (leaving the live index untouched) if the spare copy
 * fails its check.
 */
export async function bluegreenLoad(sql, run, { maxBytes = 250_000, log = () => {}, probe = "god" } = {}) {
  const list = statements(sql).map(toNext);
  const drops = TABLES.map((t) => `DROP TABLE IF EXISTS ${t}_next;`).join("\n");
  await run(drops);
  const groups = batches(list, maxBytes);
  log(`loading ${list.length} statements into search_docs_next in ${groups.length} batches`);
  for (let i = 0; i < groups.length; i++) {
    await run(groups[i].join("\n"));
    if ((i + 1) % 50 === 0) log(`  ${i + 1}/${groups.length} batches`);
  }
  // The check: the build records how many rows it wrote; the spare must hold exactly that many,
  // and a plain word search must find some.
  const want = Number(first(await run("SELECT v FROM search_meta_next WHERE k = 'rows'")).v);
  const got = Number(first(await run("SELECT count(*) AS n FROM search_docs_next")).n);
  const hits = Number(first(await run(`SELECT count(*) AS n FROM (SELECT 1 FROM search_docs_next WHERE search_docs_next MATCH '${probe}' LIMIT 5)`)).n);
  if (!want || got !== want || !hits) {
    throw new Error(`the new search index failed its check (rows ${got} of ${want}, ${hits} hits for "${probe}"); the live index is unchanged`);
  }
  log(`checked: ${got} rows, search works`);
  // Switch in one transaction: live -> _prev, next -> live.
  const swap = [];
  for (const t of TABLES) swap.push(`DROP TABLE IF EXISTS ${t}_prev;`);
  for (const t of TABLES) if (await exists(run, t)) swap.push(`ALTER TABLE ${t} RENAME TO ${t}_prev;`);
  for (const t of TABLES) swap.push(`ALTER TABLE ${t}_next RENAME TO ${t};`);
  try {
    await run(swap.join("\n"));
  } catch (e) {
    // Should the switch not run as one transaction and stop part-way, put back any live table
    // left missing, so readers are never without an index.
    for (const t of TABLES) if (!(await exists(run, t)) && (await exists(run, `${t}_prev`))) await run(`ALTER TABLE ${t}_prev RENAME TO ${t};`);
    throw e;
  }
  log("switched: readers now use the new index; the previous one is kept as search_docs_prev");
  return { rows: got };
}

/** Puts the previous index back (live -> _next, _prev -> live) in one transaction. */
export async function rollback(run) {
  for (const t of TABLES) if (!(await exists(run, `${t}_prev`))) throw new Error(`no ${t}_prev to roll back to`);
  const sql = [];
  for (const t of TABLES) sql.push(`DROP TABLE IF EXISTS ${t}_next;`, `ALTER TABLE ${t} RENAME TO ${t}_next;`, `ALTER TABLE ${t}_prev RENAME TO ${t};`);
  await run(sql.join("\n"));
}
