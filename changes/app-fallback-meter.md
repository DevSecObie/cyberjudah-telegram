# Ask: a refused fallback gives back only what Claude cannot have spent

- When Claude fails for a signed-in reader (`answerAppAgent`), or runs out of its reservation before writing, the free model answers instead. It does so only with the reader's agreement to its provider. The meter was settled as "backup", keeping Claude's whole reservation, before that agreement was checked. A reader who had agreed only to Anthropic got "consent", yet up to the per-answer maximum stayed counted against Claude's daily pool for readers.
- Now one helper (`fallBack`) decides first, using the reader's model list and agreement that the follow-up call checks. Without the agreement, nothing more is sent, the reader's draft is cleared, and the reader gets "consent" as before. The meter then settles as follows:
  - Claude refused outright with a 4xx (rate limited, out of funds, key refused; `providers.ts` `claudeRefusedUnbilled`, the same rule as the agent's usage accounting): only what was reported is counted, and the rest goes back to the pool.
  - A server error (529 overloaded included), a timeout or a lost connection: the whole reservation is kept, because tokens may already have been billed and the SDK may have retried an earlier failure.
  - Claude ran out of its reservation: the whole reservation is kept, because it was spent.
- A fallback that runs still keeps the whole reservation, since its cost is not reported.
- askStream (#603) follows the same rule: a refused backup releases the free reservation only after a 4xx from Claude (t1v).
