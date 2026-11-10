# Limits on "similar passages" and on answer reports (OWASP LLM10)

- `/api/similar` embeds the query and reranks the passages (model calls) but had no limit. It now has the same limits as the semantic search, on its own counters, checked before any model call: per address per minute (a signed reader's address, or the connecting one), and per person 10 a minute and 200 a day (`semantic-search.ts` `takeSearchQuota`).
- App Ask's answer reports (`/api/app/ask/report`) were limited per account (10 a day). Each report may drop a cached answer, and accounts are cheap to make, so they are now also limited per address: 30 a day for a signed reader's address, 300 for an unsigned one, which may be shared.
- Only keyed hashes of addresses are kept in the counters, never the addresses.
