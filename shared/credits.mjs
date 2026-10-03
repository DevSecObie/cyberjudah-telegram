// Ask CyberJudah's pay-as-you-go balance: the pure part, shared by the Worker, the app and the tests.
//
// The balance is money, shown in US dollars the way an AI API shows it ("$4.82 left", "$0.05" an
// answer). Readers pay exactly what their answers cost to run, at each model's own price (with
// Cloudflare's Unified Billing fee where it applies) and the library searches at Cloudflare's
// rates: CyberJudah makes no profit, so there is no margin and no plan.
//
// Amounts are kept as integers in millionths of a dollar (`mc`, 1 = US$0.000001; a thousand of
// them were once called a credit), so the smallest request is charged exactly and nothing is
// lost to rounding. Only the app turns them into dollars, and only to show them.

/** One unit of the balance in US dollars. */
export const MC_USD = 0.000001;
/** Units in a dollar. */
export const MC_PER_USD = 1_000_000;
/** The old allowance unit (shared/ask-models.mjs UNIT_USD_PER_M = 5: a million units cost $5) in balance units: exactly 5. */
export const LEGACY_UNIT_MC = 5;

/** Balance units for a cost in US dollars, rounded up to the next unit (never charged less than it cost). */
export const mcOfUsd = (usd) => (usd > 0 ? Math.ceil(usd * MC_PER_USD - 1e-6) : 0);

/**
 * An amount as dollars. What an answer cost rounds to the nearest cent; a balance (`floor`) is
 * cut to the cent below, so it never shows more than is there. Anything above nothing that would
 * show as $0.00 shows as "<$0.01".
 */
export function fmtUsd(mc, { floor = false } = {}) {
  const v = Math.max(0, Math.round(mc ?? 0));
  if (!v) return "$0.00";
  const cents = floor ? Math.floor(v / 10_000 + 1e-9) : Math.round(v / 10_000);
  if (cents < 1) return "<$0.01";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? n : d; };

/**
 * Cloudflare's published rates for the library searches Ask runs while it researches
 * (cloudflare/cloudflare-docs at b8765861: workers-ai-models/bge-m3.json, bge-reranker-base.json,
 * partials/vectorize/vectorize-pricing.mdx). Overridable, as the models' prices are, when they change.
 */
export const RESEARCH_RATES = { embedUsdPerMtok: 0.0118, rerankUsdPerMtok: 0.00311, vectorUsdPerMdims: 0.01, dims: 1024 };

/** Stars needed for a top-up of this many dollars: enough that what the owner receives covers it. */
export const starsFor = (usd, usdPerStar) => (usdPerStar > 0 ? Math.ceil(usd / usdPerStar - 1e-9) : 0);
/** What a payment of this many Stars puts in the balance: what the owner actually receives for them, at cost. */
export const mcOfStars = (stars, usdPerStar, margin = 1) => Math.floor((stars * usdPerStar * MC_PER_USD) / Math.max(1, margin) + 1e-6);

/**
 * Everything priced, from the Worker's settings (wrangler.jsonc), in one place:
 * - ASK_USD_PER_STAR: what one Star brings the owner after Telegram's share (the payout, not what
 *   the reader pays Telegram for a Star). A top-up of $N costs ceil(N / this) Stars, and a payment
 *   of S Stars adds S × this to the balance. Without it nothing is sold.
 * - ASK_MARGIN: 1, at cost. Kept as a setting only so that it can be read and checked; below 1 is
 *   taken as 1 (a reader is never given less than what was received).
 * - ASK_TOPUPS_USD: the top-ups on sale, in dollars ("1,5,20").
 * - ASK_UNIFIED_BILLING_FEE: Cloudflare's fee on Unified Billing credits (0.05), for models paid that way.
 * - ASK_CONFIRM_ABOVE_USD: a request whose most it can cost is above this asks first.
 * - ASK_MAX_REQUEST_USD: the most one request may cost, whatever the model.
 * - ASK_EMBED_USD_PER_MTOK, ASK_RERANK_USD_PER_MTOK, ASK_VECTOR_USD_PER_MDIMS: the search rates.
 */
