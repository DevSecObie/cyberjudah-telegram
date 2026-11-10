# Mini App Ask: a refused free fallback gives Claude's reservation back

- When Claude is busy for a signed-in reader (`answerAppAgent`), the free model answers instead, but only with the reader's agreement to its provider. The meter was settled as "backup", keeping Claude's whole reservation, before that agreement was checked. A reader who had agreed only to Anthropic got "consent", yet up to the per-answer maximum stayed counted against Claude's daily pool for readers.
- Now the agreement is decided first: without it, Claude's meter settles as "empty" (only what was really spent is counted), nothing more is sent, and the reader gets "consent" as before. A fallback that runs still keeps the whole reservation, since its cost is not reported.
- Same order as the askStream fix in #603 (t1w's QA finding there).
