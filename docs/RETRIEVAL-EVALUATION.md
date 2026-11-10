# Retrieval evaluation

This evaluates retrieval, without writing or generating answers. The proposed 60-question set
in `bot/evals/retrieval-golden.json` copies questions from the existing Ask and grounding
fixtures. Every grade and coverage label is **proposed, awaiting owner approval**. The source
library fingerprint matches the grounding fixture's public SQLite snapshot. Its `references`
map identifies existing table records; it contains no passage bodies or reference answers.

## What is measured

The harness bundles the current production `retrieve`, `answerCandidates`, `retrievalText`
and `coverageDecision`. Its optional retrieval observer performs no logging, retention, or
additional calls on reader requests. The default limits remain rerank 12 and context 8.

It observes the actual eligible dense and FTS arrays fed into fusion, the merged pool, the reranked list, and the final
answer candidates, overall and by question type. Metrics are recall@5/10/20, MRR@10 and
nDCG@10. Grades 1 and 2 both count as relevant for recall/MRR; nDCG uses linear grade gains,
as in [TREC](https://github.com/usnistgov/trec_eval/blob/main/m_ndcg_cut.c) and
[BEIR](https://github.com/beir-cellar/beir/blob/main/beir/retrieval/evaluation.py).
Queries without positive judgments have null IR metrics and separate counts, rather than a
perfect score. Missing queries, stages, captured requests or pair scores fail evaluation.

The initial relevance unit is a public reference URL. Duplicate hits to that URL count once.
This deliberately does not claim chunk/window-level accuracy: note sub-sections sharing a
URL collapse, while a verse's anchor remains distinct. Raw candidate counts and original
vector IDs, timestamps, source metadata and teacher index remain in the capture, so a later
owner-reviewed set can label those finer units. Unjudged candidates are not proven irrelevant.
The set currently emphasizes named verses and laws; do not extrapolate to all reader questions.

## Frozen mode and CI

```sh
npm run eval:retrieval --workspace bot
```

This requires `bot/evals/retrieval-recorded-v1.json` and `retrieval-baseline-v1.json`. It blocks
network access while replaying public metadata, D1 search responses, nearest-neighbour pools
and per-query/passage rerank scores through the actual code. Frozen inputs keep the comparison
repeatable; teacher/date attribution uses the recorded public index. Changed SQL, vector
options, model IDs, query expansion or previously unseen rerank pairs require a new approved
capture, rather than invented scores or a live fallback.

The CI workflow has no credentials or live step. It fails on any recall@10 or nDCG@10 decline
at any stage, overall or within a question type (tolerance zero, with numerical epsilon
1e-12). Fixed query identities, types, denominators and golden/capture fingerprints prevent
missing cases from improving an average. Review baseline or label revisions explicitly;
never refresh a baseline just to remove a regression. Baseline creation is manual:

```sh
node bot/scripts/eval-retrieval.mjs --bootstrap-baseline
```

It creates a new file and refuses to overwrite an existing baseline. The first baseline and
capture must be reviewed before this gate can pass. Synthetic unit fixtures test the machinery
only; they are never substituted for measured retrieval quality.

## Manual live staging capture

The owner approved Workers AI retrieval evaluation on staging, limited to a few hundred calls.
No answer model, paid/external provider, HyDE, re-embed, resource creation or deployment is
part of this command. Inputs are the existing public fixture questions, not reader history.
Production requests and production D1 are not queried.

**Current boundary:** the checked-in staging VEC binding names the same index as production.
The live preflight refuses that target until the coordinator resolves the staging-only
boundary. Do not bypass it or create an index to make the command run. Real frozen pools,
baseline scores and calibrated enforcement recommendations cannot be claimed before capture.

After the boundary is resolved, run with approved process-only Cloudflare credentials
(for example through 1Password); never put them in fixtures, commands, reports or the vault:

```sh
RAG_EVAL_LIVE=staging-workers-ai-only node bot/scripts/eval-retrieval.mjs --capture-staging
```

`RAG_EVAL_LIVE` is only an environment check, not proof of owner authorization or a billing
control. The adapter allows only Workers AI `@cf/baai/bge-m3` and
`@cf/baai/bge-reranker-base`, Vectorize query, staging D1 metadata and read-only search SELECTs.
It resolves D1 by the configured `-staging` name, follows no redirects, retries nothing, caps
each request at 30 seconds, and caps each run at 60 questions and 500 total Cloudflare calls.
Before the first Cloudflare call it computes a worst-case bound from all deterministic query
parts and all three possible FTS passes, and refuses a run that cannot fit that call budget.
Call counts include failures and are printed even if capture fails. One public teacher-index
read is counted separately. No partial recording is saved and existing recordings are never
overwritten. Review exact counts and provenance with each capture. Before model calls, a
read-only batch verifies every proposed URL exists in staging search and records the row count
and reference-set hash. The runtime and projected teacher-index hashes/row count are recorded.
This verifies reference presence; it cannot prove the entire vector/search corpus is identical
to the older labeled SQLite snapshot. Review corpus/label drift before interpreting errors.

The REST adapters follow the official [Vectorize query API](https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/query/),
[D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
and [Workers AI reranker](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/).
Rerank requests retain all pair scores, then return the same top 12 to production selection.
A separate top-50 vector probe uses the same embedding for semantic-cutoff calibration.
Source-policy overrides are not read: the capture fixes the checked-in public source policy
and records that choice. Reports contain IDs, reference URLs and numerical features/counts;
public source bodies stay in the repository fixture, never in vault reports.

## Calibration

The report sweeps overlap/cosine pairs around 0.25/0.68, preserving the production named-verse,
named-record and small-talk bypasses. The current numeric row must reproduce production's
decision using its exported thresholds; changed or unrecognized rules fail calibration.
False-gap uses selected contexts containing all proposed support groups; false-coverage uses
only explicitly proposed gap questions. Both include numerators and denominators. Acceptance
of contexts with no judged support is a separate diagnostic, not a proven false-coverage error
when judgments are incomplete. Retrieval misses and end-to-end library-answerability rates
are separate too. Multi-part groups must all have support. Small talk is excluded.

A provisional threshold recommendation requires a strict Pareto improvement over the current
pair: neither error rate nor acceptance of unjudged contexts may worsen overall or per question type. Ties use distance to the
current pair, without weighting one error rate against the other. Otherwise it retains the current thresholds. This does
not establish an acceptable absolute error rate or authorize enforcement; the owner reviews
labels, measured rates and the switch. Calibration covers the initial ask/askStream context,
not native paths that prepend named verses; those need their own checks before global
enforcement. No coverage or semantic policy changes in this PR.

The semantic 0.55 curve measures frozen top-50 candidate URLs before hydration. It reports
retained direct/related/unjudged candidates and IR metrics. It is not the end-to-end semantic
API, whose hydration, source checks and per-source deduplication can remove additional hits.
Phase 2 must show before/after results on the same reviewed capture; deeper pools, split
queries and new rerank pairs need an additional bounded staging capture when absent here.

## Phase 2 comparison and D6

Keep `ASK_RANKING` unset for v1; set `ASK_RANKING=v2` for v2. Capture writes separate
`retrieval-recorded-v1.json` / `retrieval-recorded-v2.json` files. Baselines are mode-specific
as well. Both captures use the same proposed questions, and each has its own bounded call
ledger. A local integration checkout with the Phase 2 ranking and observer hooks is required
for v2; the harness never substitutes v1 when v2 is unavailable.

For manual evaluation only, `RAG_EVAL_SOURCE_ROOT` may point to that local source checkout.
CI rejects external source overrides and evaluates its own checkout. Once `ranking.mjs` is
present, CI gates v2 as well as v1. The runtime fingerprint records the code used for capture.
V2 standalone dense/FTS stages use the production RRF over each modality's deterministic query
parts; the merged stage observes the actual fused rerank pool. Embedding capture/replay pins
every split query and its vector response, rather than reusing the whole-question pool.

```sh
node bot/scripts/eval-retrieval.mjs --compare
```

This reports before/after/delta for all five metrics, stages and question types, both call
ledgers, v2 coverage calibration and a teacher-lift sweep. Comparison requires matching runtime,
database/index, teacher metadata/source policy and verified-corpus provenance across the two
captures; drift fails rather than being attributed to the ranking change. The sweep replays the actual v2
`answerCandidates`, with its live `RANKED` symbol and per-source cap intact; it never copies the
ranking formula. The teacher lift object is changed only in the isolated evaluation runtime
and restored afterward. Eligible pairs keep a positive Deacon lift, Bishop >= Deacon, and
Bishop smaller than one topic-word lift, preserving A6's requirement that a better topic match
can outweigh it. The best observed nDCG pair is provisional; ties stay closest to the current
pair. The runtime's actual teacher-lift helper must reflect the requested values. Zero lift
is reported as a control only. A new recommendation needs observed selection/order changes,
a strict measured nDCG gain over the current pair, and both Bishop and Deacon representation;
otherwise retain the current pair. Review per-type results, recall and sample size before changing a
production lift. This command never changes a Worker setting or deploys code.
