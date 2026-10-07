import { DatabaseSync } from 'node:sqlite';

/** Real SQLite with atomic, serialized D1 batches and injectable storage failures. */
export function financialDb(t) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  let failure, remaining = 0, queue = Promise.resolve();
  const check = q => { if (remaining && failure.test(q)) { remaining--; throw new Error('storage unavailable'); } };
  const statement = (q, args = []) => ({
    bind: (...values) => statement(q, values),
    async first() { check(q); return sql.prepare(q).get(...args) ?? null; },
    async all() { check(q); return { results: sql.prepare(q).all(...args) }; },
    execute() { check(q); const s = sql.prepare(q); if (/RETURNING/i.test(q)) { const results = s.all(...args); return { results, meta: { changes: results.length } }; } return { results: [], meta: { changes: Number(s.run(...args).changes) } }; },
    async run() { return this.execute(); },
  });
  const DB = { prepare: statement, batch(stmts) {
    const job = queue.then(() => {
      sql.exec('BEGIN');
      try { const results = stmts.map(s => s.execute()); sql.exec('COMMIT'); return results; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    });
    queue = job.catch(() => undefined); return job;
  } };
  const values = new Map();
  return { sql, DB, fail: (pattern, times = 1) => { failure = pattern; remaining = times; },
    env: { DB, SUBS: { async get(k, type) { const v = values.get(k) ?? null; return type === 'json' && v ? JSON.parse(v) : v; }, async put(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } },
      PRIVACY_KEY: 'local-test-only', BOT_TOKEN: '100000001:local-test-only', ADMIN_IDS: '100000002', ASK_BILLING: 'on', ASK_USD_PER_STAR: '0.013', ASK_FREE_DAILY_USD_CAP: '0.11' } };
}
