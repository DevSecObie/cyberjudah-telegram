import type { Env } from "./env";
import { APP_STUDY_RELEASE } from "./app-study-release";

/**
 * What an Ask answer was made with, so any answer can be traced to its prompts, its library and
 * its model (MDLC traceability, docs/ASK-PROMPT-CHANGELOG.md). Stamped on each answer's finished
 * line (`versions`), on its ask_events row, and in the answer cache key, so a change of prompt or
 * library never serves an answer kept from before it. Nothing here names a reader or a question.
 *
 * Each prompt has an id and the SHA-256 of its text. tests/ask-versions.test.mjs fails when a
 * prompt's text changes and its id does not: a prompt change bumps the id here (and its hash) and
 * adds a line to docs/ASK-PROMPT-CHANGELOG.md.
 */
export const PROMPT_IDS = {
  /** ai.mjs SYSTEM */
  system: { id: "system-v1", sha256: "24446ce22bd4444ca5ba349c27d3f9699a138ba3ce627bf5f7b7cd8b4f86e566" },
  /** ai.mjs RESEARCH */
  research: { id: "research-v1", sha256: "48f208930ff56c363ffd92633c9269d03e69cb7502f475c8cac532f00963eac2" },
  /** ai.mjs APP */
  app: { id: "app-v1", sha256: "897ce4ad195426598367a6659b492f8c1f2240de28c642b3e6a43c907ac41891" },
  /** grounding.mjs DATA_POLICY */
  dataPolicy: { id: "data-policy-v1", sha256: "6ca5e4fe506e90b546ea59b381e4cadfa342e40a39a52cf175f0819b8d2fcf8f" },
} as const;

/** Every prompt id, joined: the prompt version an answer names. */
export const PROMPT_VERSION = Object.values(PROMPT_IDS).map((p) => p.id).join(".");

/** The answer policy (docs/ASK-POLICY.md) the answers are checked against. */
export const ANSWER_POLICY = "policy-v1";

/** The prompt version for a surface: the study cards also name their own release (app-study-release.ts). */
export const promptVersion = (surface?: string) => surface === "study" ? `${PROMPT_VERSION}+${APP_STUDY_RELEASE.version}` : PROMPT_VERSION;

export type AnswerVersions = { prompt: string; policy: string; corpus: string; model: string };

/**
 * The library an answer searched: "<library>/<index>". The library is the search index file
 * scripts/load-search.mjs last loaded (its SHA-256, cut short); the index is the Vectorize build
 * scripts/embed.mjs last changed (its time). Both are written to D1 corpus_marks by those
 * scripts; either part is "-unknown" until its script has written one.
 */
export const UNKNOWN_CORPUS = "lib-unknown/idx-unknown";
const CORPUS_TTL_MS = 5 * 60_000;
const corpusCache = new WeakMap<object, { at: number; value: Promise<string> }>();

async function readCorpus(env: Pick<Env, "DB">): Promise<string> {
  try {
    const { results } = await env.DB.prepare("SELECT kind, id FROM corpus_marks WHERE kind IN ('library', 'index')").all<{ kind: string; id: string }>();
    const of = (kind: string) => results?.find((r) => r.kind === kind)?.id;
    const clean = (id: string | undefined, fallback: string) => (id && /^[a-z]{3}-[A-Za-z0-9-]{1,40}$/.test(id) ? id : fallback);
    return `${clean(of("library"), "lib-unknown")}/${clean(of("index"), "idx-unknown")}`;
  } catch {
    // No marks yet (the table is made by the first load or embed), or D1 is down: the answer still goes out.
    return UNKNOWN_CORPUS;
  }
}

/** The corpus release, read at most every five minutes per isolate. */
export function corpusRelease(env: Pick<Env, "DB">, now = Date.now()): Promise<string> {
  if (!env.DB || typeof env.DB !== "object") return Promise.resolve(UNKNOWN_CORPUS);
  const kept = corpusCache.get(env.DB);
  if (kept && now - kept.at < CORPUS_TTL_MS) return kept.value;
  const value = readCorpus(env);
  corpusCache.set(env.DB, { at: now, value });
  return value;
}

/** The versions an answer names on its finished line. */
export async function answerVersions(env: Pick<Env, "DB">, model: string, surface?: string): Promise<AnswerVersions> {
  return { prompt: promptVersion(surface), policy: ANSWER_POLICY, corpus: await corpusRelease(env), model };
}
