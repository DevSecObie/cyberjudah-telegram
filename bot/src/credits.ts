import type { Env } from "./env";
import { pid } from "./privacy.mjs";
import { allocate, creditConfig, migrationLots, walletOf } from "../../shared/credits.mjs";

/**
 * Ask CyberJudah's pay-as-you-go balance, kept in D1 (shared/credits.mjs says what its unit is:
 * a millionth of a dollar).
 *
 * - credit_lots: every addition to the balance (a top-up, the old allowance carried over, an
 *   admin's adjustment), with what is left of it and when it expires (none of them do now).
 *   `remaining_mc >= 0` is a CHECK constraint, so no write can ever take a lot below zero: two
 *   requests that both read the same balance cannot both spend it; the second one's batch fails
 *   whole and is tried again against the new balance.
 * - credit_ledger: every movement of a balance, one row per lot moved, signed; the sum of a
 *   person's rows is their balance. Each row is unique by (who, type, ref, lot), so a retried
 *   delivery, a retried settle or a doubled payment update can never write a row twice.
 * - credit_holds: what a request holds while it runs (reserved up front, settled at the end).
 * - credit_usage: one row a request: the model, what it actually cost us, what it was charged.
 * - credit_meta: once-per-person state (the old allowance carried over).
 *
 * Owners are pseudonymous: a Telegram reader's pid (privacy.mjs).
 */
export type Owner = string;
export type Lot = { id: number; kind: string; remaining_mc: number; expires_at: number | null; created_at: number; granted_mc?: number; source?: string };

const TABLES = [
  `CREATE TABLE IF NOT EXISTS credit_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    granted_mc INTEGER NOT NULL, remaining_mc INTEGER NOT NULL CHECK (remaining_mc >= 0), expires_at INTEGER,
    source TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (user_id, source))`,
  "CREATE INDEX IF NOT EXISTS credit_lots_owner ON credit_lots (user_id, expires_at)",
  `CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL,
    type TEXT NOT NULL, amount_mc INTEGER NOT NULL, lot_id INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL, detail TEXT,
    UNIQUE (user_id, type, ref, lot_id))`,
  "CREATE INDEX IF NOT EXISTS credit_ledger_owner ON credit_ledger (user_id, at)",
  "CREATE INDEX IF NOT EXISTS credit_ledger_lot_type ON credit_ledger (lot_id, type)",
  `CREATE TABLE IF NOT EXISTS credit_holds (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, held_mc INTEGER NOT NULL,
    alloc TEXT NOT NULL, state TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_usage (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, model TEXT,
    status TEXT NOT NULL, held_mc INTEGER NOT NULL, charged_mc INTEGER NOT NULL, cost_usd REAL NOT NULL, absorbed_mc INTEGER NOT NULL DEFAULT 0, detail TEXT)`,
  "CREATE INDEX IF NOT EXISTS credit_usage_owner ON credit_usage (user_id, at)",
  // The admin's daily totals read by time alone; without this the usage page scans the whole table.
  "CREATE INDEX IF NOT EXISTS credit_usage_at ON credit_usage (at)",
  "CREATE TABLE IF NOT EXISTS credit_meta (user_id TEXT PRIMARY KEY, migrated_at INTEGER)",
  // Write-contention events per UTC day, for the hourly health check's alerting.
  "CREATE TABLE IF NOT EXISTS contention_daily (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)",
];
const ready = new WeakSet<D1Database>();
export async function ensureCreditTables(env: Env): Promise<void> {
  if (ready.has(env.DB)) return;
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  ready.add(env.DB);
}

export const ownerOfUser = (env: Env, uid: number): Promise<Owner> => pid(env, uid);
const isConstraint = (e: unknown) => /CHECK constraint|constraint failed/i.test(String((e as Error)?.message ?? e));

/**
 * D1 serializes writers: under burst load a hold/settle/refund/adjust can lose every retry.
 * Count it per UTC day so the hourly health check can page when contention stops being rare.
 */
async function noteContention(env: Env, where: string, now = Date.now()): Promise<void> {
  const day = new Date(now).toISOString().slice(0, 10);
  console.error(JSON.stringify({ event: "credits_contention", where, day }));
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS contention_daily (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("INSERT INTO contention_daily (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1").bind(day),
  ]).catch(() => null);
}

async function lotsOf(env: Env, owner: Owner): Promise<Lot[]> {
  const r = await env.DB.prepare("SELECT id, kind, granted_mc, remaining_mc, expires_at, created_at, source FROM credit_lots WHERE user_id = ? AND remaining_mc > 0").bind(owner).all<Lot>();
  return r.results ?? [];
}

