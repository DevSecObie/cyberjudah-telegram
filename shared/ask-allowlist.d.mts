import type { AskModel } from "./ask-models.mjs";
type Settings = { ASK_MODEL_ALLOWLIST_MODE?: string };
export const ALLOWLIST_IDS: readonly string[];
export const ALLOWLIST_MODELS: readonly Readonly<{ id: string; idKind: "moving-alias" | "pinned-snapshot" }>[];
export const MODEL_NOT_ALLOWED: Readonly<{ error: "model-not-allowed"; message: string }>;
export function modelAllowlistMode(env: Settings): "off" | "shadow" | "enforce";
export function isAllowlistedModel(id: unknown): boolean;
export function allowlistedModels<T extends AskModel>(env: Settings, models: T[]): T[];
export function checkModelAllowlist(env: Settings, id: unknown): boolean;
