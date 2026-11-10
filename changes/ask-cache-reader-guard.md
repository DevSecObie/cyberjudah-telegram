# The shared answer cache never keeps an answer made from a reader's own data

- `runAgent` now reports `readerData` when a tool read or acted on the signed-in reader's own data: `my_saved_chats`, `my_reminder` or `propose_reminder_change`. The app's agent answer (`answerAppAgent`) is not kept in the shared answer cache when it is set.
- This is hardening (OWASP LLM02, threat model G7). Today the cached path runs the agent with no reader, so those tools refuse before reading anything. The guard stops a later change from letting one reader's saved chats or reminder reach another reader through the cache.