/** A grant: a lot and its ledger row, both idempotent by the source (a payment's charge id, a day, a migration step). */
function grantStatements(env: Env, owner: Owner, g: { kind: string; mc: number; expires_at: number | null; source: string; type: string; detail?: unknown }, now: number) {
  return [
    env.DB.prepare("INSERT OR IGNORE INTO credit_lots (user_id, kind, granted_mc, remaining_mc, expires_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(owner, g.kind, g.mc, g.mc, g.expires_at, g.source, now),
    env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref, detail)
      SELECT user_id, ?, ?, granted_mc, id, source, ? FROM credit_lots WHERE user_id = ? AND source = ?`)
      .bind(now, g.type, g.detail === undefined ? null : JSON.stringify(g.detail), owner, g.source),
  ];
}

/**
 * Before reading or spending a balance: carry the old allowance over (once), expire anything that
 * has run out (with a ledger row), and let go of any hold a request left behind (it timed out or
 * its Worker died). Idempotent: safe to run on every request. There is no free daily grant: the
 * free model is free, and every other model is paid from the balance alone.
 */
export async function prepare(env: Env, owner: Owner, opts: { uid?: number } = {}, now = Date.now()): Promise<void> {
  await ensureCreditTables(env);
  const meta = await env.DB.prepare("SELECT migrated_at FROM credit_meta WHERE user_id = ?").bind(owner).first<{ migrated_at: number | null }>();
  const stmts: D1PreparedStatement[] = [];
  if (!meta?.migrated_at && opts.uid !== undefined) {
    // The old allowance (billing.ts `accounts`, filed under the pid, or under the Telegram id from before that, or in KV before D1).
    const acct = await legacyAccount(env, owner, opts.uid);
    for (const l of migrationLots(acct, now)) stmts.push(...grantStatements(env, owner, { kind: l.kind, mc: l.mc, expires_at: l.expires_at, source: l.source, type: "migration", detail: { units: l.units, rate: "1 unit = US$0.000005" } }, now));
  }
  if (!meta?.migrated_at) stmts.push(env.DB.prepare("INSERT INTO credit_meta (user_id, migrated_at) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET migrated_at = COALESCE(migrated_at, excluded.migrated_at)").bind(owner, now));
  // Expired lots: their remainder leaves the balance, recorded. Both statements match the same remainder, so a lot changed meanwhile is left for the next pass.
  const expired = await env.DB.prepare("SELECT id, remaining_mc FROM credit_lots WHERE user_id = ? AND remaining_mc > 0 AND expires_at IS NOT NULL AND expires_at <= ?").bind(owner, now).all<{ id: number; remaining_mc: number }>();
  for (const l of expired.results ?? []) {
    stmts.push(
      env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) SELECT user_id, ?, 'expire', -remaining_mc, id, ? FROM credit_lots WHERE id = ? AND remaining_mc = ?`).bind(now, `expire:${l.id}:${now}`, l.id, l.remaining_mc),
      env.DB.prepare("UPDATE credit_lots SET remaining_mc = 0 WHERE id = ? AND remaining_mc = ?").bind(l.id, l.remaining_mc),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  // A request that never settled (20 minutes is far past the longest answer) gives its hold back.
  const stale = await env.DB.prepare("SELECT request_id FROM credit_holds WHERE user_id = ? AND state IN ('held', 'settling') AND created_at < ?").bind(owner, now - 20 * 60000).all<{ request_id: string }>();
  for (const h of stale.results ?? []) {
    await env.DB.prepare("UPDATE credit_holds SET state = 'held' WHERE request_id = ? AND state = 'settling'").bind(h.request_id).run();
    await settle(env, owner, h.request_id, { actualMc: 0, costUsd: 0, status: "timeout" }).catch(() => null);
  }
}

type Legacy = { credits: number; plan_until: number; plan_allowance: number; plan_used: number };
async function legacyAccount(env: Env, owner: Owner, uid: number): Promise<Legacy | null> {
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").first();
  const row = has ? await env.DB.prepare("SELECT credits, plan_until, plan_allowance, plan_used FROM accounts WHERE user_id = ? OR user_id = ? ORDER BY user_id = ? DESC LIMIT 1").bind(owner, String(uid), owner).first<Legacy>() : null;
  if (row) return row;
  const kv = (await env.SUBS.get(`acct:${uid}`, "json").catch(() => null)) as { credits?: number; plan?: { until: number; allowance: number; used: number } | null } | null;
  return kv ? { credits: kv.credits ?? 0, plan_until: kv.plan?.until ?? 0, plan_allowance: kv.plan?.allowance ?? 0, plan_used: kv.plan?.used ?? 0 } : null;
}

