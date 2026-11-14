# Plan: SMART-RAG passage selection for Ask (draft)

Status: **plan only, no code.** Owner request: "the ai should use SMART-RAG". The owner's gate:
it ships only if it beats the current top-k selection on the evals, with no metric worse
(the same rule as #612). Workers AI only (D8). Backend code: t1s. Merges and deploys: obie-e3.

Source: Li, Hu and Wan, *SMART-RAG: Selection using Determinantal Matrices for Augmented
Retrieval*, [arXiv:2409.13992](https://arxiv.org/abs/2409.13992).

## What the paper does

The paper keeps its retriever and changes only which passages reach the prompt. Instead of
the k most relevant, it picks a set of k with a determinantal point process (DPP). A DPP
prefers sets that are relevant and not repetitive.

- Kernel: `L = Diag(q) · K · Diag(q)`, with `K = S ∘ exp(−γ(1 − C))`.
  - `q`: each passage's relevance to the question (cosine to the query embedding).
  - `S`: passage-to-passage cosine similarity, which is the diversity term.
  - `C`: a symmetric contradiction score between two passages from an NLI model. `γ` sets how
    much it counts.
- Selection: greedy MAP. Add the passage with the largest gain in `log det(L_Y)` until k are
  chosen. `β` trades relevance against diversity.
- Setup: Contriever top 50, then BGE pre-ranks to 30, then SMART picks 5. Embeddings are
  bge-large-en-v1.5, NLI is DeBERTa-v3, and the generator is Llama 3 8B.
- Results: it beats BGE relevance-only selection on NQ, TriviaQA, HotpotQA, FEVER and FM2. The
  largest gains are on multi-hop (HotpotQA +2.0 F1) and fact checking (FEVER +2.4). Removing
  the conflict term costs FEVER 1.2 and FM2 1.3. These are one generator and 500 questions per
  set; the paper's tables and text disagree on some ablations and on the best `β`.

## Ask today (main 222aeba3)

`retrieve()` in `bot/src/ai.ts`:

1. Gathers the 20 nearest bge-m3 vectors (Vectorize) and the top 3 keyword hits (D1).
2. Drops caption scraps under 20 words and dedupes one caption window per 90 s (`dedupeMatches`).
3. bge-reranker-base orders all of them and keeps `topK` (12; 10 in the agent's search tool).
4. `answerCandidates()` in `ai.mjs` re-sorts by `score + word overlap + Bishop/Deacon lift` and
   keeps 8 (6 in the tool) for the prompt.

Observations that matter for the plan:

- The reranker's score is not kept. `p.score` is still the vector cosine, or 0.5 for a keyword
  hit, so step 4 sorts on the vector score, not on the reranker.
- Nothing stops several near-identical passages from filling the 8. One class repeated in
  several caption windows, or a note and its own transcript, can crowd out another class that
  answers the same question from another angle.

## Proposal

Phase 1 is relevance plus diversity, with no conflict term. A new pure function `selectPassages`
in `ai.mjs` replaces the top-k cut, behind a setting `ASK_SELECTION` = `topk` (the default) or
`dpp`.

- **Relevance `q`:** the reranker's own score, which step 3 already pays for. The reranker is
  asked for every candidate (about 23) instead of `top_k`, and its score is kept on the passage.
- **Similarity `S`:** cosine of bge-m3 vectors.
  - Vector hits: ask Vectorize for `returnValues: true`. That is no new model call.
  - Keyword hits (at most 3): one bge-m3 call for them, in the same request as the question's
    embedding where the order of calls allows. Otherwise it is a second small call.
- **Selection:** greedy MAP with Cholesky updates, so k ≤ 12 out of about 23 is microseconds
  of CPU. The same k as today (12, and 10 in the tool), then `answerCandidates` as now.
- **Kept as today:**
  - The Bishop/Deacon lift is applied to `q` before the DPP, so the teachers' passages keep
    their advantage.
  - The 20-word filter, `dedupeMatches`, source URLs, citation registration and the "not in
    the classes" path.
- **Falls back** to today's order when the reranker or the vectors are missing, or on any
  numeric problem (non-finite or degenerate kernel). The answer must never fail because of
  selection.
- **Logged:** one event per question with only counts and timings (candidates, selected,
  overlap with the top-k set, ms). No question text, passage text or reader id.

Phase 2 (conflict) is **not proposed now**. It needs an NLI model, and Workers AI has none in
the approved list, so it would break D8. It also needs a review first: "conflict" between two
passages of the library is not something the app should judge. The paper's own gain from
the term is about 1 point, on fact-checking sets. Revisit only if phase 1 passes and the owner
asks.

## Tuning

- `β` (relevance against diversity) is the one knob. Grid 0.5–1.0 in steps of 0.1, where 1.0
  equals today's top-k by the reranker.
- It is tuned on a calibration split of the retrieval golden set and reported on the held-out
  part only.

## Evals (the gate)

All on Workers AI. Every step reports before (`topk`) and after (`dpp`).

| Eval | Where | Metrics | Cost |
|---|---|---|---|
| Retrieval | `codex/rag-retrieval-eval-20261110` (not merged yet) golden set, replayed offline from captured candidates | nDCG@8, recall@8 and @12, coverage of support groups, redundancy (mean pairwise cosine of the 8) | none after capture |
| Grounding | `bot/scripts/eval-grounding.mjs` | aligned / uncited / unsupported | none |
| Ask, live staging | `eval.yml` live matrix (`--live`), the same questions and models before and after | pass rate, attack failures, grounding, latency p50/p95 | inside the $10 Workers AI budget |

Pass rule: retrieval nDCG@8 and recall better, and no other metric worse; latency p95 at most
+100 ms. Otherwise it stays `topk`.

Prerequisites:

- The retrieval eval branch is reviewed and merged. Its golden judgments say "proposed,
  awaiting owner approval" and were built on library `99526e7806d61ac2`. They need the owner's
  review and a re-capture on the current library.
- The live eval variables from the #612 work are set (owner).
- Changing the reranker call from `top_k` to all candidates is measured on its own first (same
  order, more scores returned), so a cost or latency change isn't blamed on the DPP.

## Cost and risk

- New model calls: at most one small bge-m3 embedding of up to 3 keyword passages per
  `retrieve()`. The reranker reads the same passages as today. No new provider and no new
  data leaves Cloudflare.
- Privacy: no change. Passages are library text. Logs carry counts only.
- OWASP LLM08 (vector and embedding weaknesses): diversity can pull in a lower-ranked passage.
  The reranker relevance in `q` and the unchanged URL checks keep it inside the approved
  sources. A passage below a minimum reranker score is never added just for diversity.
- Doctrine: selection only changes which library passages are read. It writes no text and
  ranks no teaching above another beyond the existing Bishop/Deacon rule.

## Steps

1. Merge the retrieval eval branch (owner reviews the golden set, then re-capture).
2. PR A (t1s): keep the reranker score and ask it for every candidate. Measure the change.
3. PR B (t1s): add `selectPassages` with `ASK_SELECTION=topk`, unit tests, and an offline
   replay against the golden set across the `β` grid.
4. Owner approves `β` and the numbers. Staging runs with `dpp`, live eval before/after.
5. Production only on a pass. `ASK_SELECTION` stays as the switch back.
