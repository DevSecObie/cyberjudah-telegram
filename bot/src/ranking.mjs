/**
 * Ask's ranking, version 2 (RAG Phase 2, docs/ASK-RANKING.md). Behind ASK_RANKING=v2; off by default,
 * so today's ranking (v1) stands until the owner's numbers say otherwise. Everything here is
 * arithmetic on the library's own passages: no model call, and no text is written.
 *
 * 1. Fusion: the passages found by meaning (dense) and by words (keyword, bm25) are fused by
 *    reciprocal rank fusion (Cormack, Clarke & Büttcher, SIGIR 2009), not concatenated with
 *    scores on different scales.
 * 2. The reranker's scores are kept and used: answerCandidates sorts on them (plus the small lifts).
 * 3. The reranker reads each passage's start and the sentences that match the question, not a
 *    blind cut of its first 2,000 characters.
 * 4. Diversity: at most a few passages from one recording or note in the final selection.
 * 5. A question with several parts ("…and…?", "…? …?") is searched part by part as well as whole,
 *    and the lists fused, with no model call.
 */

/** The switch: "v2" turns this ranking on; anything else keeps v1. */
export const rankingV2 = (env) => String(env?.ASK_RANKING ?? "").trim().toLowerCase() === "v2";

/** RRF's constant: 60 is the value from the paper and the common default (Cloudflare AI Search too). */
export const RRF_K = 60;
/** Dense candidates: Vectorize returns full metadata for at most 50. */
export const DENSE_TOP_K = 50;
/** Keyword candidates, by bm25 across all kinds (not three per kind). */
export const KEYWORD_POOL = 50;
/** The most passages the reranker reads per search; set where the Phase 1 recorded curve flattens. */
export const RERANK_POOL = 60;
/** At most this many passages from one recording or one note page in the final selection. */
export const PER_SOURCE = 2;
/** At most this many parts of a question are searched on their own. */
export const MAX_PARTS = 3;
/**
 * The Bishops' and Deacons' small lift (ASK-POLICY A6: a lift a better topic match can outweigh),
 * on the reranker's 0-1 scale. Owner decision D6: keep the intent, set the strength from the
 * Phase 1 recorded set. These are placeholders until those numbers are in (docs/ASK-RANKING.md).
 */
export const TEACHER_LIFT = { bishop: 0.06, deacon: 0.04 };
/** The word-overlap lift per matched question word (at most three), on the reranker's scale. */
export const OVERLAP_LIFT = 0.08;

/**
 * A passage ranked by v2 carries its reranker score here (null when the reranker failed and the
 * fused order stands). A symbol, like grounding's provenance: never in JSON sent to a reader.
 */
export const RANKED = Symbol("ask-ranking-v2");
export const markRanked = (p, rerank) => Object.assign(p, { [RANKED]: { rerank: typeof rerank === "number" && Number.isFinite(rerank) ? rerank : null } });

/** One key per passage, the same one retrieval de-duplicates with. */
export const passageKey = (p) => `${p.kind}|${p.url}|${p.sub ?? ""}`;

/**
 * Reciprocal rank fusion of ranked lists: each passage scores the sum of 1/(k + rank) over the
 * lists it is in. The first copy of a passage is kept (the object itself, unchanged) with its fused
 * score beside it. Ties keep the order in which passages were first seen.
 */
export function rrf(lists, k = RRF_K) {
  const byKey = new Map();
  let seen = 0;
  for (const list of lists) {
    list.forEach((p, i) => {
      const key = passageKey(p);
      const hit = byKey.get(key) ?? { p, fused: 0, first: seen++ };
      hit.fused += 1 / (k + i + 1);
      byKey.set(key, hit);
    });
  }
  return [...byKey.values()].sort((a, b) => b.fused - a.fused || a.first - b.first).map(({ p, fused }) => ({ p, fused }));
}

const WORD = /[a-z0-9']+/g;
const STOP = new Set(["about", "after", "again", "also", "because", "before", "being", "does", "from", "have", "into", "keep", "that", "their", "them", "then", "there", "these", "they", "this", "what", "when", "where", "which", "with", "would", "your", "who", "why", "how", "the", "and", "was", "were", "are", "did"]);
const contentWords = (text) => (String(text).toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * The parts of a question worth searching on their own: separate questions ("…? …?") and clauses
 * joined by "and also", "; also" or ", and". A part needs two words of its own that say something;
 * "bread and wine" is never split. The whole question is not among the parts (it is searched anyway).
 */
export function questionParts(question) {
  const text = String(question ?? "").replace(/\s+/g, " ").trim();
  const pieces = text
    .split(/\?\s*(?=\S)|\s*;\s*(?:and\s+)?also\s+|\s+and\s+also\s+|,\s+and\s+(?=(?:who|what|when|where|why|how|which|is|are|was|were|did|does|do)\b)/i)
    .map((s) => s.replace(/^(?:and|also)\s+/i, "").replace(/[?.!\s]+$/, "").trim())
    .filter((s) => contentWords(s).length >= 2);
  return pieces.length > 1 ? pieces.slice(0, MAX_PARTS) : [];
}

/**
 * What the reranker reads of a passage: its title, its date when known, its start, and then the
 * sentences that share a word with the question, up to `max` characters. A long note's matching
 * paragraph is read even when it is past the start.
 */
export function rerankText(question, p, max = 2000, start = 600) {
  const head = [p.title, p.date].filter(Boolean).join(" · ");
  const text = String(p.text ?? "");
  if (`${head}\n${text}`.length <= max) return `${head}\n${text}`;
  const terms = new Set(contentWords(question));
  const opening = text.slice(0, start);
  const rest = text.slice(start).split(/(?<=[.!?])\s+/);
  const matched = rest.filter((s) => contentWords(s).some((w) => terms.has(w)));
  return `${head}\n${opening}${matched.length ? ` … ${matched.join(" … ")}` : ""}`.slice(0, max);
}

/** Where a passage comes from, for the per-source cap: its recording, or its page. */
export const sourceOf = (p) => (p.video ? `video:${p.video}` : `${p.kind}|${p.url}`);

/** The passages in order, with at most `n` from any one recording or page. */
export function capPerSource(passages, n = PER_SOURCE) {
  const count = new Map();
  return passages.filter((p) => {
    const key = sourceOf(p);
    const c = count.get(key) ?? 0;
    if (c >= n) return false;
    count.set(key, c + 1);
    return true;
  });
}

/** The teacher lift for a passage (A6). */
export const teacherLift = (teacher) => (/^bishop\b/i.test(teacher ?? "") ? TEACHER_LIFT.bishop : /^deacon\b/i.test(teacher ?? "") ? TEACHER_LIFT.deacon : 0);

/**
 * A rerank score bucket for the numbers-only telemetry: never a passage, a question or a score
 * precise enough to identify one.
 */
export const scoreBucket = (score) => (typeof score !== "number" || !Number.isFinite(score) ? "none" : score >= 0.8 ? "0.8+" : score >= 0.5 ? "0.5-0.8" : score >= 0.2 ? "0.2-0.5" : "<0.2");
