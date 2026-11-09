# Ask: a research plan and coverage checklist (Deep Study step 1)

- For a question with more than one part, the model first lists the parts the reader asked (`plan_research`): at most 8, each a short restatement of the reader's own words. If any part has a quotation, Scripture the reader did not name, or more than 200 characters, the whole plan is refused and the model is told why, so no part of the question is silently dropped. After three refusals the question stays one part. A part may list Scripture it needs read in full.
- After every reading, the server works out each part's status from the passages read and the verses actually read: covered, partial or missing. It tells the model which parts are still open, as its own words next to the tool results. If the model writes the answer with a part still open, it is sent back once to research it or to say it was not found, only while at least half the budget is left. The answer it had written is kept: if the extra round writes nothing, or a time or budget limit ends it, that answer is used.
- Why research ended is recorded: every part `covered`, a limit (`rounds`, `deadline`, `budget`), or `not_found`.
- A question that names Scripture is tracked the same way, so a chapter it names counts as read only when every verse was read. Verses already found before or during research count as read.
- Every tool-capable research format uses the same plan and checklist. Source-only models still perform no research and send none of these fields.
- When an answer is replaced by "not in the classes", every part is `missing` and `stopped` is `not_found`.
- New fields on the finished `/api/ask` stream line, only for a tracked question, optional and additive:
  - `plan: { parts: [{ id, ask }] }`, where each `id` is a string ("p1" to "p8") unique within the plan, and every coverage and unfinished `id` is one of them;
  - `coverage: { parts: [{ id, status, sources }], complete, stopped }`, with at most 20 sources per part, each one a source the answer cites;
  - when a part is not covered, `partial: true` and `unfinished: [{ id, ask }]`.
  A `plan` event is also streamed when the parts are listed. The same fields are saved with the answer in the chat, so a reloaded chat shows them. They go wherever the chat goes: deleted with it, and in the data export.
- One answer registers at most 100 sources (was 256), the Mini App's limit per answer, so a citation never points at a source it dropped.
- Research feedback stays outside untrusted tool output in every wire format. An incomplete draft can be sent back once, within the existing round/time/spending limits, and is retained if that extra round ends blank, times out, or runs out of budget.
- The browser contract test includes the new planning tool, fixing the pending Ask research check rather than disabling it.
- A researched part is still partial if the answer omits its topic or its supporting citation. This is a conservative word-and-citation check, not proof of semantic completeness; short answers remain valid.
- Offline multipart evaluation reuses the recorded public extracts and explicit claim/evidence annotations. Omitting a subquestion, removing citations or adding unsupported prose fails even when other citations are valid. These are fixture checks, not live quality scores or a substitute for owner-reviewed interpretive answers.
