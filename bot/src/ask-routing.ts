import type { Env } from "./env";
import { FRONTIER_ORDER, MODELS, type AskModel } from "../../shared/ask-models.mjs";
import { estimateMc } from "../../shared/credits.mjs";
import { creditsConfig, ownerOfUser, prepare, typicalMc, wallet } from "./credits";
import { hasClaude, unifiedBilling } from "./providers";

export type QuestionDepth = "quick" | "normal" | "deep";
// Keep the Mini App's route-model.ts classification rules, including study follow-ups.
const REF = /^\s*(?:[1-3]\s*)?[a-z]+\.?\s+\d+(?::\d+(?:[-–]\d+)?)?\s*\??\s*$/i;
const DEFINE = /^\s*(?:what(?:'s| is| does)?|define|meaning of)\s+(?:the\s+)?(?:word\s+)?["“]?[\p{L}'’-]+["”]?\s*(?:mean)?\s*\??\s*$/iu;
// Asking to read a passage ("read John 3:16", "what does John 8:32 say?") is a lookup, so quick;
// asking what it means is not.
const VERSE = String.raw`(?:[1-3]\s*)?[a-z]+\.?\s+\d+(?::\d+(?:[-–]\d+)?)?`;
const LOOKUP = new RegExp(String.raw`^\s*(?:(?:please\s+)?(?:read|show|quote|give|pull up|open)(?:\s+me)?\s+${VERSE}|what\s+(?:does|do)\s+${VERSE}\s+say)\s*[.?!]?\s*$`, "i");
const DEEP = /\b(why|how come|explain|compare|difference|contrast|prove|proof|history|historical|prophec\w*|fulfil\w*|identity|lineage|genealog\w*|timeline|trace|origin|in depth|deep(?:er|ly)?|study|break (?:it )?down|step by step|all the|every|whole|relationship|connect|significance|symbol|interpret|context|argue|debate|refute|evidence)\b/i;

/** `turns` counts earlier exchanges (a question and its answer), not messages. */
export function depthOf(q: string, turns = 0): QuestionDepth {
  const t = q.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (REF.test(t) || DEFINE.test(t) || LOOKUP.test(t)) return "quick";
  if (DEEP.test(t) || words > 28 || (t.match(/\?/g) ?? []).length > 1 || (turns >= 4 && words > 8)) return "deep";
  if (words <= 6 && !/\?$/.test(t) && turns === 0) return "quick";
  return "normal";
}

/** The same availability and prices for the account menu and server-side routing. */
export const askModels = (env: Env) => MODELS.filter((m) => m.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY);
export async function modelCosts(env: Env, models: AskModel[], free: Set<string>) {
  const cfg = creditsConfig(env);
  return Promise.all(models.map(async (m) => {
    const est = estimateMc(m, cfg, { claudeViaCloudflare: unifiedBilling(env) });
    return { id: m.id, name: m.name, provider: m.provider, what: m.what, tier: m.tier, tools: m.tools, typical_mc: (await typicalMc(env, m.id).catch(() => null)) ?? est.typicalMc, max_mc: est.maxMc, ...(free.has(m.id) ? { free: true } : {}) };
  }));
}

const TIERS = { frontier: 0, balanced: 1, fast: 2 };
function capability(a: AskModel, b: AskModel): number {
  return TIERS[a.tier] - TIERS[b.tier] || (a.tier === "frontier" ? FRONTIER_ORDER.indexOf(a.id) - FRONTIER_ORDER.indexOf(b.id) : 0);
}

/** Choose only; consent, holds, caps and quota admission still run on the resolved model. */
export async function autoModel(env: Env, q: string, turns: number, uid: number, byDefault: AskModel, free: Set<string>, unlimited: boolean): Promise<AskModel> {
  const depth = depthOf(q, turns);
  if (depth === "normal") return byDefault;
  const models = askModels(env);
  const freeChoices = models.filter((m) => free.has(m.id));
  if (depth === "quick") {
    const fast = freeChoices.filter((m) => m.tier === "fast");
    // Prefer a research adapter within the fast tier. If that menu is restricted, a plain fast
    // model can still answer from retrieved library passages, just as an explicit pick does.
    return fast.find((m) => m.id === byDefault.id && m.tools) ?? fast.find((m) => m.tools) ?? fast[0] ?? freeChoices[0] ?? byDefault;
  }
  const research = models.filter((m) => m.tools).sort(capability);
  const paid = research.filter((m) => !free.has(m.id));
  if (unlimited || env.ASK_BILLING !== "on") return paid[0] ?? research[0] ?? byDefault;
  const owner = await ownerOfUser(env, uid);
  // Match account preparation (migration, expiry and stale holds) before reading spendable funds.
  await prepare(env, owner, { uid });
  const balance = (await wallet(env, owner)).total_mc;
  const cfg = creditsConfig(env);
  for (const m of paid) {
    const typical = (await typicalMc(env, m.id).catch(() => null)) ?? estimateMc(m, cfg, { claudeViaCloudflare: unifiedBilling(env) }).typicalMc;
    if (balance >= typical) return m;
  }
  // No paid research fits: use the best free research adapter. A deployment with no free menu
  // retains its default and the ordinary meter will refuse insufficient funds before any AI call.
  return research.find((m) => free.has(m.id)) ?? freeChoices[0] ?? byDefault;
}
