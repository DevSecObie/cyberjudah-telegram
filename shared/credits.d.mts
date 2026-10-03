import type { AskModel } from "./ask-models.mjs";

export const MC_USD: number;
export const MC_PER_USD: number;
export const LEGACY_UNIT_MC: number;
export function mcOfUsd(usd: number): number;
export function fmtUsd(mc: number, opts?: { floor?: boolean }): string;

export type ResearchRates = { embedUsdPerMtok: number; rerankUsdPerMtok: number; vectorUsdPerMdims: number; dims: number };
export const RESEARCH_RATES: ResearchRates;
export function starsFor(usd: number, usdPerStar: number): number;
export function mcOfStars(stars: number, usdPerStar: number, margin?: number): number;

export type Topup = { usd: number; stars: number; mc: number };
export type CreditConfig = {
  usdPerStar: number; margin: number;
  topups: Topup[];
  unifiedFee: number;
  confirmAboveMc: number; maxRequestMc: number;
  research: ResearchRates;
  missing: string[];
};
export function creditConfig(env?: Record<string, unknown>): CreditConfig;
export function missingPricing(cfg: Omit<CreditConfig, "missing">): string[];
export function viaUnifiedBilling(model: AskModel | null | undefined, claudeViaCloudflare?: boolean): boolean;
export function callUsd(u: object | null | undefined, model: AskModel | null | undefined, opts?: { fee?: number }): number;
export function estTokens(s: unknown): number;
export function searchUsd(s: { embedTokens?: number; vectorQueries?: number; rerankTokens?: number }, r?: ResearchRates): number;
export function estimateMc(model: AskModel, cfg: CreditConfig, opts?: { rounds?: number; claudeViaCloudflare?: boolean }): { typicalMc: number; maxMc: number };

export type LotLike = { id: number; kind: string; remaining_mc: number; expires_at: number | null; created_at: number };
export function spendOrder<T extends LotLike>(lots: T[], now?: number): T[];
export function allocate(lots: LotLike[], amount: number, now?: number): { take: { lot: number; mc: number }[]; short: number };
export function walletOf(lots: LotLike[], now?: number): { total_mc: number; lots: { kind: string; remaining_mc: number; expires_at: number | null }[] };
export function migrationLots(acct: { credits: number; plan_until: number; plan_allowance: number; plan_used: number } | null, now?: number): { kind: string; mc: number; expires_at: number | null; source: string; units: number }[];
