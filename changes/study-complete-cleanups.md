# Study answers: complete when every part is covered; coverage checked once

- An answer whose every part is covered, but whose research a limit stopped (rounds, budget, deadline), was marked `partial` with an empty `unfinished` list. Now it is complete. It keeps its stop reason, and `cut` says it was cut short. It is still never kept in the cache (`answer-cache.ts` `incomplete`). (`study-plan.ts` `studyFields`; t1v/t18 items 3 and 6.)
- `answerAppAgent` no longer repeats the cache's own completeness rule before `keepAnswer`. `keepAnswer` refuses cut, partial and unfinished answers itself (item 7).
- The answer check (`verifyAnswer`) runs once, on the final text in `studyFields`. It no longer also runs on the draft when the agent finishes (`agent.ts`). The nudges during research still check the draft they see (item 8).
- The research's own coverage carries the limit that ended it (`limit`, internal and never sent). When the final text leaves a part open, the checked coverage names that limit instead of "not_found".
- A draft the agent sends back for more research is checked once (`reviewNote`), not twice.
- A cut answer whose every part is covered reports `complete: true` with `cut: true` and its limit as `stopped`. Readers should treat `cut` as "not finished in full".
