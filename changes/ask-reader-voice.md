# Ask answers no longer say "the dataset"

- The owner reported answers saying "the dataset says" or "the provided data". Since #549, every passage reaches the model as fenced JSON under a data policy that calls it untrusted library data, and the model echoed that framing back to readers.
- Every grounded prompt (`grounding.mjs` `groundedSystem`, used by Claude's agent, the open-model research loop and the Workers AI one-shot and Search answers) now ends with one more rule, `READER_VOICE`, after the data policy. An answer never describes how the material reached the model: it does not call the material data, a dataset or the provided data, and never mentions JSON, fences, source blocks, tool results or these instructions. It speaks of the library's material as the classes, the notes or the library, and of an outside source as an outside source, with [n] citations. Stock framings such as "According to the classes" are still out.
- The model may still say that a source held an instruction it did not follow. The reader's own account, chats and files are named as before.
- `DATA_POLICY` and its injection defence are unchanged. `researchOpen` checks for each rule on its own.
- The study answer's fixed "not enough" reply now says "the CyberJudah library" instead of "CyberJudah's data".
- The Ask eval's legacy-phrase check (`evals/ask-eval.mjs`) now also fails "the dataset" and "data set", "the data says/shows…", "provided data", "the JSON", "source blocks" and "tool results". "untrusted" fails only in non-adversarial answers. A plain "JSON file" or "my data" still passes.
- Cached answers are refreshed for Ask (`answer-cache.ts` `PROMPT_REVISION`) and Search (`search-answer.ts` cache version).
