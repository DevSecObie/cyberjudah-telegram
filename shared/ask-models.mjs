/**
 * The models a reader can choose for Ask CyberJudah: every text model in Cloudflare's catalog that
 * Unified Billing serves, and every Cloudflare-hosted (Workers AI) one, as listed in
 * ask-models.json (built by bot/scripts/ask-models.mjs from Cloudflare's own catalog, with its
 * prices per million tokens). An answer is charged at the price of the model that wrote it, so a
 * cheaper model gives more answers for the same allowance or Stars.
 *
 * `format` says how the model is spoken to: "anthropic" (Claude, the Messages API, streamed),
 * "chat" (chat completions with tools), "responses" (OpenAI's Responses API with tools),
 * "messages" (the Messages format through Cloudflare), or "plain" (no tools: it answers from the
 * passages already found, without researching further).
 */
import data from "./ask-models.json" with { type: "json" };

// Routing policy stays beside the catalog, rather than in its generated prices. These are
// capability/latency choices, never price bands. New, unreviewed models stay balanced. The
// frontier order is Ask's preference for deep research, not a cross-provider benchmark claim.
export const FRONTIER_ORDER = [
  "anthropic/claude-fable-5.1", "anthropic/claude-fable-5", "openai/gpt-6-astra",
  "anthropic/claude-opus-5.5", "openai/gpt-5.6-sol", "openai/gpt-5.5-pro",
  "openai/gpt-5.5", "google/gemini-3.1-pro", "alibaba/qwen3.8-max",
  "moonshotai/kimi-k3", "xai/grok-4.7", "minimax/m3", "deepseek/deepseek-v4-pro",
  "anthropic/claude-opus-5", "openai/gpt-5.4-pro", "openai/gpt-5.4",
  "alibaba/qwen3.7-max", "xai/grok-4.6", "xai/grok-4.5",
  "anthropic/claude-opus-4.8", "anthropic/claude-opus-4.7", "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.5", "google/gemini-2.5-pro", "alibaba/qwen3-max",
  "@cf/zai-org/glm-5.3", "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/moonshotai/kimi-k2.7-code", "@cf/moonshotai/kimi-k2.6", "@cf/zai-org/glm-5.2",
];
const FRONTIER = new Set(FRONTIER_ORDER);
export const FAST = new Set([
  "anthropic/claude-haiku-4.5", "anthropic/claude-haiku-5.5",
  "google/gemini-2.5-flash-lite", "google/gemini-2.5-flash", "google/gemini-3-flash",
  "google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite", "google/gemini-3.5-flash",
  "openai/gpt-4.1-mini", "openai/gpt-4.1-nano", "openai/gpt-4o-mini",
  "openai/gpt-5-mini", "openai/gpt-5-nano", "openai/gpt-5.4-mini", "openai/gpt-5.4-nano",
  "openai/gpt-5.6-luna", "openai/gpt-6-luna", "openai/o3-mini", "openai/o4-mini",
  "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.2-1b-instruct",
  "@cf/meta/llama-3.2-3b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/zai-org/glm-5.3-flash",
  "@cf/openai/gpt-oss-20b", "@cf/ibm-granite/granite-4.0-h-micro",
  "@cf/qwen/qwen3-30b-a3b-fp8", "@cf/daily-co/phonellm-mini-alpha-2",
]);

export const MODELS = data.models.map((m) => ({
  ...m,
  tier: FRONTIER.has(m.id) ? "frontier" : FAST.has(m.id) ? "fast" : "balanced",
  // The catalog's format is also the backend's tool adapter: plain gets passages in one call.
  tools: m.format !== "plain",
}));

/**
 * Where each provider is based (its headquarters), shown when Ask asks the reader to agree to it,
 * so they know whose jurisdiction their question goes to. Kept here, not in ask-models.json,
 * because that file is rebuilt from Cloudflare's catalog. A provider whose home is not known
 * for certain is left out, and the card says nothing rather than guess.
 */
export const PROVIDER_COUNTRY = {
  Anthropic: "the United States",
  OpenAI: "the United States",
  Google: "the United States",
  xAI: "the United States",
  "Thinking Machines": "the United States",
  "Cloudflare (Workers AI)": "the United States",
  DeepSeek: "China",
  "Alibaba (Qwen)": "China",
  "Moonshot AI": "China",
  MiniMax: "China",
};
/** The country a provider is based in, or undefined when it is not known for certain. */
export const countryOf = (provider) => (Object.hasOwn(PROVIDER_COUNTRY, provider) ? PROVIDER_COUNTRY[provider] : undefined);

/** What a unit of the allowance is worth: a million units cost this many dollars (Claude Opus 5's input price). */
export const UNIT_USD_PER_M = 5;

const OPUS = MODELS.find((m) => m.id === "anthropic/claude-opus-5") ?? MODELS[0];

/** The chosen model (by Cloudflare id, or Claude's own id), or the setup's default when it is not one of these. */
export function modelOf(id, fallback = "claude-opus-5") {
  // Only a real id can match: an empty choice must not match the models that have no Claude id.
  const find = (x) => (typeof x === "string" && x ? MODELS.find((m) => m.id === x || m.native === x) : undefined);
  return find(id) ?? find(fallback) ?? OPUS;
}

/**
 * The units an answer's usage costs on its model: its price in dollars, in units of
 * UNIT_USD_PER_M per million. Each provider reports usage its own way:
 * - Claude: input_tokens (uncached), cache_creation_input_tokens, cache_read_input_tokens, output_tokens;
 * - chat completions: prompt_tokens (cached included, as prompt_tokens_details.cached_tokens), completion_tokens;
 * - Responses: input_tokens (cached included, as input_tokens_details.cached_tokens), output_tokens.
 */
export function unitsFor(u, model) {
  if (!u) return 0;
  const m = model ?? OPUS;
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
  const usd = (fresh * m.input + write * m.cacheWrite + read * m.cacheRead + out * m.output) / 1e6;
  return Math.round((usd * 1e6) / UNIT_USD_PER_M);
}

/**
 * Roughly how much an answer on this model costs next to one on Claude Opus 5, for the meter
 * only (an answer reads far more than it writes; charging uses the real usage).
 */
export const costFactor = (model) => {
  const m = model ?? OPUS;
  return (10 * m.input + m.output) / (10 * OPUS.input + OPUS.output);
};
