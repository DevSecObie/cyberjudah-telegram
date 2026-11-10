# Ask ranking v2 (RAG Phase 2)

Ranking v2 changes how Ask orders the passages it finds. It doesn't change what the library holds or what the model is told. It runs behind a switch and is **off by default**:

| `ASK_RANKING` | Ranking |
|---|---|
| unset, or anything other than `v2` | v1, as before |
| `v2` | v2, described below |

To roll back, unset the switch. Nothing is stored differently, so no data needs to change.

The code is in `bot/src/ranking.mjs` (pure arithmetic) and `bot/src/ai.ts` `retrieveV2`. It is tested in `bot/tests/ranking.test.mjs`. The plan is in the vault: `Projects/cyberjudah-telegram/rag-upgrade-gap-analysis-2026-11-10.md`, Phase 2.

## What v2 does

1. **Deeper pools, fused by rank.**
   - Search by meaning takes the 50 closest passages (`DENSE_TOP_K`). That is Vectorize's limit with metadata; v1 took 20.
   - Search by words takes the best 50 by bm25 across every kind (`KEYWORD_POOL`, `search.ts` `keywordPool`), not 3 per kind. It uses the same strict, then loose, then prefix passes.
   - The lists are fused by reciprocal rank fusion with k = 60 (`RRF_K`). In v1 they were concatenated, with every keyword hit scored a flat 0.5.
2. **The reranker reads the best `RERANK_POOL` (60) and its scores are kept.**
   - In v1 the reranker only chose which 12 survived. `answerCandidates` then re-sorted them by their original scores, so vector hits mostly beat keyword hits whatever the reranker said.
   - In v2, `answerCandidates` sorts by the reranker's score plus the same small lifts: word overlap (`OVERLAP_LIFT`) and the Bishop/Deacon lift (`TEACHER_LIFT`).
3. **The reranker reads what matters.** It gets the title, the date when known, the first 600 characters, and the sentences that share a word with the question, up to 2,000 characters (`rerankText`). In v1 it got a blind cut of the first 2,000. When the reranker fails, the fused order stands, and the telemetry counts the fallback.
4. **Diversity.** At most `PER_SOURCE` (2) passages from one recording or one page are kept in the final selection.
5. **Several-part questions.**
   - A question with separate questions ("…? …?") or clauses joined by "and also", "; also" or ", and why/who/…" is also searched part by part.
   - At most 3 parts are searched, and each needs two words that say something, so "bread and wine" is never split.
   - All lists are fused. No model is called; the split is plain text rules (`questionParts`).
   - The research agent's own short queries almost never split.

Unchanged:
- The evidence rules: passages under 20 words and unlinkable sources are dropped before any citation number.
- The coverage gate, the citations and the answer prompts.

## The Bishop/Deacon lift (owner decision D6, ASK-POLICY A6)

ASK-POLICY A6: *"retrieval gives their passages a small ranking lift (inside `answerCandidates`), which a better topic match can outweigh"*. v2 keeps that intent. The lift is still added inside `answerCandidates`, now on the reranker's 0-1 scale.

The owner decided (D6) to set its strength from the Phase 1 recorded set. Until those numbers are in, `TEACHER_LIFT` keeps v1's values (0.06 Bishop, 0.04 Deacon) as placeholders. The PR that turns v2 on must show:
- the chosen values;
- the recorded-set numbers they came from;
- that A6 still holds: a passage with a clearly better rerank score outranks a lifted one (`ranking.test.mjs` checks this shape).

## Cost

Per question, v2 makes these calls (all Workers AI or Vectorize; no new provider and no Claude call):
- 1 embedding call for the question and its parts;
- 1 to 4 Vectorize queries;
- 1 to 4 keyword queries on D1;
- 1 reranker call over at most 60 passages, up from about 25-40.

The reranker's input tokens grow about 1.5-2×. Its cost is counted in the answer's `spend` as before. `RERANK_POOL` is to be set where the Phase 1 recall curve flattens.

## Telemetry (numbers only)

Every search logs one `ask_retrieval` line, in v1 and v2. It never contains a question, a passage, an address or an id.

| Field | Meaning |
|---|---|
| `ranking` | `v1` or `v2` |
| `parts` | how many extra parts of the question were searched (v2) |
| `dense`, `keyword` | how many passages each search found, after the evidence rules |
| `both` | how many both searches found |
| `pool` | how many the reranker was given |
| `rerank` | `ok`, `fallback` (the reranker failed or answered nothing) or `skipped` (one passage or none) |
| `rerank_ms` | how long the reranker took |
| `top` | the best rerank score as a bucket: `0.8+`, `0.5-0.8`, `0.2-0.5`, `<0.2`, `none` |
| `final` | how many passages were kept |

## Before turning it on

1. Score v1 and v2 on Codex's Phase 1 recorded set: recall@5/10/20, MRR@10 and nDCG@10 per stage and per question type. Put the table in the PR.
2. Set `TEACHER_LIFT` (D6), `RERANK_POOL` and `PER_SOURCE` from those numbers.
3. Merge through the coordinator. Turning the switch on is the owner's decision.
