# Ask answer policy (policy-v1)

The rules every Ask CyberJudah answer must keep, where each one is enforced and which test covers it. This is the "requirements" stage of the Ask AI's model development life cycle (MDLC): a change to a prompt, a model, the routing, the tools or the library is a release of the answering system, and it ships only when every rule below still holds.

- **Version:** `policy-v1`, 2026-11-10. A change to a rule, or to where it's enforced, bumps the version and gets a line in the changelog at the end. Answers carry the version they were made under (`versions.policy`, MDLC WP1).
- **Wording:** the rules' own words are in the prompts (`bot/src/ai.mjs`); this file points to them by a short phrase you can search for, and never restates teaching. What the classes teach is in the library, not here.
- **Paths:** all paths are from the repository root. One path is in the separate Mini App repository and is marked so.
- **Frameworks:** the life cycle follows NIST AI RMF (govern, map, measure, manage); threats are named from the OWASP Top 10 for LLM Applications (2025) and MITRE ATLAS (the threat model is `docs/ASK-THREAT-MODEL.md`, MDLC WP4).
- **Related:** `docs/ASK-GROUNDING.md` (grounding and citation contract), `docs/operations/ask-ai-pipeline.md` (control register), `docs/ASK-MODEL-ROUTING.md` (routing).

Enforcement levels: **runtime-fix** (code corrects or removes it in every answer), **runtime-report** (code detects it and records it, the reader still sees it), **prompt** (the model is told; nothing checks it at runtime), **eval** (a test checks it before release), **none**.

## Answer rules

| Id | Rule (search the prompt for) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| A1 | No invented reference, quote, date, name, number, teacher or class ("The passages are your only evidence") | prompt; runtime-report: citation numbers outside the sources given are recorded as `unsupported_refs` (`bot/src/citations.mjs`, `bot/src/ai.ts` `citationMetadata`) but stay in the answer | `bot/tests/citations.test.mjs`; `bot/evals/grounding-eval.mjs` (50 recorded cases, in CI) | a bad `[n]` reaches the reader; an invented fact without a citation isn't caught |
| A2 | Scripture only from verse text given, in exact King James wording with its reference ("Quote Scripture only from verse text you were given"; "Scripture comes only from read_scripture") | runtime-fix: `bot/src/verse-guard.mjs` fixes or removes a misquoted blockquoted verse, **in the Telegram ask and bounded-answer paths only** (`bot/src/ai.ts` `checkedVerses`) | `bot/tests/verse-guard.test.mjs`; `bot/scripts/eval-ask.mjs` verse check (manual) | **the Mini App's answer path (`answerAppAgent`) runs no verse check**; inline (non-blockquote) quotes are never checked; an unreadable chapter or an error lets the quote through unchanged |
| A3 | The assembly's doctrine as the library holds it; never another church's, scholars' or the world's as ours; never contradict the classes ("What you stand on", first point) | prompt only | nothing reliable: `eval-ask.mjs` flags one hedge wording ("some scholars/people/christians believe"); owner-approved reference answers are empty | **the biggest gap**: needs owner-approved reference answers and an owner-run fidelity review (MDLC WP3) |
| A4 | Keep the classes' language; never soften it; quote their own words with the passage number ("Keep the classes' language") | prompt only | owner-approved reference answers (empty) | as A3 |
| A5 | Name a teacher only on their exact, cited recorded words; never infer one (`A passage marked "taught by"`) | prompt; source metadata carries the recorded teacher | `bot/tests/ask-sources.test.mjs`, `bot/tests/teachings.test.mjs` | a misattributed paraphrase isn't caught |
| A6 | The Bishops' and Deacons' teaching takes precedence ("takes precedence over everyone else's") | prompt; retrieval gives their passages a small ranking lift (`bot/src/ai.mjs`, after `answerCandidates`), which a better topic match can outweigh | `bot/tests/ai.test.mjs` (ranking) | precedence isn't guaranteed in retrieval or checked in the answer |
| A7 | Say what the passages don't cover; never fill a gap from general knowledge ("Be honest about the edges") | prompt; coverage gate (`bot/src/grounding.mjs` `assessCoverage`) **logs only** unless `ASK_COVERAGE_MODE=enforce` | `bot/tests/grounding.test.mjs`, `bot/tests/not-in-classes.test.mjs`; `eval-ask.mjs` gap check (manual) | the gate doesn't act today (owner decision) |
| A8 | Proper names, titles and acronyms exactly ("Preserve proper names") | prompt | `eval-ask.mjs` spelling and title checks (manual) | not checked before release until MDLC WP3 |
| A9 | Decline off-topic questions in a sentence ("nothing to do with the Scripture") | prompt | `eval-ask.mjs` question set (manual) | no adversarial or benign test set yet (MDLC WP3) |
| A10 | No model, provider or company names and no "as an AI" in answers (product rule, not in the prompt) | none | `eval-ask.mjs` banned phrases (manual) | nothing checks it before release or at runtime |

