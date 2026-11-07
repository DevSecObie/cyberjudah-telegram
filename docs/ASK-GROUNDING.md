# Ask grounding and citation contract

Ask treats retrieved passages, notes, transcripts, metadata and tool results as evidence. The existing teaching policy and honest-gap wording are unchanged. No teaching or source text is rewritten by this change.

## Data boundary

`grounding.mjs` wraps source objects and every model-facing tool result in labeled, fenced JSON. Role tags, fence characters and literal BEGIN/END boundary markers are reversibly escaped. Ordinary words such as “instruction” remain visible to the model, exactly as they appear in Scripture. Decoding the JSON gives the exact original source words. API source text and excerpts retain those words. A fixed system instruction tells every provider to read that material as data; source text cannot change the selected model, server tool schemas or server citation registry. Only host-assigned `source_n` and `source_registry` fields register citations. Tool inputs still pass the existing schema checks.

The tests plant role tags, an instruction to ignore previous instructions, a forged model, an unavailable money tool and a forged citation. They exercise the real agent with a scripted provider and verify the server boundaries, unchanged source text and suppression of a thin-evidence answer. This is defense in depth, not a claim that JSON escaping makes an LLM immune to all prompt injection.

## Coverage gate

**Default: shadow mode.** Unset `ASK_COVERAGE_MODE` (or `shadow`) records numeric coverage decisions without changing whether an answer is delivered. Only `ASK_COVERAGE_MODE=enforce` enables the new thin-evidence gate; the owner decides when to enable it after calibration. Existing empty-retrieval behavior stays in place. Logs contain fixed reason labels and numeric counts/scores, never questions, sources or person identifiers. The agent memoizes the decision until evidence changes, rather than re-tokenizing each streamed delta. Enforcement uses a different answer-cache namespace, so shadow answers cannot bypass an enabled gate.

When enforcement is enabled, research is allowed after an empty first search. The gate checks the evidence after tools run and before accepting an answer. It suppresses answer deltas while evidence is insufficient, then emits the existing honest-gap response and a related recorded class when one is available. That result does not charge the reader for an answer. Plain answers check before generation; study answers check after their research phase.

The initial thresholds are calibration heuristics: at least one usable passage (40 characters and six distinct words) with 25% overlap in question topic terms, or a genuine Vectorize cosine score of at least 0.68. Keyword placeholder scores and score claims inside text never count as vector provenance. Named Scripture and named law records allow direct lookups, including short KJV verses. Greetings need no evidence. Explicit reminder, saved-chat and app-help intents may answer from their matching app tool's own state. Tool output never contributes to lexical or vector coverage, however long or topically similar it is; it cannot cover a doctrinal question. Detected role/control payloads cannot satisfy coverage or become the nearest gap source.

These checks detect thin retrieval; they do not prove that a passage entails a claim or that the entire library lacks material. Gap wording therefore describes what this search found. Threshold changes need recorded positive and negative cases, rather than silently relaxing the gate.

## Citation response contract

Successful `/api/ask` JSON responses and NDJSON `done` events include `unsupported_refs: string[]`, empty when none were found. Native Ask responses expose the same field. It contains exact invalid **numeric** bracket groups, deduplicated in order of appearance. This is a membership diagnostic, not a claim-to-source semantic verdict.

Valid references are positive, canonical, safe integer IDs in that answer's actual server registry. Grouped references such as `[1, 2]` work; repeated valid IDs attach a source once, in first-use order. Sparse IDs are validated by membership, not by array length. An uncited generated answer has `sources: []`; the old fallback that attached the first four passages is removed. Owner-approved answers keep their explicitly approved attachments even when the approved wording has no brackets.

| Answer references, registry `{1,2}` | Returned source IDs | `unsupported_refs` |
| --- | --- | --- |
| none | `[]` | `[]` |
| `[2, 1, 2]` | `[2,1]` | `[]` |
| `[99] [99]` | `[]` | `["[99]"]` |
| `[1, 99] [0]` | `[1]` | `["[1, 99]","[0]"]` |
| `[01] [-1] [1.5]` | `[]` | `["[01]","[-1]","[1.5]"]` |

Clients may display a source warning from this field. They must not invent a source for an invalid reference. Existing `answer`, source fields, events, auth and consent remain in place. The answer-cache revision changes so old fallback sources are not reused.

## Recorded evaluation

`npm run eval:grounding --workspace bot` unit-tests the evaluator against 50 fixture-built answers to realistic public-library questions, recorded retrieval and explicit claim/evidence annotations. Normal `npm test` runs it in CI with no network, inference or paid calls. The runner reports claim alignment, uncited-claim rate and answers with uncited claims. Regression tests replace a correct citation with another **existing but wrong** source, remove citations and append unreviewed prose; each must fail.

The first suite is an extractive baseline: 48 claims copied verbatim from KJV, laws, notes and cases, plus greeting/gap cases. It checks whether the attached citation supports the exact claim, rather than merely existing. It is not a grounding measure of model output: it does not invoke a model, assess recorded live responses, measure live-model quality or automatically judge arbitrary paraphrases. New paraphrase annotations require human review. Fixtures contain small public excerpts and their library snapshot hash, never private chats or the full database.

To deliberately refresh the public snapshot:

```sh
python3 bot/scripts/record-grounding-fixtures.py /path/to/public/library.sqlite
npm run eval:grounding --workspace bot
```

The fixed data policy adds prompt tokens per model call. The cache-revision change makes older answers miss until they expire (up to seven days), so inference spend can rise during that period. Shadow calibration also adds numeric logs, with no inference.

No new binding, secret, schema, external service or Cloudflare write is required. Merging changes `bot/src` and therefore enters the repository's Ask Worker production deployment path; the owner controls that release. This PR is rebased onto automatic model routing (#547). The separate depth PR (#548) retains this data boundary and citation contract when integrating its reading tools.
