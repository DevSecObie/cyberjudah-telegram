# Ask fallback: Claude's meter settles after the backup has run (#605 follow-up)

- When Claude fails and the reader has agreed to the backup's provider, Claude's meter used to settle as "backup" before the backup ran. "backup" keeps Claude's whole reservation, so if the backup then wrote no answer, a reservation Claude never billed stayed counted:
  - Mini App (`answerAppAgent` `fallBack`): the free model's day budget was paused, it hit a limit, or it failed.
  - Telegram/web (`askStream`): there were no passages to answer from (the reader gets "busy"), the question was outside the classes, or the backup wrote nothing or failed.
- Now the meter settles once the backup's outcome is known. It settles as "backup" (whole reservation kept) only when the backup writes an answer, as before. The fixed "not in the classes" sentence counts as no answer, since no model wrote it. Otherwise it settles by Claude's own refusal, by the same rule as #605: after a 4xx (`claudeRefusedUnbilled`) Claude billed nothing and the reservation goes back; after a server error, a timeout or a lost connection it is kept whole.
- A free retry in the Mini App that throws is settled once and answered as "unavailable", so no second `ask_usage` line is logged for it. A settle that fails after the free model has answered is logged, and the answer is still returned (the reservation stays held, never reused).
- Not changed: when the backup does write an answer, Claude's whole reservation is still kept (#605's tested rule). Claude's hold now stays reserved while the Mini App's free retry runs.
- OWASP LLM10:2025 Unbounded Consumption (the shared daily pools count only what may have been spent).