## Retrieval (RAG) and the vector store

The library is public, but the index is what the model treats as evidence, so its integrity is what keeps answers true (OWASP LLM04 data and model poisoning, LLM08 vector and embedding weaknesses; ATLAS poisoning and RAG injection techniques). Status: **in place**, **partly**, **to build** or **to verify** (not yet checked in code).

| Id | Requirement | Status |
|---|---|---|
| R1 | **Provenance:** every indexed passage comes from a known library source with its URL and kind; nothing reader-supplied enters the shared index | partly: records carry kind/url (`bot/src/ai.mjs` `docRecord`, `chunkRecord`); that uploaded PDFs and chats never reach the shared index is **to verify** |
| R2 | **Corpus integrity and release:** each library/index build has a release id, imports are hash-checked, and answers name the release they used | partly: encyclopedia import is SHA-256-checked; release marker and stamping are MDLC WP1 |
| R3 | **Change control on the corpus (anti-poisoning):** content reaches the index only through reviewed paths (CMS/GitHub review, class corrections feed); a new release is diffed against the last (counts per kind, removed or changed passages) and an unusual change holds the release | to build (MDLC WP4) |
| R4 | **Validation and cleansing before embedding:** de-duplicate, drop fragments and filler, reject malformed rows | partly: `answerCandidates` drops short and repetitive hits at answer time; ingest-time checks **to verify** |
| R5 | **PII masking before indexing:** transcripts and notes are scanned and personal data is masked before they're embedded | to build (MDLC WP4) |
| R6 | **Retrieved text is data, never instructions** (indirect prompt injection through passages, outside pages, PDFs, images) | in place: untrusted-data fencing and control-pattern stripping (`bot/src/grounding.mjs` `DATA_POLICY`); adversarial tests are MDLC WP3 |
| R7 | **Access control at retrieval, in code:** a reader's own data (saved chats, reminders, uploads) is fetched only for that signed-in reader by the tool, never by instruction to the model | in place for the app tools (`bot/src/agent.ts`, signed sign-in); per-tool tests **to verify** |
| R8 | **Vector store access:** the index is reached only through the Worker's binding; no public endpoint returns raw vectors or bulk passages | to verify |
| R9 | **Encryption at rest and in transit:** D1, R2 and Vectorize are encrypted at rest by the provider; all calls use TLS | provider control (Cloudflare); recorded here |
| R10 | **Freshness:** the index matches the latest library release; a stale index is detected (the missing-notes problem of 2026-11-09) | to build (MDLC WP1 marker + WP4 alert) |

## Tools, sources and the app

