import type { Env } from './env';
import { keyedHash, pid } from './privacy.mjs';

const RETAIN_MS = 30 * 86400_000;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ready = new WeakMap<object, Promise<unknown>>();
const tables = (env: Env) => ready.get(env.DB) ?? ready.set(env.DB, env.DB.batch([
  env.DB.prepare('CREATE TABLE IF NOT EXISTS ask_answer_receipts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, source_ns TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS ask_answer_receipts_owner ON ask_answer_receipts(owner, created_at)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS ask_answer_receipts_expiry ON ask_answer_receipts(expires_at)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS ask_feedback (answer_id TEXT PRIMARY KEY, owner TEXT NOT NULL, rating TEXT NOT NULL, reason TEXT, source_n INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS ask_feedback_owner ON ask_feedback(owner)'),
  env.DB.prepare('CREATE TABLE IF NOT EXISTS ask_feedback_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires_at INTEGER NOT NULL)'),
  env.DB.prepare('CREATE INDEX IF NOT EXISTS ask_feedback_limits_expiry ON ask_feedback_limits(expires_at)'),
]).catch(error => { ready.delete(env.DB); throw error; })).get(env.DB)!;

export const feedbackOwner = (env: Env, userId: number) => pid(env, userId).then(value => `tg:${value}`);

/** Fresh per answer, never stored in an answer cache. Recovery reuses its server-issued ID. */
export async function issueAnswerReceipt(env: Env, userId: number, sources: { n?: number }[], now = Date.now(), answerId?: string): Promise<string | undefined> {
  try {
    const ns = [...new Set(sources.map(source => source.n))];
    if (ns.length > 2048 || ns.some(n => !Number.isSafeInteger(n) || n! < 1)) return undefined;
    if (answerId !== undefined && !ID.test(answerId)) return undefined;
    await tables(env);
    const id = answerId ?? crypto.randomUUID();
    const owner = await feedbackOwner(env, userId);
    // A deleted/incomplete request cannot mint a receipt. Keep the test and insert atomic;
    // Delete my data removes recovery admission before feedback so a late write cannot restore it.
    const insert = answerId === undefined
      ? env.DB.prepare('INSERT INTO ask_answer_receipts (id, owner, source_ns, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, owner, JSON.stringify(ns), now, now + RETAIN_MS)
      : env.DB.prepare(`INSERT OR IGNORE INTO ask_answer_receipts (id, owner, source_ns, created_at, expires_at)
          SELECT ?, ?, ?, ?, ? FROM ask_requests WHERE owner = ? AND answer_id = ? AND state = 'completed' AND expires_at > ?`)
        .bind(id, owner, JSON.stringify(ns), now, now + RETAIN_MS, await pid(env, userId), id, now);
    const result = await insert.run();
    return answerId === undefined || Number(result.meta.changes) ? id : undefined;
  } catch {
    // Feedback is optional; a lost receipt must never turn a completed answer into an error.
    console.error(JSON.stringify({ event: 'ask_receipt_unavailable' }));
    return undefined;
  }
}

export type Feedback = { answer_id: string; rating: 'up' | 'down'; reason?: 'wrong source' | 'not in library' | 'other'; source_n?: number };
/** Count bytes actually read, even when Content-Length is missing or misleading. */
export async function feedbackInput(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413; error: string }> {
  if (Number(request.headers.get('content-length')) > 2048) return { ok: false, status: 413, error: 'too-large' };
  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: 'bad-request' };
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2048) { await reader.cancel().catch(() => undefined); return { ok: false, status: 413, error: 'too-large' }; }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { ok: true, body: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data)) };
  } catch { return { ok: false, status: 400, error: 'bad-request' }; }
  finally { reader.releaseLock(); }
}

export function parseFeedback(value: unknown): Feedback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['answer_id', 'rating', 'reason', 'source_n'].includes(key)) || typeof body.answer_id !== 'string' || !ID.test(body.answer_id) || typeof body.rating !== 'string' || !['up', 'down'].includes(body.rating)) return null;
  if (body.reason !== undefined && (typeof body.reason !== 'string' || !['wrong source', 'not in library', 'other'].includes(body.reason))) return null;
  if (body.source_n !== undefined && (!Number.isSafeInteger(body.source_n) || Number(body.source_n) < 1)) return null;
  return body as Feedback;
}

