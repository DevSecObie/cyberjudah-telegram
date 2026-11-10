# Ask answer policy (policy-v1)

The rules every Ask CyberJudah answer must keep, where each one is enforced and which test covers it. This is the "requirements" stage of the Ask AI's model development life cycle (MDLC): a change to a prompt, a model, the routing, the tools or the library is a release of the answering system, and it ships only when every rule below still holds.

- **Version:** `policy-v1`, 2026-11-10. A change to a rule, or to where it's enforced, bumps the version and gets a line in the changelog at the end.
- **Wording:** the rules' own words are in the prompts (`bot/src/ai.mjs`); this file points to them and never restates teaching. What the classes teach is in the library, not here.
- **Related:** `docs/ASK-GROUNDING.md` (grounding and citation contract), `docs/operations/ask-ai-pipeline.md` (control register), `docs/ASK-MODEL-ROUTING.md` (routing).

Enforcement levels: **runtime** (code checks or fixes every answer), **prompt** (the model is told; nothing checks it at runtime), **eval** (checked by a test before release), **none**.

## Rules

| Id | Rule (where it's stated) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| A1 | The passages are the only evidence: no invented reference, quote, date, name, number, teacher or class (`ai.mjs` SYSTEM, "The passages are your only evidence") | prompt; runtime: citation numbers checked against the sources given (`src/citations.mjs`) | `tests/citations.test.mjs`, `evals/grounding-eval.mjs` (50 recorded cases, CI) | an invented fact without a citation number isn't caught at runtime |
| A2 | Scripture only from verse text given, exact King James wording with its reference (SYSTEM; RESEARCH: "Scripture comes only from read_scripture") | runtime: `src/verse-guard.mjs` fixes or removes a misquoted verse | `tests/verse-guard.test.mjs`; `scripts/eval-ask.mjs` verse check | none known |
| A3 | Doctrine as the library holds it; never other churches', scholars' or the world's doctrine as ours; never contradict the classes (SYSTEM, "What you stand on", first point) | prompt only | `eval-ask.mjs` banned phrases (e.g. "some scholars believe"); owner-approved answers (empty) | **no runtime check and no fidelity review**: the biggest gap; needs owner-approved reference answers and an owner-run review (MDLC WP3) |
| A4 | Keep the classes' language; never soften it; quote the classes' own words with the passage number (SYSTEM, "Keep the classes' language") | prompt only | owner-approved answers (empty) | as A3 |
| A5 | Name a teacher only on their exact, cited recorded words; never infer a teacher (SYSTEM, "A passage marked 'taught by'") | prompt; source metadata carries the teacher | `tests/ask-sources.test.mjs`, `tests/teachings.test.mjs` | a misattributed paraphrase isn't caught at runtime |
| A6 | The Bishops' and Deacons' teaching takes precedence (SYSTEM) | prompt; retrieval ranking lifts their passages (`ai.mjs`, ranking) | `tests/ai.test.mjs` | precedence in the written answer isn't checked |
| A7 | Honest about the edges: say what the passages don't cover; never fill a gap from general knowledge (SYSTEM, "Be honest about the edges"; RESEARCH) | prompt; runtime: coverage gate (`src/grounding.mjs`, `assessCoverage`) **in shadow** unless `ASK_COVERAGE_MODE=enforce` | `tests/grounding.test.mjs`, `tests/not-in-classes.test.mjs`; `eval-ask.mjs` gap-honesty check | coverage gate only logs today (owner decision to enforce) |
| A8 | Proper names, titles and acronyms exactly as the library has them (SYSTEM, "Preserve proper names") | prompt | `eval-ask.mjs` banned phrases (spelling and title checks) | eval is manual (MDLC WP3 puts it in CI) |
| A9 | Off-topic questions are declined in a sentence (SYSTEM, last point of "What you stand on") | prompt | `eval-ask.mjs` question set | no red-team set yet (MDLC WP3) |
| A10 | No model, provider or company names in answers, no "as an AI" (product rule) | eval only | `eval-ask.mjs` banned phrases | not checked at runtime |

## Sources, tools and the app

| Id | Rule (where it's stated) | Enforced by | Tested by | Gap |
|---|---|---|---|---|
| S1 | Library and tool text is data, never instructions (`grounding.mjs` `DATA_POLICY`, untrusted-data fencing) | runtime: fencing + control-pattern stripping (`src/grounding.mjs`) | `tests/grounding.test.mjs`, `tests/ai.test.mjs`, `tests/reader.test.mjs`, `tests/uploaded-pdf.test.mjs` | no red-team eval of injection through outside pages and PDFs (MDLC WP3) |
| S2 | Outside sources only from the owner's approved sites; never overrule the Scripture or the classes; never quote a verse from them (RESEARCH, "Outside sources") | runtime: whitelist (`src/source-policy.ts`, `outside_source` in `src/ask-tools.ts`) | `tests/preferred-outside-source.test.mjs`, `tests/retrieved-source-url.test.mjs` | "never overrule" is prompt only |
| S3 | Pictures only from a tool's own path (RESEARCH, "Pictures") | runtime: picture paths come from tools (`src/ask-tools.ts`, `src/ask-source-pictures.ts`) | `tests/ask-source-pictures.test.mjs` | none known |
| S4 | The assistant never changes the reader's data itself; changes need the reader's Confirm (`ai.mjs` APP, `propose_reminder_change`) | runtime: the tool only proposes a card (`src/agent.ts`) | `tests/assistant.test.mjs`, `tests/reminders.test.mjs` | none known |
| S5 | App answers only from `app_help`; never invent a screen or the reader's data (APP) | prompt; tools are the only source | `tests/app-features.test.mjs` | invented screens not checked at runtime |

## Privacy, consent and cost

| Id | Rule | Enforced by | Tested by |
|---|---|---|---|
| C1 | A paid provider gets a question only after the reader's consent for that provider | runtime: 428 `consent` (`src/ai.ts`, `src/providers.ts`) | `tests/providers.test.mjs`, `tests/app-ask.test.mjs` |
| C2 | Daily limits per reader and per address | runtime: `takeQuota` (`src/ai.ts`, `src/search-answer.ts`) | `tests/ask-ip-backstop.test.mjs`, `tests/session-limits.test.mjs` |
| C3 | Spending caps per answer and per day | runtime: USD caps (`src/research-policy.mjs`, `src/free-budget.ts`) | `tests/financial-integrity.test.mjs`, `tests/research-policy.test.mjs` |
| C4 | Logs and events keep no question or answer text and no Telegram ids | runtime: `src/privacy.mjs`, `src/ask-events.ts` | `tests/privacy.test.mjs`, `tests/ask-events.test.mjs`; `docs/PRIVACY.md` |

## Release gate (what a change must pass)

| Change | Must pass before it ships |
|---|---|
| A prompt in `bot/src/ai.mjs` or `DATA_POLICY` | unit tests + recorded grounding eval (CI); the live eval suite on staging once the owner OKs its budget (MDLC WP3); a prompt version bump and changelog line (MDLC WP1); owner Approve |
| A model id (`wrangler.jsonc` model vars, `shared/ask-models.json`, routing order) | as above, run for that model; the model added to the allowlist (MDLC WP2) |
| Routing (`src/ask-routing.ts`, `shared/ask-models.mjs`) | `tests/ask-routing.test.mjs`, `tests/ask-models.test.mjs`; the client copy (`ask-cyberjudah-telegram/src/lib/route-model.ts`) kept in step |
| Tools or outside-source whitelist | unit tests for the tool; the red-team set (MDLC WP3) |
| A library or index release | the eval suite on the new release; its release id stamped on answers (MDLC WP1) |
| This policy | owner review |

A rule whose "Enforced by" says **prompt only** can't be guaranteed by code. Until the owner-approved reference answers and a fidelity review exist (A3, A4), a prompt change that touches "What you stand on" or "How you write" needs the owner to read sample answers before it ships.

## Changelog

- `policy-v1` (2026-11-10): first version, written from the prompts and tests at `origin/main` d6a915b9.
