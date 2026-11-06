# Existing resources online: integration candidate

This work reconnects the existing Bible Strong reader, resource contracts and offline material to CyberJudah's Worker. It does not replace those clients or acquire a new library. The contract oracle is pinned to upstream `61cf39c8c4a65220212dbac9536794e43ae8207e` in `tests/upstream/source.json`, with its GPL-3.0 license. The native fork retains its original-language renderer, token grouping and UTF-16 offset rules. Its interlinear dataset schema additionally accepts `CYBERJUDAH`, distinct from `STEP`, and verifies expected dataset, language and paired text revision/hash.

## Original-language text and interlinear

`build-online-interlinear.py` projects the candidate's existing `BHG.json.zip` and English SQLite index into JSON chapters. It verifies catalog archive/content hashes, SQLite integrity, paired text identity, token bounds, and complete token/segment coverage. It uses the native sidecar's existing joins and does not synthesize alignment or alter source text. The existing native builder is `apps/expo/scripts/build-cyberjudah-original-languages.py`; it names WLC/Open Scriptures morphology, Scrivener 1894, Robinson tags and existing Strong's/KJV-derived glosses, not STEP. Labels are provenance leads, not a rights clearance.

Prepare locally, using fresh output directories:

```sh
python3 bot/scripts/build-online-interlinear.py --expo-root /path/to/candidate/apps/expo --output /tmp/cj-interlinear
python3 bot/scripts/stage-online-interlinear.py --source /tmp/cj-interlinear --destination /tmp/cj-staged/bs-data/interlinear
```

The complete verified projection has 1,189 chapters, 31,101 verses, 446,162 tokens, 610,094 segments and 2,380 hashed files. Paired text SHA is `1eea4e4d68d6009562a0e1a09902070d9503b98f9deb23cb8aa9f65c00ac4467`.

For a separately approved release, `CYBERJUDAH_INTERLINEAR_ASSETS=/absolute/prepared/directory` makes the existing `prepare-assets.sh` stage this publication. This is opt-in; no default or CI activation is added. Both BHG chapter reads and English interlinear reads use the same deployment assets. Missing/tampered publication returns 503, unsupported languages return 404, and absent chapters remain distinct. No caller-selected origin or remote fallback is used. Pericopes are an empty index because these archives contain none.

## Semantic Bible search

The existing upstream semantic repository uses PostgreSQL/pgvector and thematic-topic embeddings. This Worker currently serves D1-backed verse resources and already uses Workers AI/Vectorize. The adapter therefore reuses CyberJudah's existing `embed` helper/model (`@cf/baai/bge-m3`, 1,024 dimensions) while keeping the upstream search response contract. The helper was moved unchanged to `ai-embeddings.ts` to avoid importing the entire Ask/resource route cycle; `ai.ts` re-exports it for existing callers.

Search requires all of `BIBLE_VEC`, `AI`, `BIBLE_SEMANTIC_LIMIT` and `BIBLE_SEMANTIC_REVISION` matching the published KJV text SHA. No binding or flag is activated by this change. A dedicated Bible-only index keeps the live teachings index untouched. Book/canon and revision filters are applied before nearest-neighbour ranking. Rate limiting precedes inference. Results must match hash-verified canonical chapters; stale text, missing metadata, inconsistent IDs, malformed embeddings or provider failure return typed 503, and throttling returns typed 429.

