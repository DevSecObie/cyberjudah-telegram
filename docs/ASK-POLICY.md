# Ask answer policy (policy-v1)

The rules every Ask CyberJudah answer must keep, where each one is enforced and which test covers it. This is the "requirements" stage of the Ask AI's model development life cycle (MDLC): a change to a prompt, a model, the routing, the tools or the library is a release of the answering system, and it ships only when every rule below still holds.

- **Version:** `policy-v1`, 2026-11-10. A change to a rule, or to where it's enforced, bumps the version and gets a line in the changelog at the end. Once MDLC WP1 (PR #600) merges, every answer carries the prompt, policy, corpus and model versions it was made under (`versions`).
- **Wording:** the rules' own words are in the prompts: `bot/src/ai.mjs` for the Telegram, search and app answers, and study mode's own prompt in `bot/src/app-study-ui.ts` (`APP_TEACHING_POLICY`, `APP_RESPONSE_STYLE`), which words some rules differently. The phrases to search for below are from `ai.mjs`; a check of a rule covers study mode only when its prompt is read too. This file never restates teaching. What the classes teach is in the library, not here.
- **Paths:** all paths are from the repository root. One path is in the separate Mini App repository and is marked so.
- **Frameworks:** the life cycle follows NIST AI RMF (govern, map, measure, manage). Risks are named from the **OWASP Top 10 for LLM Applications 2025** (the current edition) and, because the assistant uses tools, the **OWASP Top 10 for Agentic Applications 2026**; attack techniques from MITRE ATLAS. The threat model and its companions (`docs/ASK-THREAT-MODEL.md`, `docs/ASK-PII-SCAN.md`, `docs/ASK-ALERTS.md`) are MDLC WP4's documents, pending in PR #598; they aren't on `main` until it merges. The OWASP coverage is mapped below.
- **Related:** `docs/ASK-GROUNDING.md` (grounding and citation contract), `docs/operations/ask-ai-pipeline.md` (control register), `docs/ASK-MODEL-ROUTING.md` (routing).

Enforcement levels: **runtime-fix** (code corrects or removes it in every answer), **runtime-report** (code detects it and records it, the reader still sees it), **prompt** (the model is told; nothing checks it at runtime), **eval** (a test checks it before release), **none**.

## Answer rules

