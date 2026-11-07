import type { AskModel } from "../../shared/ask-models.mjs";
export function modelOutputLimit(model: AskModel, input: unknown): number | null;
export function claudeThinking(model: AskModel): { thinking?: { type: "adaptive" }; output_config?: { effort: "high" } };
