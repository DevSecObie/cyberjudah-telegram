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

## Search answer recovery and release check

`GET /api/search/answer` makes at most two model calls: an initial answer and one citation retry when no valid source ID is cited. Both use the same retrieved records, free-spend reservation, provider, consent and 55-second deadline. The retry adds a fixed system reminder to use the supplied `source_n` values as `[n]`; it does not include the uncited draft. It starts only when usage is known, time remains and the original budget covers its input plus at least 64 output tokens. No new reservation, fallback provider or research loop is started. Both calls are metered, including an answer that remains uncited. Greetings retain their existing citation exemption.

When the retry is still uncited (or cannot fit the remaining budget/time), the response is HTTP 200 with this shape:

```json
{
  "ok": true,
  "state": "no-cited-answer",
  "answer": "I could not produce a cited answer from the library material I found.",
  "sources": [],
  "unsupported_refs": [],
  "followups": [],
  "related": { "label": "Related library passages", "passages": [] },
  "citation_diagnostics": { "sources_returned": 0, "citation_tokens_found": 0, "valid_ids": 0, "retries": 1, "model": "configured-model-id" }
}
```

The response also retains `model`, `provider` and `ms`. `related.passages` contains the existing retrieved records with no citation `n`; its label distinguishes related material from cited support. The uncited draft and its follow-ups are discarded. Empty or enforced-thin retrieval uses the same state without a model call, with the message “I could not find material answering this directly.” Neither state is edge-cached; only answers with valid cited sources enter the `library-answer-v5-reader-voice` namespace, partitioned by shadow/enforce mode. Existing clients can display the honest `answer` safely even if they do not yet render `related`.

Successful search answers expose the same `citation_diagnostics` object: final-draft numeric reference token count (including invalid or repeated IDs), unique valid ID/source count, actual citation retry count (0 or 1), and model identifier. These are membership diagnostics, not semantic entailment scores. Provider failures and in-flight timeouts still return HTTP 503, rather than being disguised as an honest-uncited result.

The release check asks “What does Genesis 1:1 say?”, whose named verse is hydrated directly from the public KJV library. A matching configured provider and at least one valid citation pass. An honest-uncited response **warns** only if its separately labelled related material includes the exact Genesis 1:1 library record and text. This threshold tests route, retrieval and response-contract health; a warning still signals a model citation-quality problem. Missing related material, malformed responses, missing routes and any 404 fail. One transport retry remains for a 503 or request timeout; a second failure fails, and other 5xx statuses fail immediately. It does not retry an honest-uncited HTTP 200.

Release diagnostics log only source/token/valid-ID counts, retry count and the expected model identifier, never prompts, answers, passages, launch data or person IDs. Offline tests reproduce zero-source model output through the real Search handler and verifier, as well as citation recovery, shared budget/deadline, unknown usage, discarded drafts, uncached gaps and transport failures. No live inference is needed for these tests.

### Plain formatting and quoted-verse citations

Plain bounded answers append a trusted numeric mapping (`source_n=1 -> [1]`) and a worked formatting example to the system message on both the first call and citation retry. Only host-assigned numeric IDs enter this guide; titles, passage words and metadata stay inside the existing untrusted JSON boundary. The example uses placeholders, not new teaching or invented Scripture. It shows a citation after the bold Bible reference and distinguishes a Bible reference from a numbered source citation. Empty retrieval has no mapping or worked example. The general agent system instructions, configured model, reservation and retry limits remain unchanged.

Answer-cache namespaces advance so answers that bypassed the older quote check cannot be reused for up to a week. Old records expire normally; the cold cache can temporarily increase inference within the existing allowance.

The verse checker separates existing trailing numeric references from the quoted Bible words, both before and after the bold Bible reference. Exact quotations retain their original form. A corrected quotation retains only the markers the draft already supplied; a removed quotation leaves no orphan marker. It never adds, renumbers or guesses an ID. The normal server citation registry validates those IDs afterward, so `[99]` and `[01]` remain unsupported rather than becoming valid through the quotation repair. A citation after a bold reference no longer bypasses the KJV wording check.

This fixes a reproducible post-processing loss: `> In the beginning God created the heaven and the earth. [1] **Genesis 1:1**` previously became a corrected quote without `[1]`. Search's diagnostics run **after** `checkedVerses`, so zero final tokens in the #561 smoke do not establish that the provider wrote zero raw tokens. The original production draft was deliberately not logged; its exact cause remains unknown. Offline regressions run both citation positions through the actual Search/`checkedVerses`/citation-diagnostics path on a scripted 8B response and require at least one valid source, with no citation retry. Separate cases preserve the honest-uncited state, reject invalid IDs and verify that the trusted guide reaches both calls. These fixtures demonstrate formatting and server behavior, not live model adherence. No live model calls or model/configuration changes are part of this fix.

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
