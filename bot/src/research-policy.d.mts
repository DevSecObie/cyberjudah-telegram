export const MAX_RESEARCH_ROUNDS: number;
export const MAX_CLAUDE_OUTPUT: number;
export const MAX_OPEN_OUTPUT: number;
export const MAX_RESEARCH_MS: number;
export const MAX_RESEARCH_SOURCES: number;
export function researchRounds(requested?: number): number;
export function adminBudgetPool(env: { ASK_ADMIN_DAILY_USD_CAP?: string }): { prefix: string; capUsd: number };
export function researchSignal(signal?: AbortSignal, deadlineAt?: number): AbortSignal;
export type ResearchControl = { signal?: AbortSignal; deadlineAt?: number };
