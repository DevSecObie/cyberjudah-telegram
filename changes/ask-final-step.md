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
