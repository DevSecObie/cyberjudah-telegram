# Mini App Ask: a refused free fallback gives back what Claude did not spend

- When Claude fails for a signed-in reader (`answerAppAgent`), or runs out of its reservation before writing, the free model answers instead. It does so only with the reader's agreement to its provider. The meter was settled as "backup", keeping Claude's whole reservation, before that agreement was checked. A reader who had agreed only to Anthropic got "consent", yet up to the per-answer maximum stayed counted against Claude's daily pool for readers.
- Now the agreement is decided first, at both fallback sites (`fallbackRefusal`). Without it, nothing more is sent, the reader's draft is cleared, and the reader gets "consent" as before. The meter then settles as follows:
  - Claude refused before writing (rate limited 429, overloaded 529, out of funds, key refused; `claudeRefusedUnbilled`): only what was reported is counted, and the rest of the reservation goes back.
  - A server error or a lost connection: the whole reservation is kept as before, because tokens may already have been billed.
  - Claude ran out of its reservation: what Claude reported spending is counted.
- A fallback that runs still keeps the whole reservation, since its cost is not reported.
- askStream (PR #603) is aligned with this: a refused backup releases the free reservation only when Claude refused before writing, and keeps it whole after a server error or lost connection (t1v).
