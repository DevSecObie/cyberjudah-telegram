import data from "./ask-allowlist.json" with { type: "json" };
import { MODELS } from "./ask-models.mjs";

// A reviewed seed of the existing routes, not a claim that these models passed a live eval.
// Catalog refreshes never expand this list. Changes to it require their own review.
export const ALLOWLIST_MODELS = Object.freeze(data.models.map((m) => Object.freeze({ ...m })));
export const ALLOWLIST_IDS = Object.freeze(ALLOWLIST_MODELS.map((m) => m.id));
const allowed = new Set(ALLOWLIST_IDS);
const canonical = (id) => typeof id === "string" && id ? MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.native === id) : undefined;

/** An omitted or invalid setting observes only: reader behaviour stays unchanged. */
export const modelAllowlistMode = (env) => env.ASK_MODEL_ALLOWLIST_MODE === "off" ? "off" : env.ASK_MODEL_ALLOWLIST_MODE === "enforce" ? "enforce" : "shadow";
export const isAllowlistedModel = (id) => allowed.has(canonical(id)?.id);

/** Picker/routing views never log every candidate; log only a selected model below. */
export const allowlistedModels = (env, models) => modelAllowlistMode(env) === "enforce" ? models.filter((m) => allowed.has(m.id)) : models;

/** Admit the selected model before any consent, cache, budget or provider work. */
export function checkModelAllowlist(env, id) {
  const mode = modelAllowlistMode(env);
  if (mode === "off") return true;
  const model = canonical(id);
  const listed = allowed.has(model?.id);
  if (!listed && mode === "shadow") {
    // No question, response, account, trace, headers or raw unvalidated request input.
    console.log(JSON.stringify({ event: "ask_model_allowlist_miss", model: model?.id ?? null }));
  }
  return mode !== "enforce" || listed;
}

export const MODEL_NOT_ALLOWED = Object.freeze({ error: "model-not-allowed", message: "This model is not available for Ask. Choose a model from the list." });
