# Search by meaning

`GET /api/search/semantic?q=<text>&kinds=verse,class,study,law,case,precept&limit=20`
returns a bare array of the Mini App's existing keyword Hit fields plus numeric `score`.
The result count is capped at 30. Unknown kinds, malformed limits and queries outside 2–400
normalized characters (also capped at 1,600 UTF-8 bytes) return 400. Authentication runs first:
the existing Telegram launch proof, browser session or linked Firebase account is required.

The endpoint calls the existing `@cf/baai/bge-m3` embedding model and the existing
`cyberjudah-teachings` Vectorize binding directly. It does not call `retrieve()`, a generation
model or a reranker, and does not blend keyword scores into cosine scores. Each cache miss costs
one embedding and one vector query. There is no model-generated text, new teaching or image.

Scripture coordinates select the public library chapter and its full exact KJV verse, including
short verses and the Apocrypha. Class hits include spoken, Captains and History chunks, their
recorded start in seconds, and a verbatim excerpt up to 500 characters. Spoken chunks shorter than 20 words are omitted; this filter never excludes a short hydrated verse. Each recording keeps its
best-scoring moment. Class and study pages must still be listed in the public notes index; a URL-less class needs a recorded video in that index. Teacher/date come only from published metadata; conflicting recorded names
remain unnamed. Law entries, case metadata and precept counts hydrate from their existing public
records. Only keyword-Hit fields are returned, never arbitrary vector metadata or private chats.

Admission permits 10 requests/person/minute and 200/person/day, including cache hits. A
per-IP minute ceiling (`client-ip.ts` `NETWORK_PER_MINUTE`): 600 for a reader's own address that the
Mini App's Worker signed, leaving room for a class or carrier on one network, and 6,000 otherwise,
since every unsigned Mini App reader arrives as the one proxy address. IP keys
use a purpose-specific keyed hash; IP rejection does not spend a person's counter. Existing D1
quota cleanup removes old counter rows. Public results are edge-cached for five minutes by a
hash of normalized query, selected kinds and limit; authentication and admission still run on
every request. Queries and raw provider errors are not logged. The response is private/no-store.
The embedding and retrieval work has a 12-second deadline and receives the request abort signal.

The minimum cosine score is initially 0.55. Empty arrays are valid. This cutoff is an operational
candidate filter, not a measured relevance guarantee; no paid/live evaluation was run. Vectorize
queries returning full metadata currently allow [at most 50 candidates](https://developers.cloudflare.com/vectorize/reference/client-api/).
The endpoint filters those candidates by kind locally, so a kind can have no returned hit even
when relevant material exists elsewhere. At most 32 public-record reads keep each request bounded and can also reduce the returned set.
It reports hits only and never claims full coverage.
The keyword search remains available and the Mini App already tolerates backend outages.

An unavailable embedding/index or a deadline returns `503 {"error":"semantic-unavailable"}`.
Missing or failed individual public records are omitted while other hits remain available; no replacement wording is invented. Those partial responses are not cached. Hydration reads run in bounded parallel batches with shared memoization. Tiny cosine rounding excess (up to 0.000001 above one) is clamped to one; larger invalid scores are dropped.

The prerequisite read-only audit found approximately 2.62 million vectors, 1,024 dimensions and
cosine distance, against 2,633,121 raw pipeline inputs. Stable-ID deduplication explains the small
gap within the dashboard's rounding. The coordinator lifted the gate without a repair or
re-embedding. This change creates no index or metadata index, changes no binding, and writes no
vectors. Tests use local recorded fixtures only. Merging `bot/src` enters the existing Ask Worker
release path; the coordinator and owner retain merge/deployment control.
