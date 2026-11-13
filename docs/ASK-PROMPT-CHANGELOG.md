# Ask prompt changelog

Every Ask answer names what it was made with (`bot/src/ask-versions.ts`). The names appear in three places:

- the `versions` field on the answer's finished line;
- its `ask_events` row (`prompt_version`, `corpus_release`, `model`);
- its answer-cache key.

A change to a prompt or to the library starts new cache keys, so no answer kept from before the change is given after it.

| Field | What it names | Where it comes from |
|---|---|---|
| `prompt` | The prompt ids joined with dots, e.g. `system-v1.research-v1.app-v1.data-policy-v1.answer-v1.tools-v1`. A study-card answer adds `+` and its study release (`app-study-release.ts`). | `PROMPT_IDS` in `ask-versions.ts` |
| `policy` | The answer policy the answers are checked against (`docs/ASK-POLICY.md`). | `ANSWER_POLICY` |
| `corpus` | `<library>/<index>`, e.g. `lib-3226601ac088/idx-20261110T041259Z-ab12`. A part reads `lib-unknown` or `idx-unknown` until its script has written a mark. If the marks can't be read (D1 failing), the corpus is `lib-unavailable/idx-unavailable` and the answer cache is neither read nor written for that answer. A failed read is retried after ten seconds. | D1 `corpus_marks`: `scripts/load-search.mjs` writes the library mark (the first 12 hex characters of the SHA-256 of the search index it loaded) after the blue-green switch. `scripts/embed.mjs` writes the index mark (the run's UTC second plus a short random tail) after any run that wrote or removed vectors, even if the run failed partway. Each Worker isolate re-reads the marks at most once a minute. |
| `model` | The model that wrote the answer. It is `approved` for an owner-approved answer and `none` for a fixed sentence that no model wrote. | The answer path |

## Changing a prompt

`bot/tests/ask-versions.test.mjs` pins the SHA-256 of each prompt's text next to its id. When a prompt's text changes, the test fails until you do all three of these:

1. Bump that prompt's id in `PROMPT_IDS` (for example `system-v1` to `system-v2`).
2. Put the new text's SHA-256 next to it. The failing test prints which prompt changed.
3. Add a row below: the date, the new id, what changed, and the PR.

Describe the change; do not copy prompt text here. The text is in git.

If two open PRs change the same prompt, the one that merges second merges main in and takes the next number.

## History

| Date | Id | Prompt | Change | PR |
|---|---|---|---|---|
| 2026-11-10 | `system-v1` | `SYSTEM` (`bot/src/ai.mjs`) | First versioned id. This is the text that was live as cache revision `depth-quote-citations-source-links-20261107`. | WP1 traceability |
| 2026-11-10 | `research-v1` | `RESEARCH` (`bot/src/ai.mjs`) | First versioned id; the text as it was. | WP1 traceability |
| 2026-11-10 | `app-v1` | `APP` (`bot/src/ai.mjs`) | First versioned id; the text as it was. | WP1 traceability |
| 2026-11-10 | `data-policy-v1` | `DATA_POLICY` (`bot/src/grounding.mjs`) | First versioned id; the text as it was. Its own marker line is `ASK_UNTRUSTED_DATA_POLICY_V1`. | WP1 traceability |
| 2026-11-10 | `answer-v1` | `buildPrompt` (`bot/src/ai.mjs`), as built for placeholder inputs, including the plain citation guide | First versioned id; the text as it was. | WP1 traceability |
| 2026-11-10 | `tools-v1` | `TOOL_DEFS` (`bot/src/agent.ts`): every research tool's name, description and input schema | First versioned id; the definitions as they were. | WP1 traceability |
| 2026-11-13 | `answer-v2` | `buildPrompt` (`bot/src/ai.mjs`) | The reader-voice rule (`READER_VOICE`, `bot/src/grounding.mjs`) now follows the data policy: answers never say "the dataset". Cache revision `reader-voice-v1`. | #615, versioned in #600 |

## Known limits

- The study-card prompts (`app-study-*.ts`) are versioned as a whole by `APP_STUDY_RELEASE.version`, not one by one.
- A manual search rollback (`bluegreen-load.mjs` `rollback()`) does not rewrite the library mark. Until the next load, answers name the load that was rolled back. Run the next load, or reset the mark by hand.
- Every night the embed run changes the index (new transcript chunks), it starts new cache keys, so in practice a kept answer lasts until the next index change rather than a full week. That is the cost of "a corpus change never serves an old answer". If the cost matters, the owner can choose to key the cache on the library mark only.
- A long answer reads the corpus once for its cache key and again for its `versions` stamp. If a new mark lands in between, the two can differ for that one answer.
- Only the texts listed in `PROMPT_IDS` are pinned. Other text the model reads, such as tool-result notices inside `agent.ts` and the backup prompts, isn't pinned yet. Change those with care, or move them into a pinned constant.
- On a cold isolate, the `ask_events` column check (`PRAGMA table_info`) costs one extra D1 query before that isolate's first event.
- Model ids are the provider's names (aliases). Pinned provider snapshots are part of the model allowlist work (WP2).
