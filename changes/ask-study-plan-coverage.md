# Ask: a research plan and coverage checklist (Deep Study step 1)

- For a question with more than one part, the model first lists the parts the reader asked (`plan_research`): at most 8, each a short restatement of the reader's own words. A part with a quotation, Scripture the reader did not name, or more than 200 characters is dropped. A part may list Scripture it needs read in full.
- After every reading, the server works out each part's status from the passages read and the verses actually read: covered, partial or missing. It tells the model which parts are still open, as its own words next to the tool results. If the model writes the answer with a part still open, it is sent back once to research it or to say it was not found.
- Why research ended is recorded: every part `covered`, a limit (`rounds`, `deadline`, `budget`), or `not_found`.
- A question that names Scripture is tracked the same way, so a chapter it names counts as read only when every verse was read.
- New fields on the finished `/api/ask` stream line, only for a tracked question, optional and additive:
  - `plan: { parts: [{ id, ask }] }`;
  - `coverage: { parts: [{ id, status, sources }], complete, stopped }`, with at most 20 sources per part;
  - when a part is not covered, `partial: true` and `unfinished: [{ id, ask }]`.
  A `plan` event is also streamed when the parts are listed. The same fields are saved with the answer in the chat, so a reloaded chat shows them. They go wherever the chat goes: deleted with it, and in the data export.
- One answer registers at most 100 sources (was 256), the Mini App's limit per answer, so a citation never points at a source it dropped.
