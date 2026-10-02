// Builds shared/ask-models.json, the models a reader can choose for Ask CyberJudah, from
// Cloudflare's own model catalog (cloudflare/cloudflare-docs): every third-party text-generation
// model that Unified Billing serves (src/content/catalog-models) and every Cloudflare-hosted
// Workers AI text model (src/content/workers-ai-models), with Cloudflare's prices.
//
//   node bot/scripts/ask-models.mjs <path to cloudflare-docs/src/content> <commit>
//
// Left out: models that are not for conversation (decision models, classifiers, safety
// filters), LoRA-only variants, and models Cloudflare publishes no price for (an answer could
// not be charged at cost).
import fs from "node:fs";
import path from "node:path";

const [dir, commit = ""] = process.argv.slice(2);
if (!dir) { console.error("usage: ask-models.mjs <catalog-models dir> [commit]"); process.exit(1); }

const PROVIDERS = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", deepseek: "DeepSeek", alibaba: "Alibaba (Qwen)", minimax: "MiniMax", moonshotai: "Moonshot AI", thinkingmachines: "Thinking Machines", unbiased: "Unbiased" };
// Claude models that take adaptive thinking, and those that take an effort level (Claude API docs, models overview).
const ADAPTIVE = new Set(["claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-sonnet-4-6", "claude-sonnet-5"]);
const EFFORT = new Set([...ADAPTIVE, "claude-opus-5-5", "claude-fable-5", "claude-fable-5-1"]);

/** The first price whose name matches, ignoring the long-context tiers (answers here are short). */
function price(p, re) {
  for (const [k, v] of Object.entries(p ?? {})) if (re.test(k) && !/>|long-context/i.test(k) && typeof v === "number") return v;
  return null;
}
const firstSentence = (s) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); const m = /^(.{20,160}?[.!?])(\s|$)/.exec(t); return m ? m[1] : t.slice(0, 160); };

const out = [];
const catalog = path.join(dir, "catalog-models"), hosted = path.join(dir, "workers-ai-models");
for (const f of fs.readdirSync(catalog).filter((x) => x.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(catalog, f), "utf8"));
  if (d.task !== "Text Generation" || String(d.model_id).startsWith("@cf")) continue;
  const formats = d.request_formats ?? [];
  const provider = d.provider_id ?? d.model_id.split("/")[0];
  const format = provider === "anthropic" ? "anthropic" : formats.includes("chat-completions") ? "chat" : formats.includes("responses") ? "responses" : formats.includes("anthropic-messages") ? "messages" : null;
  if (!format || (d.tags ?? []).includes("Classification")) continue;
  const input = price(d.pricing, /^(input|short-context input)/i), output = price(d.pricing, /^(output|short-context output)/i);
  if (input == null || output == null) continue;
  const native = provider === "anthropic" ? d.model_id.slice("anthropic/".length).replace(/\./g, "-") : undefined;
  out.push({
    id: d.model_id,
    name: d.name,
    provider: PROVIDERS[provider] ?? provider,
    what: firstSentence(d.description),
    format,
    ...(native ? { native, thinking: ADAPTIVE.has(native), effort: EFFORT.has(native) } : {}),
    input, output,
    cacheRead: price(d.pricing, /cached input/i) ?? input,
    cacheWrite: price(d.pricing, /cache (creation|write)/i) ?? input,
    maxOutput: d.max_output_tokens ?? null,
  });
}
// Cloudflare-hosted (Workers AI): "chat" when the model takes tools (function calling), so it can
// research like the others; "plain" otherwise, answering from the passages already found.
const NOT_CHAT = /\/(clef|clef-flash|llama-guard-[^/]*)$|-lora$/;
for (const f of fs.readdirSync(hosted).filter((x) => x.endsWith(".json")).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(hosted, f), "utf8"));
  const task = typeof d.task === "string" ? d.task : d.task?.name;
  if (task !== "Text Generation" || NOT_CHAT.test(d.name)) continue;
  const props = Object.fromEntries((d.properties ?? []).map((p) => [p.property_id, p.value]));
  const prices = Array.isArray(props.price) ? props.price : [];
  const per = (re) => prices.find((p) => re.test(p.unit))?.price ?? null;
  const input = per(/^per M input tokens$/), output = per(/^per M output tokens$/);
  if (input == null || output == null) continue;
  out.push({
    id: d.name,
    name: d.name.split("/").pop(),
    provider: "Cloudflare (Workers AI)",
    what: firstSentence(d.description),
    format: props.function_calling === "true" ? "chat" : "plain",
    input, output,
    cacheRead: per(/cached input/) ?? input,
    cacheWrite: input,
    maxOutput: null,
  });
}
const file = new URL("../../shared/ask-models.json", import.meta.url);
fs.writeFileSync(file, `${JSON.stringify({ source: "cloudflare/cloudflare-docs src/content/catalog-models", commit, models: out }, null, 1)}\n`);
console.log(`${out.length} models → shared/ask-models.json`);
