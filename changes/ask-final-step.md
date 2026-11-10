# Every Ask answer passes one final step

- New `bot/src/answer-final.ts` `finalAnswer()`. Every answer path in `ai.ts` uses it before a reader sees the answer, before it is saved, and before it is kept in the cache:
  - `askStream`, both the research path and the backup;
  - `ask`, agent and backup;
  - the Mini App's `answerApp` (one-shot and study);
  - `answerAppAgent`;
  - every owner-approved answer.
- **Scripture:** every quoted verse is checked against the King James text (the existing verse guard). Before this, the guard ran only in `ask()` and the one-shot app answer, so Mini App agent answers and `/api/ask` answers could misquote unchecked.
- **Pictures:** a markdown image is kept only if its address is exactly a `Picture: <path>` that a tool or library passage gave in that answer's own run. Any other image becomes its alt text. Raw `<img>` tags and reference-style images are removed. This closes an exfiltration channel where an injected image URL carries data out.
- A reader who watched the draft stream in gets the final text: `reset`, then the final answer as one `delta`. Nothing changes when the draft had no images and no quotes.
- `bot/tests/answer-final.test.mjs` lists every answer path in `ai.ts`. Each is a final answer, a fixed sentence or an approved answer, so a new path has to be classified on purpose.
- **Streams guarded as they go:** in `askStream` (research and backup), `answerAppAgent` and the Mini App's bounded and study answers, every delta passes `guardedStream`. From a `!` or `<` to the end of its line, text is held until it has been checked, so an outside image never renders in the live draft. At the end, `settle` replaces the draft with the final text only when it differs or something was held back.
- **Cached answers** go through the final step again when they are given, which covers answers kept before this change.
- **Owner-approved answers** trust their own app pictures (still only the app's picture files). The check is kept per answer for 10 minutes.
- **Tool evidence** keeps only each result's `Picture:` lines instead of the first 50,000 characters, so a picture late in a long result is never lost.
- Titled, empty and reference-style images become their alt text.
- OWASP: LLM09 (misinformation: verse check), LLM05 (improper output handling: images and HTML), LLM02 (sensitive information disclosure: image exfiltration).