| Id | Rule (search the prompt for) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| S1 | Library and tool text is data, never instructions (`DATA_POLICY` in `bot/src/grounding.mjs`) | runtime-fix: fencing + control-pattern stripping | `bot/tests/grounding.test.mjs`, `bot/tests/ai.test.mjs`, `bot/tests/reader.test.mjs`, `bot/tests/uploaded-pdf.test.mjs` | no adversarial set through outside pages, PDFs and images (MDLC WP3) |
| S2 | Outside sources only from the owner's approved sites; they never overrule the Scripture or the classes; never quote a verse from them ("Outside sources:") | runtime-fix: whitelist (`bot/src/source-policy.ts`, `outside_source` in `bot/src/ask-tools.ts`) | `bot/tests/preferred-outside-source.test.mjs`, `bot/tests/retrieved-source-url.test.mjs` | "never overrule" is prompt only |
| S3 | Pictures only from a tool's own path ("Pictures:") | runtime: picture paths come from tools (`bot/src/ask-tools.ts`, `bot/src/ask-source-pictures.ts`) | `bot/tests/ask-source-pictures.test.mjs` | none known |
| S4 | **Least privilege for tools:** the assistant can't change the reader's data; a change is only proposed, and the reader confirms it (`propose_reminder_change`) | runtime: the tool only makes a card (`bot/src/agent.ts`); tool arguments validated in code | `bot/tests/assistant.test.mjs`, `bot/tests/reminders.test.mjs` | none known |
| S5 | App answers only from `app_help`; never invent a screen or the reader's data ("app_help:") | prompt; tools are the only source | `bot/tests/app-features.test.mjs` | an invented screen isn't caught |

## Privacy, consent and cost

| Id | Rule | Enforced by | Tested by |
|---|---|---|---|
| C1 | A paid provider gets a question only after the reader's consent for that provider | runtime: 428 `consent` (`bot/src/ai.ts`, `bot/src/providers.ts`) | `bot/tests/providers.test.mjs`, `bot/tests/app-ask.test.mjs` |
| C2 | Rate limits per reader and per address (OWASP LLM10 unbounded consumption) | runtime: `takeQuota` (`bot/src/ai.ts`, `bot/src/search-answer.ts`) | `bot/tests/ask-ip-backstop.test.mjs`, `bot/tests/session-limits.test.mjs` |
| C3 | Spending caps per answer and per day, output-length limits (denial of wallet) | runtime: USD caps (`bot/src/research-policy.mjs`, `bot/src/free-budget.ts`) | `bot/tests/financial-integrity.test.mjs`, `bot/tests/research-policy.test.mjs` |
| C4 | Logs and events keep no question or answer text and no Telegram ids | runtime: `bot/src/privacy.mjs`, `bot/src/ask-events.ts` | `bot/tests/privacy.test.mjs`, `bot/tests/ask-events.test.mjs`; `docs/PRIVACY.md` |
| C5 | Reader feedback can't be used to poison the system: a "wrong"/"harmful" report drops one cached answer, never changes the index or the prompts, and reports are rate limited | partly: cache drop only (`bot/src/feedback.ts`); rate limit on reports **to verify** | `bot/tests/feedback.test.mjs` |

## Release gate (what a change must pass)

Guardrail testing has two halves, and both are required: **adversarial** tests (an attack gets through?) and **benign** tests (an ordinary question wrongly refused or blocked?).

| Change | Must pass before it ships |
|---|---|
| A prompt in `bot/src/ai.mjs`, or `DATA_POLICY` | unit tests + recorded grounding eval (CI); **the question suite and the adversarial and benign sets** (`bot/scripts/eval-ask.mjs`, run by hand on staging with the owner's OK for its cost until MDLC WP3 automates it); prompt version bump + changelog line (WP1); owner Approve |
| A model (`bot/wrangler.jsonc` model vars, `shared/ask-models.json`, routing order) | as above, run for that model; the model on the allowlist (WP2) |
| Routing (`bot/src/ask-routing.ts`, `shared/ask-models.mjs`) | `bot/tests/ask-routing.test.mjs`, `bot/tests/ask-models.test.mjs`; the Mini App's copy (`src/lib/route-model.ts` in the **ask-cyberjudah-telegram** repository) changed in step |
| Tools or the outside-source whitelist | unit tests for the tool; the adversarial set |
| A library or index release | R2–R5, R10; the question suite on the new release |
| This policy | owner review |

A rule enforced by **prompt only** can't be guaranteed by code. Until owner-approved reference answers and a fidelity review exist (A3, A4), a prompt change that touches "What you stand on" or "How you write" needs the owner to read sample answers before it ships. Human approval stays on every release (human in the loop); an eval result informs it and never replaces it.

## Changelog

- `policy-v1` (2026-11-10): first version, written from the prompts and tests at `origin/main` d6a915b9.
