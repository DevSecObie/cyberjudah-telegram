/** A runaway-loop guard, not a target: agents finish as soon as the question is answered. */
export const MAX_RESEARCH_ROUNDS = 25;
export const MAX_CLAUDE_OUTPUT = 12000;
export const MAX_OPEN_OUTPUT = 8000;
export const MAX_RESEARCH_MS = 110000;
export const WRITING_RESERVE_MS = 20000;
// Sources one answer may register and cite: the Mini App keeps at most 100 per answer
// (ask-stream.ts MAX_SOURCES), so a citation never points at a source it dropped.
export const MAX_RESEARCH_SOURCES = 100;

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

export const writingDue = deadlineAt => deadlineAt - Date.now() <= WRITING_RESERVE_MS;
export const timeLeft = deadlineAt => Math.max(1, deadlineAt - Date.now());

/** Stop awaiting a tool at the writing boundary; callers guard against late mutations. */
export function withinPhase(work, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    work().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
