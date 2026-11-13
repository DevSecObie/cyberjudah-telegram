/**
 * Blue-green load of a full-replace SQL file (the search index, the teachings index) into a live
 * D1 database.
 *
 * The old loads ran the file as a D1 import: the import locks the entire database for a minute or
 * more ("Currently processing a long-running import"), and the SQL drops the live tables first,
 * so readers had no search while it ran and a load that failed part-way left a broken index. Now:
 *
 *   1. every statement is rewritten to build <table>_next beside the live tables, and sent as
 *      ordinary queries in small batches, so readers keep the live tables and the database is
 *      never locked;
 *   2. the spare copy is checked (each table holds the rows the file wrote, and a word search on
 *      the first table finds rows);
 *   3. one transaction renames live -> <table>_prev and next -> live, so readers switch in one step;
 *   4. the previous copy stays as <table>_prev for an instant rollback (`rollback()`), and is
 *      dropped at the start of the next load.
 *
 * Two loads of the same tables at once would drop each other's <table>_next (a scheduled run
 * starting while a deploy's load is half done), so a load first takes a lease on its tables in
 * the database (load_locks), renews it while it writes, and waits while another load holds it.
 *
 * `run(sql)` executes SQL (one or more statements, run as one transaction) and resolves to an
 * array with one `{ results: [...] }` per statement, like D1's REST /query. The loaders pass the
 * REST API (d1-query.mjs); the tests pass node:sqlite.
 *
 * Shared by DevSecObie/cyberjudah-telegram (bot/scripts/) and DevSecObie/cyberjudah
 * (.github/scripts/): keep the two copies the same.
 */

/** The search index (engine/build.mjs): search_meta records the row count. */
export const SEARCH = { tables: ["search_docs", "search_meta"], probe: "god" };
/** The teachings index (scripts/corpus/index.py): one row per INSERT. */
export const TEACHINGS = { tables: ["teaching_passages", "teaching_refs"], probe: "god" };

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startRe = (tables) => new RegExp(`^(DROP TABLE IF EXISTS |CREATE (?:VIRTUAL )?TABLE |INSERT INTO |CREATE (?:UNIQUE )?INDEX (\\w+) ON )(${tables.map(esc).join("|")})\\b`);

/** Splits a load file into statements (each starts a line with DROP, CREATE or INSERT). */
export function statements(sql, tables = SEARCH.tables) {
  return [...splitLines(String(sql).split("\n"), tables)];
}

