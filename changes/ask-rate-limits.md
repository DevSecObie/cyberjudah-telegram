# Limits on "similar passages" and on answer reports (OWASP LLM10)

- `/api/similar` embeds the query and reranks the passages (model calls) but had no limit. It now has the same limits as the semantic search, on its own counters, checked before any model call: per address per minute (a signed reader's address, or the connecting one), and per person 10 a minute and 200 a day (`semantic-search.ts` `takeSearchQuota`). A query too short to search spends no allowance.
- App Ask's answer reports (`/api/app/ask/report`) were limited per account (10 a day). Each report may drop a cached answer, and accounts are cheap to make, so they are now also limited per address:
  - a reader's own signed address: 30 a day;
  - an unsigned address, which may be the Mini App relay shared by every reader: 60 a minute, so it can never be shut for the day.
- Search answers (`/api/search/answer`, ASK-POLICY C2) had only a per-reader limit, and the release check's exempt reader and admins skipped even that. They now also have a per-address limit for every reader: a reader's own signed address 100 a day, an unsigned one (possibly the shared relay) 300 a minute. A cached answer still costs nothing and counts nothing. The day's free budget stays the cost ceiling behind both.
- Both per-address limits share one helper (`bot/src/address-quota.ts`). The reader's own count comes first, so a reader already refused spends none of the address's allowance and cannot use it up for everyone behind it. A refused address gets 429 `limit` with `Retry-After`. An IPv6 address is counted by its /64, so moving inside one allocation gains nothing.
- Only keyed hashes of addresses are kept in the counters, never the addresses. `docs/OPERATIONS.md` and `docs/operations/ask-ai-pipeline.md` list the new counters.
