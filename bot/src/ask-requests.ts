import type { Env } from "./env";
import { keyedHash, open, pid, seal } from "./privacy.mjs";
import { ensureCreditTables, wallet } from "./credits";
import { MAX_RESEARCH_MS } from "./research-policy.mjs";

export const ASK_REQUEST_ID = /^[a-z0-9_-]{8,64}$/i;
const RETAIN_MS = 180 * 86400_000;
type Outcome = "running" | "completed" | "interrupted" | "failed";
export type RequestResult = {
  done?: Record<string, unknown>;
  partial?: string;
  error?: string;
  usage?: { charged_mc: number; balance?: unknown; free?: boolean };
  settlement: "pending" | "settled";
};
type Row = {
  owner: string; request: string; answer_id: string; fingerprint: string; meter_request: string;
  model: string; chat: string | null; state: Outcome; started: number; created_at: number;
  expires_at: number; payload: string | null; budget_request: string | null;
};
export type AskRequest = {
  request: string; answer_id: string; model: string; state: Outcome; created_at: number;
} & RequestResult;
export type RequestClaim = Pick<Row, "owner" | "request" | "answer_id" | "meter_request">;

const ready = new WeakMap<object, Promise<unknown>>();
async function tables(env: Env) {
  let work = ready.get(env.DB);
  if (!work) {
    work = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ask_requests (
        owner TEXT NOT NULL, request TEXT NOT NULL, answer_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        meter_request TEXT NOT NULL, model TEXT NOT NULL, chat TEXT, state TEXT NOT NULL,
        started INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        payload TEXT, budget_request TEXT, PRIMARY KEY (owner, request))`),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS ask_requests_expiry ON ask_requests (expires_at)"),
    ]).catch(e => { ready.delete(env.DB); throw e; });
    ready.set(env.DB, work);
  }
  await work;
}

export async function requestIdentity(env: Env, uid: number, request: string, input: unknown) {
  const owner = await pid(env, uid);
  return {
    owner, request,
    fingerprint: await keyedHash(env, "ask-request-input", JSON.stringify([owner, input])),
    meter_request: await keyedHash(env, "ask-request-meter", JSON.stringify([owner, request])),
  };
}

export async function findAskRequest(env: Env, owner: string, request: string, now = Date.now()): Promise<Row | null> {
  await tables(env);
  return env.DB.prepare("SELECT * FROM ask_requests WHERE owner = ? AND request = ? AND expires_at > ?")
    .bind(owner, request, now).first<Row>();
}

/** One atomic admission for every model, including free/admin and billing-off requests. */
export async function claimAskRequest(env: Env, identity: Awaited<ReturnType<typeof requestIdentity>>, model: string, chat?: string, now = Date.now()): Promise<{ created: boolean; row: Row }> {
  await tables(env);
  const answerId = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM ask_requests WHERE owner = ? AND request = ? AND expires_at <= ?").bind(identity.owner, identity.request, now),
    env.DB.prepare(`INSERT OR IGNORE INTO ask_requests
      (owner, request, answer_id, fingerprint, meter_request, model, chat, state, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
      .bind(identity.owner, identity.request, answerId, identity.fingerprint, identity.meter_request, model, chat ?? null, now, now + RETAIN_MS),
  ]);
  const row = await findAskRequest(env, identity.owner, identity.request, now);
  if (!row) throw new Error("Ask request admission unavailable");
  return { created: Number(result[1].meta.changes) === 1, row };
}

/** Old paid request IDs remain single-use across this rollout, even without a recoverable result. */
export async function legacyAskRequest(env: Env, owner: string, request: string): Promise<boolean> {
  // A read only: it creates no credit table, so a request rejected before consent or by the model
  // allowlist leaves no billing tables behind (#601). No table yet means no old hold.
  const table = await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credit_holds'").first();
  if (!table) return false;
  return !!await env.DB.prepare("SELECT 1 FROM credit_holds WHERE user_id = ? AND request_id = ?").bind(owner, request).first();
}

export async function startAskRequest(env: Env, claim: RequestClaim, budgetRequest?: string): Promise<void> {
  const result = await env.DB.prepare("UPDATE ask_requests SET started = 1, budget_request = ? WHERE owner = ? AND request = ? AND answer_id = ?")
    .bind(budgetRequest ?? null, claim.owner, claim.request, claim.answer_id).run();
  if (!Number(result.meta.changes)) throw new Error("Ask request removed before starting");
}

