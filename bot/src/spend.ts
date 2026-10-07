import { callUsd, estTokens, RESEARCH_RATES, searchUsd, type ResearchRates } from "../../shared/credits.mjs";
import type { AskModel } from "../../shared/ask-models.mjs";

/**
 * What one Ask request has cost so far, measured as it runs: every model call from the usage it
 * reported, at that model's price (with Cloudflare's Unified Billing fee where it applies), and
 * every library search from what it embedded, queried and reranked. Each cost is counted once,
 * where it happens. With a budget (what was held from the balance for the request, in dollars), the research
 * stops in time and the answer is written in what is left (agent.ts, agent-open.ts).
 */
export type Spend = {
  readonly fee: number;
  readonly budgetUsd: number | null;
  modelUsd: number; researchUsd: number; calls: number; searches: number;
  unreported: boolean;
  call(usage: object | null | undefined, model: AskModel): void;
  search(s: { query: string; contexts: string[] }): void;
  total(): number;
  /** Whether more than this share of the budget is spent. */
  over(share: number): boolean;
  /** Output tokens the rest of the budget pays for on this model, keeping `reserveUsd` for the next call's input. */
  outputTokensLeft(model: AskModel, reserveUsd: number): number;
  /** A call's input cost alone (what the next round will at least read again). */
  inputUsd(usage: object | null | undefined, model: AskModel): number;
};

export function makeSpend({ fee = 0, budgetUsd = null, rates = RESEARCH_RATES }: { fee?: number; budgetUsd?: number | null; rates?: ResearchRates } = {}): Spend {
  const s: Spend = {
    fee, budgetUsd, modelUsd: 0, researchUsd: 0, calls: 0, searches: 0, unreported: false,
    call(usage, model) {
      if (!usage || !("input_tokens" in usage || "prompt_tokens" in usage)) s.unreported = true;
      s.modelUsd += callUsd(usage, model, { fee }); s.calls++;
    },
    search({ query, contexts }) {
      // The search models report no tokens: estimated from the text (shared/credits.mjs estTokens).
      const q = estTokens(query);
      s.researchUsd += searchUsd({ embedTokens: q, vectorQueries: 1, rerankTokens: contexts.length ? contexts.reduce((n, c) => n + q + estTokens(c), 0) : 0 }, rates);
      s.searches++;
    },
    total: () => s.modelUsd + s.researchUsd,
    over: (share) => budgetUsd != null && s.total() >= budgetUsd * share,
    outputTokensLeft(model, reserveUsd) {
      if (budgetUsd == null) return Number.MAX_SAFE_INTEGER;
      const perToken = (model.output * (1 + fee)) / 1e6;
      return Math.max(0, Math.floor((budgetUsd - s.total() - reserveUsd) / perToken));
    },
    inputUsd(usage, model) {
      const u = (usage ?? {}) as Record<string, unknown>;
      // Preserve the provider's usage shape: adding completion_tokens to an
      // input_tokens response would select the wrong pricing branch and price input at zero.
      return callUsd(u.prompt_tokens != null || u.completion_tokens != null
        ? { ...u, completion_tokens: 0 } : { ...u, output_tokens: 0 }, model, { fee });
    },
  };
  return s;
}

/** No budget and no fee: for paths that are not charged (the bot's tests, the admins). */
export const freeSpend = () => makeSpend();
