export type AskModel = {
  id: string; name: string; provider: string; what: string;
  format: "anthropic" | "chat" | "responses" | "messages" | "plain";
  native?: string; thinking?: boolean; effort?: boolean;
  input: number; output: number; cacheRead: number; cacheWrite: number; maxOutput: number | null;
};
export const MODELS: AskModel[];
export const UNIT_USD_PER_M: number;
export function modelOf(id: unknown, fallback?: string): AskModel;
export function unitsFor(u: object | null | undefined, model?: AskModel): number;
export function costFactor(model?: AskModel): number;
export const PROVIDER_COUNTRY: Record<string, string>;
export function countryOf(provider: string): string | undefined;