export type Wallet = ReturnType<typeof walletOf>;
/** The balance, and the lots it is made of in the order they are spent. */
export async function wallet(env: Env, owner: Owner, now = Date.now()): Promise<Wallet> {
  await ensureCreditTables(env);
  return walletOf(await lotsOf(env, owner), now);
}

export type Hold = { ok: true; request: string; held_mc: number } | { ok: false; available_mc: number } | { ok: false; reason: "duplicate" };
/**
 * Hold part of the balance for a request before it starts: up to `wantMc` (the most it may cost),
 * at least `minMc` (or it does not start). It leaves the lots at once, so requests sent together
 * cannot spend the same money; the request settles what it actually used at the end. The same
 * request id starts work once. Repeated ids are rejected, including settled requests: merely
 * reusing their old reservation would execute new provider work without a new charge.
 */
export async function hold(env: Env, owner: Owner, request: string, wantMc: number, minMc: number, model: string, now = Date.now()): Promise<Hold> {
  for (let i = 0; i < 6; i++) {
    const had = await env.DB.prepare("SELECT 1 FROM credit_holds WHERE request_id = ?").bind(request).first();
    if (had) return { ok: false, reason: "duplicate" };
    const lots = await lotsOf(env, owner);
    const available = walletOf(lots, now).total_mc;
    if (available < Math.max(1, minMc)) return { ok: false, available_mc: available };
    const amount = Math.min(wantMc, available);
    const { take } = allocate(lots, amount, now);
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO credit_holds (request_id, user_id, held_mc, alloc, state, model, created_at) VALUES (?, ?, ?, ?, 'held', ?, ?)").bind(request, owner, amount, JSON.stringify(take), model, now),
        ...take.flatMap((t) => [
          env.DB.prepare("UPDATE credit_lots SET remaining_mc = remaining_mc - ? WHERE id = ? AND user_id = ?").bind(t.mc, t.lot, owner),
          env.DB.prepare("INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) VALUES (?, ?, 'hold', ?, ?, ?)").bind(owner, now, -t.mc, t.lot, request),
        ]),
      ]);
      return { ok: true, request, held_mc: amount };
    } catch (e) {
      // Another request spent this money first (the CHECK refused), or this request id was taken at once: read again.
      if (!isConstraint(e) && !/UNIQUE|PRIMARY KEY/i.test(String((e as Error).message))) throw e;
    }
  }
  await noteContention(env, "hold");
  throw new Error("credits contention");
}

export type Settled = { charged_mc: number; absorbed_mc: number; status: string };
/**
 * Settle a request against what it actually used: the unused part of its hold goes back to the
 * lots it came from (the never-expiring ones first), or the rest of the cost is taken from the
 * balance (soonest-expiring first) — never below zero: what the balance cannot cover is written
 * off and recorded, not owed. A failed request (`actualMc` 0) is not charged. Settling twice
 * changes nothing the second time.
 */
