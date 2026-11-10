# Ask answers name what they were made with

- Each finished answer line now carries `versions: { prompt, policy, corpus, model }`. This applies to the Mini App's `/api/app/ask` (streamed and JSON) and to `/api/ask` (web and Telegram). `model` is the model that actually wrote the answer: `approved` for an owner-approved answer, `none` for a fixed sentence.
- `ask_events` gets two columns, `prompt_version` and `corpus_release`. An existing table gets them added on first use, and older rows keep them empty. As before, no question, answer or reader is stored.
- The answer cache key now includes the prompt version and the corpus release. A changed prompt or library never serves an answer kept from before the change. On deploy, every kept answer starts fresh once, the same as a prompt revision did before.
- Prompts have ids (`bot/src/ask-versions.ts`) with their text's SHA-256 pinned beside them. A test fails if a prompt changes without a new id and a line in `docs/ASK-PROMPT-CHANGELOG.md`.
- `scripts/load-search.mjs` (each deploy) and `scripts/embed.mjs` (nightly, only when the index changed) each write one row in D1 `corpus_marks`. The Worker reads those rows at most every five minutes.
