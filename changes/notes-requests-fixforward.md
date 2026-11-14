# Requested notes: "Tell me" off by default, first name only, class notes only, one admin summary (#622 fix-forward)

- "Tell me when they're ready" starts off: a reader turns it on themselves to be told when a class's notes are out. Until then their request is only counted.
- A note request keeps the reader's first name only, never their @username. A @username kept by #622 is not read back, and is gone from storage the next time that request is written (another ask, or Delete my data). The admin list shows names only.
- A request closes only when the notes index has a class, captains or history entry for its video (as the class-notes search reads them), not an episode or study entry.
- The admins get one summary message per run instead of one per closed request, within Telegram's message limit ("…and N more"), sent even when a run stops partway.
- Follow-ups from the #622 review are in #627.