| Id | Rule (search the prompt for) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| A1 | No invented reference, quote, date, name, number, teacher or class ("The passages are your only evidence") | prompt; runtime-report: citation numbers outside the sources given are recorded as `unsupported_refs` (`bot/src/citations.mjs`, `bot/src/ai.ts` `citationMetadata`) but stay in the answer | `bot/tests/citations.test.mjs`; `bot/evals/grounding-eval.mjs` (50 recorded cases, in CI) | a bad `[n]` reaches the reader; an invented fact without a citation isn't caught |
| A2 | Scripture only from verse text given, in exact King James wording with its reference ("Quote Scripture only from verse text you were given"; "Scripture comes only from read_scripture") | runtime-fix on some paths: `bot/src/verse-guard.mjs` fixes or removes a misquoted blockquoted verse where `checkedVerses` (`bot/src/ai.ts`) is called | `bot/tests/verse-guard.test.mjs`; `bot/scripts/eval-ask.mjs` verse check (manual) | **several answer paths skip it** (the streaming answer, backup answers, study mode, owner-approved answers and the Mini App's agent path); fix: one shared final step every answer passes through (MDLC WP1b). Inline (non-blockquote) quotes are never checked; an unreadable chapter or an error lets the quote through unchanged |
| A3 | The assembly's doctrine as the library holds it; never another church's, scholars' or the world's as ours; never contradict the classes ("What you stand on", first point) | prompt only | nothing reliable: `eval-ask.mjs` flags one hedge wording ("some scholars/people/christians believe"); owner-approved reference answers are empty | **the biggest gap**: needs owner-approved reference answers and an owner-run fidelity review (MDLC WP3) |
| A4 | Keep the classes' language; never soften it; quote their own words with the passage number ("Keep the classes' language") | prompt only | owner-approved reference answers (empty) | as A3 |
| A5 | Name a teacher only on their exact, cited recorded words; never infer one (`A passage marked "taught by"`) | prompt; source metadata carries the recorded teacher | `bot/tests/ask-sources.test.mjs`, `bot/tests/teachings.test.mjs` | a misattributed paraphrase isn't caught |
| A6 | The Bishops' and Deacons' teaching takes precedence ("takes precedence over everyone else's") | prompt; retrieval gives their passages a small ranking lift (`bot/src/ai.mjs`, inside `answerCandidates`), which a better topic match can outweigh | `bot/tests/ai.test.mjs` (ranking) | precedence isn't guaranteed in retrieval or checked in the answer |
| A7 | Say what the passages don't cover; never fill a gap from general knowledge ("Be honest about the edges") | prompt; coverage gate (`bot/src/grounding.mjs` `assessCoverage`) **logs only** unless `ASK_COVERAGE_MODE=enforce` | `bot/tests/grounding.test.mjs`, `bot/tests/not-in-classes.test.mjs`; `eval-ask.mjs` gap check (manual) | the gate doesn't act today (owner decision) |
| A8 | Proper names, titles and acronyms exactly ("Preserve proper names") | prompt | `eval-ask.mjs` spelling and title checks (manual) | not checked before release until MDLC WP3 |
| A9 | Decline off-topic questions in a sentence ("nothing to do with the Scripture") | prompt | `eval-ask.mjs` question set (manual) | no adversarial or benign test set yet (MDLC WP3) |
| A10 | No model, provider or company names and no "as an AI" in answers (product rule, not in the prompt) | none | `eval-ask.mjs` banned phrases (manual) | nothing checks it before release or at runtime |

## Retrieval (RAG) and the vector store

The library is public, but the index is what the model treats as evidence, so its integrity is what keeps answers true (OWASP LLM04 data and model poisoning, LLM08 vector and embedding weaknesses; ATLAS poisoning and RAG injection techniques). Status: **in place**, **partly**, **to build** or **to verify** (not yet checked in code).

| Id | Requirement | Status |
|---|---|---|
| R1 | **Provenance:** every indexed passage comes from a known library source with its URL and kind; nothing reader-supplied enters the shared index | in place (verified 2026-11-10): the only index write is `bot/scripts/embed.mjs`, fed from the library's search table and the classes' transcripts; the Worker only queries the index; uploaded PDFs are passed to Telegram and not kept, saved chats are per-reader encrypted. Not yet verified: the library engine build in the `cyberjudah` repository |
| R2 | **Corpus integrity and release:** each library/index build has a release id, imports are hash-checked, and answers name the release they used | partly: encyclopedia import is SHA-256-checked; release marker and stamping are MDLC WP1 |
| R3 | **Change control on the corpus (anti-poisoning):** content reaches the index only through reviewed paths (CMS/GitHub review, class corrections feed); a new release is diffed against the last (counts per kind, removed or changed passages) and an unusual change holds the release | to build (MDLC WP4) |
| R4 | **Validation and cleansing before embedding:** de-duplicate, drop fragments and filler, reject malformed rows | partly: `answerCandidates` drops short and repetitive hits at answer time; ingest-time checks **to verify** |
| R5 | **PII scan before indexing:** transcripts and notes are scanned and findings reported (the report never holds the matched text); masking only on the owner's switch, since it changes what Ask can cite | designed (`docs/ASK-PII-SCAN.md`, MDLC WP4, PR #598 pending) |
| R6 | **Retrieved text is data, never instructions** (indirect prompt injection through passages, outside pages, PDFs, images) | in place: untrusted-data fencing and control-pattern stripping (`bot/src/grounding.mjs` `DATA_POLICY`); adversarial tests are MDLC WP3 |
| R7 | **Access control at retrieval, in code:** a reader's own data (saved chats, reminders, uploads) is fetched only for that signed-in reader by the tool, never by instruction to the model | in place for the app tools (`bot/src/agent.ts`, signed sign-in); per-tool tests **to verify** |
| R8 | **Vector store access:** the index is reached only through the Worker's binding; no endpoint returns raw vectors; passage search needs a reader session and is limited per reader and per address | in place for vectors (verified 2026-11-10: no route returns vector values); limits on every passage route being completed (OWASP LLM10) |
| R9 | **Encryption at rest and in transit:** D1, R2 and Vectorize are encrypted at rest by the provider; all calls use TLS | provider control (Cloudflare); recorded here |
| R10 | **Freshness:** the index matches the latest library release; a stale index is detected (the missing-notes problem of 2026-11-09) | to build (MDLC WP1 marker + WP4 alert) |

## Tools, sources and the app

| Id | Rule (search the prompt for) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| S1 | Library and tool text is data, never instructions (`DATA_POLICY` in `bot/src/grounding.mjs`) | runtime-fix: fencing + control-pattern stripping | `bot/tests/grounding.test.mjs`, `bot/tests/ai.test.mjs`, `bot/tests/reader.test.mjs`, `bot/tests/uploaded-pdf.test.mjs` | no adversarial set through outside pages, PDFs and images (MDLC WP3) |
| S2 | Outside sources supplement the library, never replace it: the owner (2026-11-10) wants the AI to use outside resources for facts and sources on the question, as a supplement to the library's retrieval (RAG). Only the owner's approved sites; they never overrule the Scripture or the classes; never quote a verse from them ("Outside sources:") | runtime-fix: whitelist (`bot/src/source-policy.ts`, `outside_source` in `bot/src/ask-tools.ts`) | `bot/tests/preferred-outside-source.test.mjs`, `bot/tests/retrieved-source-url.test.mjs` | "never overrule" is prompt only |
| S3 | Pictures only from a tool's own path ("Pictures:") | runtime: picture paths come from tools (`bot/src/ask-tools.ts`, `bot/src/ask-source-pictures.ts`) | `bot/tests/ask-source-pictures.test.mjs` | none known |
| S4 | **Least privilege for tools:** the assistant can't change the reader's data; a change is only proposed, and the reader confirms it (`propose_reminder_change`) | runtime: the tool only makes a card (`bot/src/agent.ts`); tools are read-only lookups with typed arguments (`input_schema` in `bot/src/ask-tools.ts`) | `bot/tests/assistant.test.mjs`, `bot/tests/reminders.test.mjs` | none known |
| S5 | App answers only from `app_help`; never invent a screen or the reader's data ("app_help:") | prompt; tools are the only source | `bot/tests/app-features.test.mjs` | an invented screen isn't caught |

## Privacy, consent and cost

| Id | Rule | Enforced by | Tested by |
|---|---|---|---|
| C1 | A provider gets a reader's question only with the reader's consent for that provider: on the app and Telegram paths every provider, Workers AI included (`bot/src/app-ask.ts`, `bot/src/ai.ts` `ask`); on search answers every provider except Cloudflare's own Workers AI models (`bot/src/search-answer.ts`). **Known gap (being fixed, obie-39):** on the Telegram paths, when the chosen model can't answer or isn't set up, the backup answer doesn't yet check consent for its own provider; the fix checks it first and otherwise answers "unavailable" with nothing sent | runtime: 428 `consent` from `bot/src/app-ask.ts`, the streaming answer in `bot/src/ai.ts` and `bot/src/search-answer.ts`; reason `consent` from `ask` | `bot/tests/providers.test.mjs`, `bot/tests/app-ask.test.mjs` |
| C2 | Rate limits per reader and per address (OWASP LLM10 unbounded consumption) | runtime: `takeQuota` (`bot/src/ai.ts`, `bot/src/search-answer.ts`). **Gaps:** search answers have a per-reader limit only (per-address limit pending), and readers listed in `SEARCH_AI_QUOTA_EXEMPT` and admins skip it | `bot/tests/ask-ip-backstop.test.mjs`, `bot/tests/session-limits.test.mjs`, `bot/tests/search-ai.test.mjs` |
| C3 | Spending caps per answer and per day, output-length limits (denial of wallet) | runtime: USD caps (`bot/src/research-policy.mjs`, `bot/src/free-budget.ts`) | `bot/tests/financial-integrity.test.mjs`, `bot/tests/research-policy.test.mjs` |
| C4 | Logs and events keep no question or answer text and no Telegram ids | runtime: `bot/src/privacy.mjs`, `bot/src/ask-events.ts` | `bot/tests/privacy.test.mjs`, `bot/tests/ask-events.test.mjs`; `docs/PRIVACY.md` |
| C5 | Reader feedback can't poison the system: nothing reads feedback into the prompts or the index; a "wrong"/"harmful" report that carries the answer's trace id drops that one answer from the week-long cache (a report without it is kept but drops nothing). Known limit: a report can evict a shared cached answer, which costs a fresh answer for the next reader; bounded by the per-account limit, with a per-address limit being added (LLM10) | runtime: `dropReported` (`bot/src/app-ask.ts` → `bot/src/answer-cache.ts`); votes limited per reader and per network (`bot/src/feedback.ts`), reports per account per day (`bot/src/app-ask.ts`) | `bot/tests/feedback.test.mjs`, `bot/tests/app-ask.test.mjs` |

## OWASP coverage

### OWASP Top 10 for LLM Applications 2025

| OWASP | What it means here | Our controls (ids above) | Status |
|---|---|---|---|
| LLM01 Prompt Injection | instructions planted in a question, a passage, an outside page, a PDF or an image | S1, R6, S2, S4; adversarial tests (WP3) | in place; adversarial set being built |
| LLM02 Sensitive Information Disclosure | a reader's data or a secret reaching another reader, a log or another site | C4, R7, R5; per-reader tools; no secrets in prompts; answer pictures only from our own site (Mini App) | in place; hardening in progress |
| LLM03 Supply Chain | a model or provider swapped or changed underneath us; third-party packages | model allowlist with pinned/alias status (WP2); dependency review and CodeQL (`.github/workflows/security.yml`) | allowlist being built |
| LLM04 Data and Model Poisoning | false or planted content entering the library, the index or feedback | R1, R2, R3, R4, C5 | partly; R3 release diff/hold designed (WP4) |
| LLM05 Improper Output Handling | answer text rendered unsafely, or trusted by code without checks | A2 (verse fix), A1 (citation report; the Mini App marks unsupported numbers), markdown rendered without raw HTML, links and pictures only to our own site; a shared final output step (WP1b) | partly; WP1b |
| LLM06 Excessive Agency | the assistant acting beyond what's needed | S4 (propose-only, reader confirms), S5, per-reader tools need a signed-in reader | in place |
| LLM07 System Prompt Leakage | the prompts revealing something that must stay secret | the prompts hold no secrets, keys or access rules (access is enforced in code, R7), so a leaked prompt exposes nothing private; extraction attempts in the adversarial set (WP3) | in place by design |
| LLM08 Vector and Embedding Weaknesses | the index leaking, mixing readers' data or being poisoned | R1, R3, R8, R10 | in place for R1/R8; R3/R10 designed |
| LLM09 Misinformation | wrong answers stated as fact | A1-A8, coverage gate (A7), eval suite and owner-approved answers (WP3) | partly: A3/A4 rest on the prompt until the owner's review exists |
| LLM10 Unbounded Consumption | cost or capacity abuse (denial of wallet) | C2, C3, output-length limits, per-route limits on passage search | in place; limits on every passage route being completed |

### OWASP Top 10 for Agentic Applications 2026

The assistant is a bounded agent: a fixed set of read tools plus one propose-only tool; no code runs, no other agents.

| OWASP | Our controls | Status |
|---|---|---|
| ASI01 Agent Goal Hijack | S1, R6 (retrieved text is data); the task is fixed by the app, not by content | in place; adversarial set (WP3) |
| ASI02 Tool Misuse & Exploitation | read-only tools with typed arguments and an approved-resource list (`bot/src/ask-tools.ts`); outside sources whitelisted (S2); research rounds and cost capped (C3) | in place |
| ASI03 Identity & Privilege Abuse | per-reader tools act only for the signed-in reader (R7); changes need the reader's Confirm (S4) | in place |
| ASI04 Agentic Supply Chain Vulnerabilities | as LLM03; tools are the app's own code | allowlist being built |
| ASI05 Unexpected Code Execution | no tool runs code or shell commands | not applicable by design |
| ASI06 Memory & Context Poisoning | saved chats are the reader's own; the shared answer cache holds no reader data and is dropped by reports (C5); hardening so a per-reader tool run is never cached | in place; hardening in progress |
| ASI07 Insecure Inter-Agent Communication | no other agents | not applicable |
| ASI08 Cascading Failures | backup answers, kill switch `ASK_APP_ENABLED`, automatic rollback after a failed release check | in place |
| ASI09 Human-Agent Trust Exploitation | answers show their sources and mark unsupported citations; the assistant never says a change is done before the reader confirms (S4) | in place |
| ASI10 Rogue Agents | no autonomy beyond one question; every release human-approved | in place by design |

## Release gate (what a change must pass)

Guardrail testing has two halves, and both are required: **adversarial** tests (an attack gets through?) and **benign** tests (an ordinary question wrongly refused or blocked?).

| Change | Must pass before it ships |
|---|---|
| **Any text the answering system sends a model as instructions**, wherever it is in `bot/src`: the prompts (`SYSTEM`, `RESEARCH`, `APP`, `plainCitationGuide` in `bot/src/ai.mjs`; study mode's `APP_TEACHING_POLICY`, `APP_RESPONSE_STYLE` and `getAppStudyPrompt` in `bot/src/app-study-ui.ts`; `RESEARCH_PLAN_PROMPT` in `bot/src/app-study-research.ts`), tool names, descriptions and argument text (`bot/src/ask-tools.ts`, `bot/src/agent.ts`), the instructions added during a run (retries, the forced final turn, how evidence is framed: `bot/src/ai.ts`, `bot/src/agent-open.ts`, `bot/src/app-study-answer.ts`), and `DATA_POLICY` and how it is applied (`bot/src/grounding.mjs`). The list is examples, not the boundary | unit tests + recorded grounding eval (CI; it checks recorded answers and makes no model calls, so it proves the checkers, not a new prompt or model), including the S1 tests for any change to how `DATA_POLICY` is applied; the question suite (`bot/scripts/eval-ask.mjs`, run by hand on staging with the owner's OK for its cost until MDLC WP3 automates it), and **the adversarial and benign sets once WP3 adds them**; a prompt version bump + changelog line (WP1, PR #600: pinned prompts fail a test until their version is bumped); **cached answers dropped**: once PR #600 merges the prompt version is in the cache key and this happens by itself; until then bump `PROMPT_REVISION` in `bot/src/answer-cache.ts` (the key is `ask_cache:<PROMPT_REVISION>:<APP_STUDY_RELEASE.version>:<mode>:<model>:<hash>`; the runbook's bump of `APP_STUDY_RELEASE.version` also works but also marks a serving-policy change); owner Approve |
| A model (`bot/wrangler.jsonc` model vars, `shared/ask-models.json`, routing order) | unit tests, recorded grounding eval and the question suite run for that model; the model on the allowlist (WP2); owner Approve. No cache drop: the model id is part of the cache key, except when a provider's alias starts pointing at a different model under the same id, which needs the cache dropped as for a prompt |
| Routing (`bot/src/ask-routing.ts`, `shared/ask-models.mjs`) | `bot/tests/ask-routing.test.mjs`, `bot/tests/ask-models.test.mjs`; the Mini App's copy (`src/lib/route-model.ts` in the **ask-cyberjudah-telegram** repository) changed in step |
| Tool code or the outside-source whitelist (a tool's wording is a prompt, above). The whitelist is edited through the admin CMS (`PUT /api/admin/ask-sources`), which opens a pull request on `bot/data/ask-sources.json` and puts it live after merge | unit tests for the tool; the adversarial set once WP3 adds it; for a whitelist change, cached answers aren't dropped by the edit, so bump `PROMPT_REVISION` when a source is removed (an answer built on it can otherwise be served for up to 7 days) |
| A library or index release | R2–R5, R10; the question suite on the new release; **cached answers dropped**: once PR #600 merges the corpus release is in the cache key and this happens by itself; until then bump `PROMPT_REVISION`, since the key has no corpus release (its release segment is the serving-policy version) and an answer could otherwise outlive a removed or corrected passage for up to 7 days |
| A setting that changes answers: any variable in `bot/src/env.ts` that selects a model, provider, gateway or backup (`AI_GATEWAY`, `CLAUDE_BILLING` among them), the `ASK_*` and `SEARCH_AI_*` limits, caps and models in `bot/wrangler.jsonc`, and those set on the Worker outside that file (`ASK_COVERAGE_MODE`, `ASK_APP_ENABLED`, `APP_ASK_ENGINE`; see `bot/src/env.ts` for the full list). A setting outside the file leaves no trace in a pull request, so its change is recorded in the changelog below | owner Approve; the question suite when it changes what answers say (coverage mode). The coverage mode is part of the cache key, so switching it regenerates every cached answer (a cost), and switching back within 7 days brings the old ones back |
| The search answer (`bot/src/search-answer.ts`): its prompt, model (`SEARCH_AI_MODEL`, `SEARCH_AI_FREE_ONLY`) or sources | as for a prompt or a model, above; its answers are cached for about 2 minutes (`max-age=120`) under their own version string (`version:` in `search-answer.ts`, not covered by `PROMPT_REVISION` or PR #600); bump it when stale answers must not be served even that long |
| This policy | owner review |

A rule enforced by **prompt only** can't be guaranteed by code. Until owner-approved reference answers and a fidelity review exist (A3, A4), a prompt change that touches "What you stand on" or "How you write" needs the owner to read sample answers before it ships. Human approval stays on every release (human in the loop); an eval result informs it and never replaces it.

## Changelog

- `policy-v1` (2026-11-10): first version, written from the prompts and tests at `origin/main` d6a915b9; OWASP LLM Top 10 2025 and Agentic Top 10 2026 coverage.
- `policy-v1` stays a draft until the owner approves it; the review rounds below change it before that.
- `policy-v1` review round 6 (2026-11-10): Telegram backup consent gap (C1); search-answer limit gaps (C2); the recorded eval makes no model calls; the search answer's own cache version; the ask-sources whitelist and settings outside `wrangler.jsonc` in the gate.