function* splitLines(lines, tables) {
  const START = startRe(tables);
  let cur = "";
  for (const line of lines) {
    if (line.startsWith("-- ")) continue;
    if (START.test(line) && cur.trim()) { yield cur.trim(); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) yield cur.trim();
}

/**
 * The same, from lines read one at a time (an async iterable, such as readline over a file), so a
 * load file larger than a JavaScript string can hold (the teachings index is) is never read whole.
 */
export async function* statementStream(lines, tables = SEARCH.tables) {
  const START = startRe(tables);
  let cur = "";
  for await (const line of lines) {
    if (line.startsWith("-- ")) continue;
    if (START.test(line) && cur.trim()) { yield cur.trim(); cur = ""; }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur.trim()) yield cur.trim();
}

/**
 * The same statement, writing the spare copy (<table>_next) instead of the live table. An index
 * gets a name of its own for this load (index names are shared by the whole database, and the
 * live table's index keeps the old one).
 */
export function toNext(statement, tables = SEARCH.tables, tag = "") {
  const m = startRe(tables).exec(statement);
  if (!m) throw new Error(`unexpected statement in the load file: ${statement.slice(0, 80)}`);
  let head = m[1];
  if (m[2]) head = head.replace(` ${m[2]} ON `, ` ${m[2]}_${tag || "next"} ON `);
  return head + m[3] + "_next" + statement.slice(m[0].length);
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

/** How long a lease lasts unless renewed (a load that dies frees its tables after this). */
export const LEASE_MS = 10 * 60_000;

/**
 * Takes the lease named `name` for `holder`, waiting up to `waitMs` while another load holds it.
 * A lease past its expiry is free to take, so a crashed load never blocks the next one for long.
 */
export async function acquireLease(run, name, holder, { waitMs = 45 * 60_000, pollMs = 15_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, log = () => {} } = {}) {
  await run("CREATE TABLE IF NOT EXISTS load_locks(name TEXT PRIMARY KEY, holder TEXT NOT NULL, expires INTEGER NOT NULL);");
  const start = now();
  for (let said = false; ; said = true) {
    const t = now();
    await run(`INSERT INTO load_locks(name, holder, expires) VALUES('${name}', '${holder}', ${t + LEASE_MS}) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires = excluded.expires WHERE load_locks.expires < ${t} OR load_locks.holder = excluded.holder;`);
    const row = first(await run(`SELECT holder, expires FROM load_locks WHERE name = '${name}'`));
    if (row.holder === holder) return;
    if (now() - start >= waitMs) throw new Error(`another load (${row.holder}) still holds ${name} after ${Math.round(waitMs / 60_000)} min; the live tables are unchanged`);
    if (!said) log(`another load (${row.holder}) is writing ${name}; waiting for it to finish`);
    await sleep(pollMs);
  }
}

/** Extends the lease; throws if this load no longer holds it (so it never switches tables it lost). */
export async function renewLease(run, name, holder, now = Date.now) {
  await run(`UPDATE load_locks SET expires = ${now() + LEASE_MS} WHERE name = '${name}' AND holder = '${holder}';`);
  if (first(await run(`SELECT holder FROM load_locks WHERE name = '${name}'`)).holder !== holder) throw new Error(`lost the lease on ${name} to another load; the live tables are unchanged`);
}

export async function releaseLease(run, name, holder) {
  await run(`DELETE FROM load_locks WHERE name = '${name}' AND holder = '${holder}';`);
}

async function exists(run, table) {
  return Boolean(first(await run(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '${table}'`)).n);
}

/** Rows each table should hold: search_meta's count, or one per INSERT where each writes one row. */
async function expectedRows(run, inserts, tables) {
  if (tables.includes("search_meta")) return { search_docs: Number(first(await run("SELECT v FROM search_meta_next WHERE k = 'rows'")).v) };
  return Object.fromEntries(tables.map((t) => [t, inserts[t] ?? 0]));
}

/**
 * Loads `sql` into the spare tables, checks them and switches readers over, holding the lease on
 * the tables throughout. `sql` is the file's text, or a function that opens its lines as an async
 * iterable (read as it loads, for a file too large to hold as one string).
 * Resolves to { rows } on success; throws (leaving the live tables untouched) if the spare copy
 * fails its check.
 */
export async function bluegreenLoad(sql, run, { tables = SEARCH.tables, probe = SEARCH.probe, maxBytes = 250_000, log = () => {}, lease = {} } = {}) {
  const tag = `b${Date.now().toString(36)}`;
  const holder = `${process.env.GITHUB_RUN_ID ? `run ${process.env.GITHUB_RUN_ID}` : "load"} ${tag}${Math.random().toString(36).slice(2, 6)}`;
  const lock = tables[0];
  await acquireLease(run, lock, holder, { log, ...lease });
  try {
    return await loadHeld(sql, run, { tables, probe, maxBytes, log, tag, renew: () => renewLease(run, lock, holder, lease.now) });
  } finally {
    await releaseLease(run, lock, holder).catch(() => {});
  }
}

async function loadHeld(sql, run, { tables, probe, maxBytes, log, tag, renew }) {
  // A function opens the file only now that the lease is held (lines read early would be lost).
  const text = typeof sql === "function" ? sql() : sql;
  const source = typeof text === "string" ? splitLines(text.split("\n"), tables) : statementStream(text, tables);
  await run(tables.map((t) => `DROP TABLE IF EXISTS ${t}_next;`).join("\n"));
  log(`loading into ${tables.map((t) => `${t}_next`).join(", ")} in batches of up to ${Math.round(maxBytes / 1000)} kB`);
  const inserts = {};
  let batch = [], size = 0, sent = 0, count = 0;
  const flush = async () => {
    if (!batch.length) return;
    await run(batch.join("\n"));
    batch = []; size = 0; sent++;
    if (sent % 50 === 0) { log(`  ${sent} batches, ${count} statements`); await renew(); }
  };
  for await (const statement of source) {
    const s = toNext(statement, tables, tag);
    count++;
    for (const t of tables) if (s.startsWith(`INSERT INTO ${t}_next VALUES(`)) inserts[t] = (inserts[t] ?? 0) + 1;
    if (batch.length && size + s.length > maxBytes) await flush();
    batch.push(s); size += s.length + 1;
  }
  await flush();
  log(`loaded ${count} statements in ${sent} batches`);
  // The check: each table holds exactly the rows the file wrote, and a word search finds some.
  const want = await expectedRows(run, inserts, tables);
  const rows = {};
  for (const [t, n] of Object.entries(want)) {
    rows[t] = Number(first(await run(`SELECT count(*) AS n FROM ${t}_next`)).n);
    if (!n || rows[t] !== n) throw new Error(`the new ${t} failed its check (rows ${rows[t]} of ${n}); the live tables are unchanged`);
  }
  const fts = `${tables[0]}_next`;
  const hits = Number(first(await run(`SELECT count(*) AS n FROM (SELECT 1 FROM ${fts} WHERE ${fts} MATCH '${probe}' LIMIT 5)`)).n);
  if (!hits) throw new Error(`the new ${tables[0]} failed its check (0 hits for "${probe}"); the live tables are unchanged`);
  log(`checked: ${Object.entries(rows).map(([t, n]) => `${t} ${n} rows`).join(", ")}; search works`);
  // Switch in one transaction: live -> _prev, next -> live.
  await renew();
  const swap = [];
  for (const t of tables) swap.push(`DROP TABLE IF EXISTS ${t}_prev;`);
  for (const t of tables) if (await exists(run, t)) swap.push(`ALTER TABLE ${t} RENAME TO ${t}_prev;`);
  for (const t of tables) swap.push(`ALTER TABLE ${t}_next RENAME TO ${t};`);
  try {
    await run(swap.join("\n"));
  } catch (e) {
    // Should the switch not run as one transaction and stop part-way, put back any live table
    // left missing, so readers are never without an index.
    for (const t of tables) if (!(await exists(run, t)) && (await exists(run, `${t}_prev`))) await run(`ALTER TABLE ${t}_prev RENAME TO ${t};`);
    throw e;
  }
  log(`switched: readers now use the new tables; the previous ones are kept as ${tables.map((t) => `${t}_prev`).join(", ")}`);
  return { rows };
}

/** Puts the previous copy back (live -> _next, _prev -> live) in one transaction. */
export async function rollback(run, tables = SEARCH.tables) {
  for (const t of tables) if (!(await exists(run, `${t}_prev`))) throw new Error(`no ${t}_prev to roll back to`);
  const sql = [];
  for (const t of tables) sql.push(`DROP TABLE IF EXISTS ${t}_next;`, `ALTER TABLE ${t} RENAME TO ${t}_next;`, `ALTER TABLE ${t}_prev RENAME TO ${t};`);
  await run(sql.join("\n"));
}