export function creditConfig(env = {}) {
  const usdPerStar = num(env.ASK_USD_PER_STAR, 0);
  const margin = Math.max(1, num(env.ASK_MARGIN, 1));
  const topupUsd = String(env.ASK_TOPUPS_USD ?? "1,5,20").split(",").map((s) => num(s.trim(), 0)).filter((x) => x > 0);
  const cfg = {
    usdPerStar, margin,
    topups: topupUsd.map((usd) => { const stars = starsFor(usd, usdPerStar); return { usd, stars, mc: mcOfStars(stars, usdPerStar, margin) }; }),
    unifiedFee: num(env.ASK_UNIFIED_BILLING_FEE, 0.05),
    confirmAboveMc: mcOfUsd(num(env.ASK_CONFIRM_ABOVE_USD, 0.25)),
    maxRequestMc: mcOfUsd(num(env.ASK_MAX_REQUEST_USD, 1.5)),
    research: {
      embedUsdPerMtok: num(env.ASK_EMBED_USD_PER_MTOK, RESEARCH_RATES.embedUsdPerMtok),
      rerankUsdPerMtok: num(env.ASK_RERANK_USD_PER_MTOK, RESEARCH_RATES.rerankUsdPerMtok),
      vectorUsdPerMdims: num(env.ASK_VECTOR_USD_PER_MDIMS, RESEARCH_RATES.vectorUsdPerMdims),
      dims: RESEARCH_RATES.dims,
    },
  };
  return { ...cfg, missing: missingPricing(cfg) };
}

/** What stops top-ups from going on sale, said exactly: an empty list means they may be sold. */
export function missingPricing(cfg) {
  const out = [];
  if (!(cfg.usdPerStar > 0)) out.push("ASK_USD_PER_STAR: the US dollars one Star pays out to the bot after Telegram's share (not the price a reader pays for a Star).");
  if (!cfg.topups.length) out.push("ASK_TOPUPS_USD: the top-ups on sale, in dollars (for example \"1,5,20\").");
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
 * The most a request on this model may cost, and a typical cost: the research rounds (each
 * reading the conversation so far and writing a little) and the answer. The agent keeps to the
 * most it was allowed (agent.ts budget), so this is a real cap, not a guess.
 */
export function estimateMc(model, cfg, { rounds = 6, claudeViaCloudflare = true } = {}) {
  const fee = viaUnifiedBilling(model, claudeViaCloudflare) ? cfg.unifiedFee : 0;
  const p = (inp, out) => callUsd({ input_tokens: inp, output_tokens: out }, model, { fee });
  const typicalUsd = p(30000, 2500) + 2 * searchUsd({ embedTokens: 40, vectorQueries: 1, rerankTokens: 12000 }, cfg.research);
  const maxUsd = (rounds - 1) * p(22000, 1200) + p(26000, 6000) + rounds * searchUsd({ embedTokens: 60, vectorQueries: 1, rerankTokens: 16000 }, cfg.research);
  return { typicalMc: mcOfUsd(typicalUsd), maxMc: Math.min(cfg.maxRequestMc, mcOfUsd(maxUsd)) };
}

/**
 * Which part of the balance goes first: anything that expires, soonest first, then the rest,
 * oldest first. Top-ups never expire; the order matters only for the old allowance carried over.
 */
export function spendOrder(lots, now = Date.now()) {
  return lots
    .filter((l) => l.remaining_mc > 0 && (l.expires_at == null || l.expires_at > now))
    .sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity) || a.created_at - b.created_at || a.id - b.id);
}

/** Take `amount` from the lots in spend order: what each lot gives, and what could not be found. */
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

/** The balance: its total, and the lots it is made of in the order they are spent. */
export function walletOf(lots, now = Date.now()) {
  const live = spendOrder(lots, now);
  return {
    total_mc: live.reduce((s, l) => s + l.remaining_mc, 0),
    lots: live.map((l) => ({ kind: l.kind, remaining_mc: l.remaining_mc, expires_at: l.expires_at ?? null })),
  };
}

/**
 * The fair carry-over of the old allowance, which was already measured in what Ask cost: a unit
 * was US$0.000005 (a million units cost $5), so a unit is exactly 5 balance units and nothing is
 * rounded away. Top-up credit carries over in full; what was left of a monthly plan's allowance
 * carries over too, and no longer expires, since there is no plan any more. Today's free
 * allowance is not carried: it was free.
 */
export function migrationLots(acct, now = Date.now()) {
  if (!acct) return [];
  const out = [];
  if (acct.credits > 0) out.push({ kind: "carried", mc: acct.credits * LEGACY_UNIT_MC, expires_at: null, source: "migrate:v1:topup", units: acct.credits });
  const left = (acct.plan_allowance ?? 0) - (acct.plan_used ?? 0);
  if (acct.plan_until > now && left > 0) out.push({ kind: "carried", mc: left * LEGACY_UNIT_MC, expires_at: null, source: "migrate:v1:plan", units: left });
  return out;
}