export async function settle(env: Env, owner: Owner, request: string, r: { actualMc: number; costUsd: number; status?: string; model?: string; detail?: unknown; absorbedMc?: number }, now = Date.now()): Promise<Settled | null> {
  const status = r.status ?? "ok";
  const claimed = await env.DB.prepare("UPDATE credit_holds SET state = 'settling' WHERE request_id = ? AND user_id = ? AND state = 'held'").bind(request, owner).run();
  if (!Number(claimed.meta.changes ?? 0)) {
    const done = await env.DB.prepare("SELECT charged_mc, absorbed_mc, status FROM credit_usage WHERE request_id = ? AND user_id = ?").bind(request, owner).first<Settled>();
    return done ?? null;
  }
  const h = await env.DB.prepare("SELECT held_mc, alloc, model FROM credit_holds WHERE request_id = ?").bind(request).first<{ held_mc: number; alloc: string; model: string }>();
  if (!h) return null;
  const alloc = JSON.parse(h.alloc) as { lot: number; mc: number }[];
  const actual = Math.max(0, Math.round(r.actualMc));
  for (let i = 0; i < 6; i++) {
    const stmts: D1PreparedStatement[] = [];
    let charged = actual, absorbed = Math.max(0, Math.round(r.absorbedMc ?? 0));
    if (actual <= h.held_mc) {
      let back = h.held_mc - actual;
      for (const t of [...alloc].reverse()) {
        if (!back) break;
        const n = Math.min(back, t.mc); back -= n;
        stmts.push(
          // A refund ledger row is a durable tombstone, including refunds of an entirely
          // held lot (amount 0). D1 executes this batch atomically with respect to refunds.
          env.DB.prepare("UPDATE credit_lots SET remaining_mc = remaining_mc + ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE lot_id = ? AND type = 'refund')").bind(n, t.lot, t.lot),
          env.DB.prepare("INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) VALUES (?, ?, 'release', ?, ?, ?)").bind(owner, now, n, t.lot, request),
          // Keep the ledger and history balanced when unused funds go back to a refunded
          // payment instead of the wallet. This also handles failed and timed-out answers.
          env.DB.prepare("INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) SELECT ?, ?, 'refund', ?, ?, ? WHERE EXISTS (SELECT 1 FROM credit_ledger WHERE lot_id = ? AND type = 'refund')").bind(owner, now, -n, t.lot, `refund-hold:${request}`, t.lot),
        );
      }
    } else {
      const { take, short } = allocate(await lotsOf(env, owner), actual - h.held_mc, now);
      absorbed += short; charged = actual - short;
      for (const t of take) stmts.push(
        env.DB.prepare("UPDATE credit_lots SET remaining_mc = remaining_mc - ? WHERE id = ? AND user_id = ?").bind(t.mc, t.lot, owner),
        env.DB.prepare("INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref) VALUES (?, ?, 'usage', ?, ?, ?)").bind(owner, now, -t.mc, t.lot, request),
      );
    }
    stmts.push(
      env.DB.prepare(`INSERT OR IGNORE INTO credit_usage (request_id, user_id, at, model, status, held_mc, charged_mc, cost_usd, absorbed_mc, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(request, owner, now, r.model ?? h.model, status, h.held_mc, charged, r.costUsd, absorbed, r.detail === undefined ? null : JSON.stringify(r.detail)),
      env.DB.prepare("UPDATE credit_holds SET state = 'settled' WHERE request_id = ?").bind(request),
    );
    try { await env.DB.batch(stmts); return { charged_mc: charged, absorbed_mc: absorbed, status }; }
    catch (e) { if (!isConstraint(e)) { await env.DB.prepare("UPDATE credit_holds SET state = 'held' WHERE request_id = ? AND state = 'settling'").bind(request).run().catch(() => null); throw e; } }
  }
  await env.DB.prepare("UPDATE credit_holds SET state = 'held' WHERE request_id = ? AND state = 'settling'").bind(request).run().catch(() => null);
  await noteContention(env, "settle");
  throw new Error("credits contention");
}

/**
 * A payment added to the balance, once per Telegram charge, never expiring. The payment record,
 * the lot and the ledger row are written together and each is unique by the charge id, so a
 * payment delivered twice is added once. `kind` is what was paid for: a top-up ("pack"), or a
 * renewal of a monthly plan bought before there were none ("plan"), added the same way.
 */
export async function grantPayment(env: Env, owner: Owner, p: { charge: string; kind: "plan" | "pack"; stars: number; mc: number }, now = Date.now()): Promise<boolean> {
  await ensureCreditTables(env);
  const grants = grantStatements(env, owner, { kind: "topup", mc: p.mc, expires_at: null, source: `pay:${p.charge}`, type: "purchase", detail: { stars: p.stars, ...(p.kind === "plan" ? { renewal: true } : {}) } }, now);
  // The retained charge is the authority, even partway through Delete my data.
  // Create the lot only for a new charge, then record that charge in the SAME batch.
  // A late delivery cannot recreate a deleted lot or credit a different reader.
  grants[0] = env.DB.prepare(`INSERT OR IGNORE INTO credit_lots (user_id, kind, granted_mc, remaining_mc, expires_at, source, created_at)
    SELECT ?, 'topup', ?, ?, NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM payments WHERE charge_id = ?)`)
    .bind(owner, p.mc, p.mc, `pay:${p.charge}`, now, p.charge);
  const res = await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL)"),
    ...grants,
    env.DB.prepare("INSERT OR IGNORE INTO payments (charge_id, user_id, kind, stars, created_at) VALUES (?, ?, ?, ?, ?)").bind(p.charge, owner, p.kind, p.stars, now),
  ]);
  return Number(res[1].meta.changes ?? 0) > 0;
}

/**
 * A refund (Telegram's refunded_payment, or an admin's refund): what the payment added that is
 * still unspent leaves the balance; what was already spent is not taken back from the rest of
 * the balance. Recorded once per charge.
 */
export async function refundPayment(env: Env, owner: Owner, charge: string, now = Date.now()): Promise<{ clawed_mc: number; spent_mc: number } | null> {
  await ensureCreditTables(env);
  for (let i = 0; i < 6; i++) {
    const lot = await env.DB.prepare("SELECT id, granted_mc, remaining_mc FROM credit_lots WHERE user_id = ? AND source = ?").bind(owner, `pay:${charge}`).first<{ id: number; granted_mc: number; remaining_mc: number }>();
    if (!lot) return null;
    const res = await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref, detail) SELECT user_id, ?, 'refund', -remaining_mc, id, ?, ? FROM credit_lots WHERE id = ? AND remaining_mc = ?`).bind(now, `refund:${charge}`, JSON.stringify({ granted_mc: lot.granted_mc, spent_mc: lot.granted_mc - lot.remaining_mc }), lot.id, lot.remaining_mc),
      // Zeroed only by the refund row just written (its time is this call's): a refund recorded before leaves the lot alone.
      env.DB.prepare("UPDATE credit_lots SET remaining_mc = 0 WHERE id = ? AND remaining_mc = ? AND EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ? AND type = 'refund' AND ref = ? AND lot_id = ? AND at = ?)").bind(lot.id, lot.remaining_mc, owner, `refund:${charge}`, lot.id, now),
    ]);
    if (Number(res[0].meta.changes ?? 0) > 0) return { clawed_mc: lot.remaining_mc, spent_mc: lot.granted_mc - lot.remaining_mc };
    const already = await env.DB.prepare("SELECT amount_mc FROM credit_ledger WHERE user_id = ? AND type = 'refund' AND ref = ?").bind(owner, `refund:${charge}`).first<{ amount_mc: number }>();
    if (already) return { clawed_mc: -already.amount_mc, spent_mc: 0 };
  }
  await noteContention(env, "refundPayment");
  throw new Error("credits contention");
}

