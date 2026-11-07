/** A runaway-loop guard, not a target: agents finish as soon as the question is answered. */
export const MAX_RESEARCH_ROUNDS = 25;
export const MAX_CLAUDE_OUTPUT = 12000;
export const MAX_OPEN_OUTPUT = 8000;
export const MAX_RESEARCH_MS = 110000;
export const MAX_RESEARCH_SOURCES = 256;

export const researchRounds = (requested = MAX_RESEARCH_ROUNDS) => Number.isFinite(requested)
  ? Math.min(MAX_RESEARCH_ROUNDS, Math.max(1, Math.floor(requested))) : MAX_RESEARCH_ROUNDS;

/** Same daily reservation mechanism as sponsored readers, isolated from their allowance. */
export function adminBudgetPool(env) {
  const capUsd = Number(env.ASK_ADMIN_DAILY_USD_CAP ?? 10);
  if (!Number.isFinite(capUsd) || capUsd < 0) throw new Error('Invalid admin answer budget');
  return { prefix: 'admin:', capUsd };
}

export function researchSignal(signal, deadlineAt = Date.now() + MAX_RESEARCH_MS) {
  if (deadlineAt <= Date.now()) return AbortSignal.abort(new DOMException('Research deadline reached', 'TimeoutError'));
  const remaining = Math.max(1, Math.min(MAX_RESEARCH_MS, deadlineAt - Date.now()));
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(remaining)]);
}
