import capacities from "../../shared/model-capacities.json" with { type: "json" };
import { estTokens } from "../../shared/credits.mjs";

/** Published output limit, or the remaining published context when no separate maximum exists. */
export function modelOutputLimit(model, input) {
  const known = capacities.models[model.id];
  const max = model.maxOutput ?? known?.maxOutput ?? null;
  if (!known?.contextWindow) return max;
  // This estimates framing and text; the provider still enforces its own exact tokenizer limit.
  const remaining = Math.max(0, known.contextWindow - estTokens(JSON.stringify(input)) - 1024);
  return max === null ? remaining : Math.min(max, remaining);
}

/** Native capabilities: Opus 5.5's adaptive thinking is always on even in older catalogs. */
export function claudeThinking(model) {
  return {
    ...(model.thinking || model.native === "claude-opus-5-5" ? { thinking: { type: "adaptive" } } : {}),
    ...(model.effort ? { output_config: { effort: "high" } } : {}),
  };
}