Vectorize supports a maximum 100-result window when full metadata/values are omitted; full-metadata queries cap at 50. The adapter retrieves 100 IDs then metadata separately. `count` is the size of that bounded window, not an exhaustive corpus count. Pagination is within this window and sort-by-book only sorts that window. No upstream model-specific relevance threshold is copied. Live relevance evaluation remains necessary. See [client API](https://developers.cloudflare.com/vectorize/reference/client-api/) and [metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

```sh
python3 bot/scripts/prepare-bible-semantic.py --expo-root /path/to/candidate/apps/expo --output /tmp/cj-bible-input
node bot/scripts/embed-bible-semantic.mjs --input /tmp/cj-bible-input --index cyberjudah-bible-candidate
```

These commands are local only. Preparation verifies all 36,821 existing verses against server chapter hashes and emits an input manifest. The embedding script defaults to a plan; it performs no network requests in that mode. A separate, explicitly authorized `--apply` uses existing Cloudflare credentials to submit paid embeddings/upserts. It requires a separate `cyberjudah-bible-*` index configured for 1,024 dimensions/cosine and pre-existing `book:number`, `revision:string` metadata indexes. It does not create indexes, credentials or bindings. Atomic checkpoints bind the acknowledged progress to account, index and exact input; retry resumes after acknowledged batches. A missing acknowledgment can cause a batch to be re-embedded and idempotently re-upserted. Submission is asynchronous and is not activation or proof of index visibility. No real `--apply` has been executed by this work.

Before enabling: verify every input ID/revision/text is visible, metadata filters work before ranking, expected verses are retrieved for a recorded query set, excluded books never appear, and throttling/provider failure remain recoverable. [Upsert API](https://developers.cloudflare.com/api/resources/vectorize/subresources/indexes/methods/upsert/) describes asynchronous mutation receipts.

## Existing Nave implementation

The prepared PR79 native resources and PR534 gateway were reused, not rewritten. The native candidate adds the two existing offline archives (English and French, 5,313 topics each) and optional `EXPO_PUBLIC_NAVE_API_URL`. With no separate URL, current CyberJudah teaching-topic routing remains. The original Nave can be selected through the separate `/bs/reference` gateway without replacing CyberJudah teaching links at `/bs`.

The optional `REFERENCE_HOSTING`/`REFERENCE_PUBLICATIONS` code uses a private service binding, forwards only public GETs, strips identity/cookies, maps Apocrypha by book identity and never fails over to another publication when the owned service is unavailable. `nave-publication.ts` adds the isolated, rate-limited gateway. The copied `wrangler.nave-production.jsonc` and native Resource service configs are proposed manifests from those PRs; their deployment topology/IDs still require read-only verification. Read-only console verification on 6 November 2026 confirmed that staging already uses `REFERENCE_HOSTING=nave-self-hosted` and `REFERENCE_PUBLICATIONS` bound to `cyberjudah-resources-staging`. The staging manifest now preserves that existing setup on future deployment; production reference settings and deployment workflows are unchanged. This reference binding grants no account-erasure RPC capability, and deletion gates remain closed. The native candidate build profiles now select the existing separate Nave endpoint; public production and staging GET checks previously passed both pinned editions (staging succeeded on retry after the initial timeout). No deployed environment was changed. Run `stage-nave-offline.mjs` only against the explicitly chosen local release tree; the normal deployment workflow was not altered.

## Validation and separate remaining gates

Local evidence includes 106 resource API tests, 12 native interlinear tests, full generated interlinear contract/hash validation, isolated mock publisher tests and complete offline archive checks. The native dependency overlay points workspace packages at the candidate but reuses older installed external dependencies; a clean install/native build remains required. These checks establish code/fixture behavior, not live backend, browser or physical-device acceptance.

The user requested completion of every in-progress resource/feature before the later licensing work. Continue implementation and testing. Track exact source/edition questions separately: WLC/Open Scriptures tags; Scrivener/Robinson tags; existing Strong's/KJV-derived glosses; KJV/Apocrypha edition/territories; and both English/French Nave archives. No unverified rights claim is made here. Publication/distribution and store review remain separate gates; no assets, embeddings, settings or rules were deployed.

Staging activation check: three bounded public GETs for semantic search and BHG/interlinear coverage were denied with Cloudflare 403/error 1010 on 2026-11-05. This is an edge access denial, not candidate-handler acceptance. Stop until the owner restores authorized access; do not change user agents or identities to retry. The prior administrative D1 authentication error 10000 is a separate blocker. The checked-in staging configuration still shares the teachings Vectorize index and contains placeholder D1 IDs. Verify deployed topology before preparing any rollout; never use that teachings index for Bible upserts. The user has authorized merge/deploy only after verification, which these failures do not establish.