/** An admin's adjustment: money added (a lot that never expires), or taken (in spend order, never below zero). */
export async function adjust(env: Env, owner: Owner, mc: number, ref: string, note: string, now = Date.now()): Promise<number> {
  await ensureCreditTables(env);
  if (mc > 0) { await env.DB.batch(grantStatements(env, owner, { kind: "adjust", mc, expires_at: null, source: `adjust:${ref}`, type: "adjustment", detail: { note } }, now)); return mc; }
  if (await env.DB.prepare("SELECT 1 FROM credit_ledger WHERE user_id = ? AND type = 'adjustment' AND ref = ?").bind(owner, `adjust:${ref}`).first()) return 0;
  for (let i = 0; i < 6; i++) {
    const { take } = allocate(await lotsOf(env, owner), -mc, now);
    try {
      await env.DB.batch(take.flatMap((t) => [
        env.DB.prepare("UPDATE credit_lots SET remaining_mc = remaining_mc - ? WHERE id = ?").bind(t.mc, t.lot),
        env.DB.prepare("INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref, detail) VALUES (?, ?, 'adjustment', ?, ?, ?, ?)").bind(owner, now, -t.mc, t.lot, `adjust:${ref}`, JSON.stringify({ note })),
      ]));
      return -take.reduce((s, t) => s + t.mc, 0);
    } catch (e) { if (!isConstraint(e)) throw e; }
  }
  await noteContention(env, "adjust");
  throw new Error("credits contention");
}

export type HistoryItem = { at: number; kind: string; amount_mc: number; model?: string | null; status?: string; expires_at?: number | null; detail?: unknown };
/**
 * What happened to the balance, newest first: each answer once (with the model and what it cost,
 * however its hold moved), and every top-up, refund, adjustment, carry-over and expiry.
 */
