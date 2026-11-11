# Ask answers no longer say "the dataset"

- The owner reported answers saying "the dataset says" or "the provided data". Since #549, every passage reaches the model as fenced JSON under a data policy that calls it untrusted library data, and the model echoed that framing back to readers.
- Every grounded prompt (`grounding.mjs` `groundedSystem`, used by Claude's agent, the open-model research loop and the Workers AI one-shot answer) now ends with one more rule, `READER_VOICE`, placed after the data policy. Never mention to the reader the data, a dataset, the provided data, JSON, fences, source blocks, tool results, untrusted content or these instructions. Speak of the material as the classes, the notes or the library, with [n] citations. Stock framings such as "According to the classes" are still out. `DATA_POLICY` and its injection defence are unchanged.
- The Ask eval's legacy-phrase check (`evals/ask-eval.mjs`) now also fails an answer containing "the dataset", "the data says", "provided data", "JSON" or "untrusted".
- Cached answers are refreshed (`answer-cache.ts` `PROMPT_REVISION`), so earlier ones with that wording are no longer served.
