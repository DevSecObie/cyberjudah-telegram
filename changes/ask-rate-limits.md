# Limits on "similar passages" and on answer reports (OWASP LLM10)

- `/api/similar` embeds the query and reranks the passages (model calls) but had no limit. It now has the same limits as the semantic search, on its own counters, checked before any model call: per address per minute (a signed reader's address, or the connecting one), and per person 10 a minute and 200 a day (`semantic-search.ts` `takeSearchQuota`). A query too short to search spends no allowance.
- App Ask's answer reports (`/api/app/ask/report`) were limited per account (10 a day). Each report may drop a cached answer, and accounts are cheap to make, so they are now also limited per address, checked first:
  - a reader's own signed address: 30 a day;
  - an unsigned address, which may be the Mini App relay shared by every reader: 60 a minute, so it can never be shut for the day.
- Search answers (`/api/search/answer`, ASK-POLICY C2) had only a per-reader limit, and the release check's exempt reader and admins skipped even that. They now also have a per-address limit for every reader, checked before the reader's own count: a reader's own signed address 100 a day, an unsigned one (possibly the shared relay) 60 a minute. A cached answer still costs nothing and counts nothing.
- Only keyed hashes of addresses are kept in the counters, never the addresses. `docs/OPERATIONS.md` and `docs/operations/ask-ai-pipeline.md` list the new counters.
