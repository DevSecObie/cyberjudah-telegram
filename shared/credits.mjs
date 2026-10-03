// Ask CyberJudah's credits: the pure part, shared by the Worker, the app and the tests.
//
// A credit is a fixed amount of what Ask costs to run: 1 credit = US$0.001 of AI cost, as
// Cloudflare bills it (the model's published per-token price, Cloudflare's Unified Billing fee
// where it applies, and the library searches). That definition never changes with the model: a
// dearer model uses more credits for the same work, a cheaper one fewer, and a balance keeps its
// worth whichever model is chosen. The margin is taken once, where Stars become credits; it never
// touches a balance already held or the credits a request uses.
//
// Amounts are kept in millicredits (1 credit = 1,000 mc = US$0.000001 each), integers, so the
// smallest request is charged exactly and nothing is lost to rounding.

export const CREDIT_USD = 0.001;
export const MC = 1000;
/** The old allowance unit (shared/ask-models.mjs UNIT_USD_PER_M = 5: a million units cost $5) in millicredits: exactly 5. */
export const LEGACY_UNIT_MC = 5;

/** Millicredits for a cost in US dollars, rounded up to the next millicredit (never charged less than it cost). */
export const mcOfUsd = (usd) => (usd > 0 ? Math.ceil(usd / CREDIT_USD * MC - 1e-9) : 0);
/** Credits as shown: one decimal below 100, whole above (12.4 · 1,950). */
export function fmtCredits(mc) {
  const c = Math.max(0, mc) / MC;
  if (c > 0 && c < 0.1) return "<0.1";
  return c < 100 ? (Math.round(c * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 }) : Math.round(c).toLocaleString("en-US");
}

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d; };

/**
 * Cloudflare's published rates for the library searches Ask runs while it researches
 * (cloudflare/cloudflare-docs at b8765861: workers-ai-models/bge-m3.json, bge-reranker-base.json,
 * partials/vectorize/vectorize-pricing.mdx). Overridable, as the models' prices are, when they change.
 */
export const RESEARCH_RATES = { embedUsdPerMtok: 0.0118, rerankUsdPerMtok: 0.00311, vectorUsdPerMdims: 0.01, dims: 1024 };

/**
 * Everything priced, from the Worker's settings (wrangler.jsonc), in one place:
 * - ASK_USD_PER_STAR: what one Star brings in after Telegram's share (the payout, not what the
 *   reader pays for a Star). Required: without it nothing is sold.
 * - ASK_MARGIN: over cost, where Stars become credits (1 = at cost).
 * - ASK_PLAN_BONUS: the monthly plan's extra credits over the same Stars in top-ups (0.2 = 20%).
 * - ASK_PLAN_STARS, ASK_PACKS: the Stars prices on sale (750; 150, 500, 1500).
 * - ASK_FREE_DAILY_CREDITS: free credits a day for a Telegram reader; ASK_BROWSER_DAILY_CREDITS for a browser.
 * - ASK_UNIFIED_BILLING_FEE: Cloudflare's fee on Unified Billing credits (0.05), for models paid that way.
 * - ASK_CONFIRM_ABOVE_CREDITS: a request whose most it can cost is above this asks first.
 * - ASK_MAX_REQUEST_CREDITS: the most one request may cost, whatever the model.
 * - ASK_EMBED_USD_PER_MTOK, ASK_RERANK_USD_PER_MTOK, ASK_VECTOR_USD_PER_MDIMS: the search rates.
 * - ASK_PRICING_CONFIRMED=yes: the owner has checked the payout and the margin; until then no new
 *   plan or top-up is sold (renewals of existing subscriptions are still honoured).
 */