/** A preflight denial spent nothing: consent/cost/balance retries may reuse the client ID. */
export async function releaseAskRequest(env: Env, claim: RequestClaim): Promise<void> {
  await env.DB.prepare("DELETE FROM ask_requests WHERE owner = ? AND request = ? AND answer_id = ? AND started = 0 AND state = 'running'")
    .bind(claim.owner, claim.request, claim.answer_id).run();
}

/** UPDATE only: deleting private data while an answer runs must never recreate it. */
export async function saveAskRequest(env: Env, claim: RequestClaim, state: Outcome, result: RequestResult): Promise<void> {
  const payload = await seal(env, claim.owner, result);
  const saved = await env.DB.prepare(`UPDATE ask_requests SET state = ?, payload = ?
    WHERE owner = ? AND request = ? AND answer_id = ?${state === "running" ? " AND state = 'running'" : state !== "completed" ? " AND state <> 'completed'" : ""}`)
    .bind(state, payload, claim.owner, claim.request, claim.answer_id).run();
  if (!Number(saved.meta.changes) && state !== "running") throw new Error("Ask request removed or already completed");
}

export async function publicAskRequest(env: Env, row: Row, now = Date.now(), reconcile = true): Promise<AskRequest> {
  const stored = row.payload ? await open<RequestResult>(env, row.owner, row.payload) : null;
  if (row.payload && !stored) throw new Error("Ask request cannot be opened");
  const result = stored ?? { settlement: "pending" as const };
  // A dead Worker cannot restart a request. Its hold is released by the existing stale-hold sweep.
  const state = row.state === "running" && now > row.created_at + MAX_RESEARCH_MS + 60000 ? "interrupted" : row.state;
  if (reconcile && state !== "running" && result.settlement === "pending") {
    // A lost write after settlement is repaired from the authoritative ledger without settling again.
    await ensureCreditTables(env);
    const usage = await env.DB.prepare("SELECT charged_mc FROM credit_usage WHERE user_id = ? AND request_id = ?")
      .bind(row.owner, row.meter_request).first<{ charged_mc: number }>();
    if (usage) { result.usage = { charged_mc: usage.charged_mc }; result.settlement = "settled"; }
    else if (row.budget_request) {
      const hold = await env.DB.prepare("SELECT state FROM free_spend_holds WHERE request_id = ?").bind(row.budget_request).first<{ state: string }>();
      // A free usage line only with billing on (ai.ts creditsOn; not imported here: ai.ts imports this file).
      if (hold?.state === "settled") { if (env.ASK_BILLING === "on") result.usage = { charged_mc: 0, free: true }; result.settlement = "settled"; }
    }
  }
  // Replaying an old answer must not replace the client's balance with a historical snapshot.
  if (reconcile && result.usage && !result.usage.free) result.usage = { ...result.usage, balance: await wallet(env, row.owner) };
  return { request: row.request, answer_id: row.answer_id, model: row.model, state, created_at: row.created_at, ...result,
    ...(state === "interrupted" && !result.error ? { error: "unavailable" } : {}) };
}

export async function recoverAskRequest(env: Env, uid: number, request: string): Promise<AskRequest | null> {
  const row = await findAskRequest(env, await pid(env, uid), request);
  return row ? publicAskRequest(env, row) : null;
}

export async function deleteAskRequests(env: Env, uid: number, chat?: string): Promise<void> {
  await tables(env);
  await env.DB.prepare(`DELETE FROM ask_requests WHERE owner = ?${chat ? " AND chat = ?" : ""}`)
    .bind(await pid(env, uid), ...(chat ? [chat] : [])).run();
}

export async function exportAskRequests(env: Env, uid: number): Promise<AskRequest[]> {
  await tables(env);
  const rows = await env.DB.prepare("SELECT * FROM ask_requests WHERE owner = ? AND expires_at > ? ORDER BY created_at")
    .bind(await pid(env, uid), Date.now()).all<Row>();
  // Export the stored snapshots in one query; avoid a wallet/ledger query for every old answer.
  return Promise.all((rows.results ?? []).map(row => publicAskRequest(env, row, Date.now(), false)));
}

export async function sweepAskRequests(env: Env, now = Date.now()): Promise<void> {
  await tables(env);
  await env.DB.prepare("DELETE FROM ask_requests WHERE expires_at <= ?").bind(now).run();
}