/** Atomic per-minute counters; a saturated key never admits a concurrent extra request. */
async function rate(env: Env, key: string, max: number, now: number) {
  const minute = Math.floor(now / 60_000);
  return !!await env.DB.prepare(`INSERT INTO ask_feedback_limits (key, n, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n`)
    .bind(`${key}:${minute}`, (minute + 2) * 60_000, max).first();
}

/** Auth is resolved by the existing /api middleware, never by a body-supplied owner. */
export async function recordFeedback(env: Env, userId: number, body: Feedback, ip?: string, now = Date.now()): Promise<200 | 400 | 404 | 429> {
  await tables(env);
  const owner = await feedbackOwner(env, userId);
  const ipKey = await keyedHash(env, 'ask-feedback-ip', ip ?? `unknown:${owner}`);
  // The Mini App proxy shares one egress IP: keep this a coarse network guard.
  // Check it first so a rejected network does not spend a person's allowance.
  if (!await rate(env, `ip:${ipKey}`, 6000, now) || !await rate(env, `person:${owner}`, 30, now)) return 429;
  const receipt = await env.DB.prepare('SELECT source_ns FROM ask_answer_receipts WHERE id = ? AND owner = ? AND expires_at > ?')
    .bind(body.answer_id, owner, now).first<{ source_ns: string }>();
  // Unknown, expired and someone else's receipt deliberately have the same response.
  if (!receipt) return 404;
  const ns: number[] = JSON.parse(receipt.source_ns);
  if (body.source_n !== undefined && !ns.includes(body.source_n)) return 400;
  // One row per server-issued answer. Repeating the same vote is a no-op; another vote updates
  // that row, atomically. Re-check ownership/expiry inside the write to cover deletion races.
  const written = await env.DB.prepare(`INSERT INTO ask_feedback (answer_id, owner, rating, reason, source_n, created_at, updated_at)
    SELECT id, owner, ?, ?, ?, ?, ? FROM ask_answer_receipts WHERE id = ? AND owner = ? AND expires_at > ?
    ON CONFLICT(answer_id) DO UPDATE SET rating = excluded.rating, reason = excluded.reason,
      source_n = excluded.source_n, updated_at = excluded.updated_at
    WHERE ask_feedback.owner = excluded.owner AND (ask_feedback.rating != excluded.rating
      OR ask_feedback.reason IS NOT excluded.reason OR ask_feedback.source_n IS NOT excluded.source_n)
    RETURNING answer_id`)
    .bind(body.rating, body.reason ?? null, body.source_n ?? null, now, now, body.answer_id, owner, now).first();
  if (written) return 200;
  return await env.DB.prepare('SELECT id FROM ask_answer_receipts WHERE id = ? AND owner = ? AND expires_at > ?').bind(body.answer_id, owner, now).first() ? 200 : 404;
}

export async function exportFeedback(env: Env, userId: number) {
  await tables(env);
  const owner = await feedbackOwner(env, userId);
  const [receipts, ratings] = await Promise.all([
    env.DB.prepare('SELECT id AS answer_id, source_ns, created_at, expires_at FROM ask_answer_receipts WHERE owner = ? ORDER BY created_at').bind(owner).all(),
    env.DB.prepare('SELECT answer_id, rating, reason, source_n, created_at, updated_at FROM ask_feedback WHERE owner = ? ORDER BY created_at').bind(owner).all(),
  ]);
  return { receipts: receipts.results, ratings: ratings.results };
}

export async function deleteFeedback(env: Env, userId: number) {
  await tables(env);
  const owner = await feedbackOwner(env, userId);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ask_feedback WHERE owner = ?').bind(owner),
    env.DB.prepare('DELETE FROM ask_answer_receipts WHERE owner = ?').bind(owner),
    env.DB.prepare('DELETE FROM ask_feedback_limits WHERE substr(key, 1, ?) = ?').bind(`person:${owner}:`.length, `person:${owner}:`),
  ]);
}

export async function sweepFeedback(env: Env, now = Date.now()) {
  await tables(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ask_feedback WHERE answer_id IN (SELECT id FROM ask_answer_receipts WHERE expires_at <= ?)').bind(now),
    env.DB.prepare('DELETE FROM ask_answer_receipts WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM ask_feedback_limits WHERE expires_at <= ?').bind(now),
  ]);
}