export function creditConfig(env = {}) {
  const usdPerStar = num(env.ASK_USD_PER_STAR, 0);
  const margin = Math.max(0.01, num(env.ASK_MARGIN, 1));
  const planBonus = num(env.ASK_PLAN_BONUS, 0.2);
  const creditsPerStar = usdPerStar / CREDIT_USD / margin;
  const planStars = Math.round(num(env.ASK_PLAN_STARS, 750));
  const packStars = String(env.ASK_PACKS ?? "150,500,1500").split(",").map((s) => Math.round(num(s.trim(), 0))).filter(Boolean);
  const toMc = (credits) => Math.floor(credits + 1e-6) * MC;
  const cfg = {
    usdPerStar, margin, planBonus, creditsPerStar,
    plan: { stars: planStars, mc: toMc(planStars * creditsPerStar * (1 + planBonus)) },
    packs: packStars.map((stars) => ({ stars, mc: toMc(stars * creditsPerStar) })),
    freeDailyMc: Math.round(num(env.ASK_FREE_DAILY_CREDITS, 600) * MC),
    browserDailyMc: Math.round(num(env.ASK_BROWSER_DAILY_CREDITS, 100) * MC),
    unifiedFee: num(env.ASK_UNIFIED_BILLING_FEE, 0.05),
    confirmAboveMc: Math.round(num(env.ASK_CONFIRM_ABOVE_CREDITS, 250) * MC),
    maxRequestMc: Math.round(num(env.ASK_MAX_REQUEST_CREDITS, 1500) * MC),
    research: {
      embedUsdPerMtok: num(env.ASK_EMBED_USD_PER_MTOK, RESEARCH_RATES.embedUsdPerMtok),
      rerankUsdPerMtok: num(env.ASK_RERANK_USD_PER_MTOK, RESEARCH_RATES.rerankUsdPerMtok),
      vectorUsdPerMdims: num(env.ASK_VECTOR_USD_PER_MDIMS, RESEARCH_RATES.vectorUsdPerMdims),
      dims: RESEARCH_RATES.dims,
    },
    confirmed: env.ASK_PRICING_CONFIRMED === "yes",
  };
  return { ...cfg, missing: missingPricing(cfg) };
}

/**
 * What stops new pricing from going on sale, said exactly: an empty list means it is safe.
 * The models' and searches' prices come from Cloudflare's catalog; what only the owner knows is
 * what a Star pays out, and that the margin covers the plan's bonus.
 */
export function missingPricing(cfg) {
  const out = [];
  if (!(cfg.usdPerStar > 0)) out.push("ASK_USD_PER_STAR: the US dollars one Star pays out to the bot after Telegram's share (not the price a reader pays for a Star).");
  if (cfg.margin < 1 + cfg.planBonus) out.push(`ASK_MARGIN (${cfg.margin}) is below 1 + ASK_PLAN_BONUS (${1 + cfg.planBonus}): the monthly plan would be sold below cost. Raise the margin to at least ${(1 + cfg.planBonus).toFixed(2)} or lower the bonus.`);
  if (!cfg.confirmed) out.push("ASK_PRICING_CONFIRMED is not \"yes\": the owner has not yet confirmed ASK_USD_PER_STAR and ASK_MARGIN against the Stars payout and the Cloudflare invoice.");
  return out;
}

/** Whether a model is paid through Cloudflare's Unified Billing (third-party models through the AI Gateway), which carries its fee. Workers AI models do not. */
export const viaUnifiedBilling = (model, claudeViaCloudflare = true) =>
  !!model && !String(model.id ?? "").startsWith("@cf/") && (model.format !== "anthropic" || claudeViaCloudflare);

/**
 * What one model call cost, in US dollars, from the usage it reported. Each provider reports
 * usage its own way (shared/ask-models.mjs unitsFor), and the price is the model's own.
 */
export function callUsd(u, model, { fee = 0 } = {}) {
  if (!u || !model) return 0;
  let fresh = 0, write = 0, read = 0, out = 0;
  if (u.prompt_tokens != null || u.completion_tokens != null) {
    read = u.prompt_tokens_details?.cached_tokens ?? 0;
    fresh = Math.max(0, (u.prompt_tokens ?? 0) - read);
    out = u.completion_tokens ?? 0;
  } else if (u.input_tokens_details) {
    read = u.input_tokens_details.cached_tokens ?? 0;
    fresh = Math.max(0, (u.input_tokens ?? 0) - read);
    out = u.output_tokens ?? 0;
  } else {
    fresh = u.input_tokens ?? 0; write = u.cache_creation_input_tokens ?? 0; read = u.cache_read_input_tokens ?? 0; out = u.output_tokens ?? 0;
  }
  const usd = (fresh * model.input + write * (model.cacheWrite ?? model.input) + read * (model.cacheRead ?? model.input) + out * model.output) / 1e6;
  return usd * (1 + fee);
}

/** Tokens of a text for the search models, which report none: one per three characters, rounded up (a little above the usual four, so a search is never undercharged). */
export const estTokens = (s) => Math.ceil(String(s ?? "").length / 3);