export async function history(env: Env, owner: Owner, limit = 60): Promise<HistoryItem[]> {
  await ensureCreditTables(env);
  const [use, led] = await Promise.all([
    env.DB.prepare("SELECT at, model, status, charged_mc FROM credit_usage WHERE user_id = ? ORDER BY at DESC LIMIT ?").bind(owner, limit).all<{ at: number; model: string; status: string; charged_mc: number }>(),
    env.DB.prepare(`SELECT l.at, l.type, SUM(l.amount_mc) AS amount_mc, MAX(c.expires_at) AS expires_at, MAX(l.detail) AS detail FROM credit_ledger l LEFT JOIN credit_lots c ON c.id = l.lot_id
      WHERE l.user_id = ? AND l.type NOT IN ('hold', 'release', 'usage') GROUP BY l.type, l.ref ORDER BY l.at DESC LIMIT ?`).bind(owner, limit).all<{ at: number; type: string; amount_mc: number; expires_at: number | null; detail: string | null }>(),
  ]);
  const items: HistoryItem[] = [
    ...(use.results ?? []).map((u) => ({ at: u.at, kind: "usage", amount_mc: -u.charged_mc, model: u.model, status: u.status })),
    ...(led.results ?? []).filter((l) => l.amount_mc !== 0).map((l) => ({ at: l.at, kind: l.type, amount_mc: l.amount_mc, expires_at: l.expires_at, detail: l.detail ? JSON.parse(l.detail) : undefined })),
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** The typical cost of an answer on a model lately, from what answers actually used (null until there are a few). */
export async function typicalMc(env: Env, model: string, now = Date.now()): Promise<number | null> {
  await ensureCreditTables(env);
  const r = await env.DB.prepare("SELECT charged_mc + absorbed_mc AS mc FROM credit_usage WHERE model = ? AND status = 'ok' AND at > ? ORDER BY at DESC LIMIT 40").bind(model, now - 14 * 86400000).all<{ mc: number }>();
  const xs = (r.results ?? []).map((x) => x.mc).sort((a, b) => a - b);
  return xs.length >= 5 ? xs[Math.floor(xs.length / 2)] : null;
}

/** The admins' view of a day: requests, what they cost, what readers were charged, and what was written off. */
export async function usageDayCredits(env: Env, day: string): Promise<{ requests: number; people: number; cost_usd: number; charged_mc: number; absorbed_mc: number; failed: number }> {
  await ensureCreditTables(env);
  const from = Date.parse(`${day}T00:00:00Z`), to = from + 86400000;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS requests, COUNT(DISTINCT user_id) AS people, COALESCE(SUM(cost_usd), 0) AS cost_usd, COALESCE(SUM(charged_mc), 0) AS charged_mc,
    COALESCE(SUM(absorbed_mc), 0) AS absorbed_mc, SUM(status <> 'ok') AS failed FROM credit_usage WHERE at >= ? AND at < ?`).bind(from, to).first<{ requests: number; people: number; cost_usd: number; charged_mc: number; absorbed_mc: number; failed: number }>();
  return { requests: r?.requests ?? 0, people: r?.people ?? 0, cost_usd: Math.round((r?.cost_usd ?? 0) * 10000) / 10000, charged_mc: r?.charged_mc ?? 0, absorbed_mc: r?.absorbed_mc ?? 0, failed: r?.failed ?? 0 };
}

/** Holds no request settled (the Worker stopped mid-answer), for the hourly cron: released, not charged. */
export async function sweepHolds(env: Env, now = Date.now()): Promise<number> {
  await ensureCreditTables(env);
  const stale = await env.DB.prepare("SELECT request_id, user_id FROM credit_holds WHERE state IN ('held', 'settling') AND created_at < ? LIMIT 200").bind(now - 20 * 60000).all<{ request_id: string; user_id: string }>();
  let n = 0;
  for (const h of stale.results ?? []) { await env.DB.prepare("UPDATE credit_holds SET state = 'held' WHERE request_id = ? AND state = 'settling'").bind(h.request_id).run(); if (await settle(env, h.user_id, h.request_id, { actualMc: 0, costUsd: 0, status: "timeout" }).catch(() => null)) n++; }
  return n;
}

/** Delete my data: the balance, its history and holds go; a payment keeps only its charge, kind, amount and date, unlinked (docs/PRIVACY.md). */
export async function deleteCredits(env: Env, owner: Owner): Promise<{ total_mc: number }> {
  await ensureCreditTables(env);
  const w = walletOf(await lotsOf(env, owner));
  await env.DB.batch(["credit_lots", "credit_ledger", "credit_holds", "credit_usage", "credit_meta"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(owner)));
  return { total_mc: w.total_mc };
}

/** What is kept for this person, for "Download my data". Read only. */
export async function creditsRecord(env: Env, owner: Owner): Promise<{ wallet: ReturnType<typeof walletOf>; history: HistoryItem[] }> {
  await ensureCreditTables(env);
  return { wallet: walletOf(await lotsOf(env, owner)), history: await history(env, owner, 500) };
}

export const creditsConfig = (env: Env) => creditConfig(env as unknown as Record<string, unknown>);
