# The backup model answers only with the reader's agreement to its provider

- When Claude can't answer, `askStream` and `ask()` fall back to the backup model on Workers AI. Before this change the question and conversation went to Workers AI even when the reader had agreed only to Claude's provider (Anthropic). That broke the consent promise (Apple 5.1.2(i), Telegram Bot Developer Terms 4.3; OWASP LLM02).
- Now the backup writes an answer only if the reader agreed to its provider (`backup-answer.ts` `mayUseBackup`). Without that agreement nothing is sent. `askStream` ends with `busy` when Claude was busy, or `unavailable` when there is no access; `ask()` returns `unavailable`.
- Fixed sentences that no model writes, such as "nothing found" or "not in the classes", are unchanged. The Mini App path already checked the fallback provider's consent.