/** What one library search cost: the question embedded, one vector query, and the reranking of what came back. */
export function searchUsd({ embedTokens = 0, vectorQueries = 0, rerankTokens = 0 }, r = RESEARCH_RATES) {
  return (embedTokens * r.embedUsdPerMtok + rerankTokens * r.rerankUsdPerMtok) / 1e6 + (vectorQueries * r.dims * r.vectorUsdPerMdims) / 1e6;
}

/**
 * The most a request on this model may cost, and a typical cost, in millicredits: the research
 * rounds (each reading the conversation so far and writing a little) and the answer. The agent
 * keeps to the most it was allowed (agent.ts budget), so this is a real cap, not a guess.
 */
export function estimateMc(model, cfg, { rounds = 6, claudeViaCloudflare = true } = {}) {
  const fee = viaUnifiedBilling(model, claudeViaCloudflare) ? cfg.unifiedFee : 0;
  const p = (inp, out) => callUsd({ input_tokens: inp, output_tokens: out }, model, { fee });
  const typicalUsd = p(30000, 2500) + 2 * searchUsd({ embedTokens: 40, vectorQueries: 1, rerankTokens: 12000 }, cfg.research);
  const maxUsd = (rounds - 1) * p(22000, 1200) + p(26000, 6000) + rounds * searchUsd({ embedTokens: 60, vectorQueries: 1, rerankTokens: 16000 }, cfg.research);
  return { typicalMc: mcOfUsd(typicalUsd), maxMc: Math.min(cfg.maxRequestMc, mcOfUsd(maxUsd)) };
}

/**
 * Which credits go first: those that expire soonest. Today's free credits (they end at midnight
 * UTC), then the month's plan credits (they end at the renewal date), then top-ups and anything
 * that never expires, oldest first.
 */
export function spendOrder(lots, now = Date.now()) {
  return lots
    .filter((l) => l.remaining_mc > 0 && (l.expires_at == null || l.expires_at > now))
    .sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity) || a.created_at - b.created_at || a.id - b.id);
}

/** Take `amount` millicredits from the lots in spend order: what each lot gives, and what could not be found. */
export function allocate(lots, amount, now = Date.now()) {
  let left = Math.max(0, Math.round(amount));
  const take = [];
  for (const l of spendOrder(lots, now)) {
    if (!left) break;
    const n = Math.min(left, l.remaining_mc);
    take.push({ lot: l.id, mc: n });
    left -= n;
  }
  return { take, short: left };
}

/** The balance by kind, the order it is spent in, and the next expiry. */
export function walletOf(lots, now = Date.now()) {
  const live = spendOrder(lots, now);
  const by = (k) => live.filter((l) => l.kind === k).reduce((s, l) => s + l.remaining_mc, 0);
  const total = live.reduce((s, l) => s + l.remaining_mc, 0);
  return {
    total_mc: total,
    free_mc: by("daily"),
    plan_mc: by("plan"),
    topup_mc: live.filter((l) => l.kind !== "daily" && l.kind !== "plan").reduce((s, l) => s + l.remaining_mc, 0),
    lots: live.map((l) => ({ kind: l.kind, remaining_mc: l.remaining_mc, expires_at: l.expires_at ?? null })),
  };
}

/** The end of this UTC day: when today's free credits expire. */
export const endOfDay = (now = Date.now()) => { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
export const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/**
 * The fair conversion of the old allowance, which was already measured in what Ask cost: a unit
 * was US$0.000005 (a million units cost $5), so a unit is exactly 5 millicredits and nothing is
 * rounded away. Top-up credit never expired and still does not; the month's plan allowance left
 * keeps its end date. Today's free use is not carried over: today's free credits are granted afresh.
 */
export function migrationLots(acct, now = Date.now()) {
  if (!acct) return [];
  const out = [];
  if (acct.credits > 0) out.push({ kind: "topup", mc: acct.credits * LEGACY_UNIT_MC, expires_at: null, source: "migrate:v1:topup", units: acct.credits });
  const left = (acct.plan_allowance ?? 0) - (acct.plan_used ?? 0);
  if (acct.plan_until > now && left > 0) out.push({ kind: "plan", mc: left * LEGACY_UNIT_MC, expires_at: acct.plan_until, source: "migrate:v1:plan", units: left });
  return out;
}
