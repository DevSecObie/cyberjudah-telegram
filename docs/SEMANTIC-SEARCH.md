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
recorded start in seconds, and a verbatim excerpt up to 500 characters. Each recording keeps its
best-scoring moment. Teacher/date come only from published metadata; conflicting recorded names
remain unnamed. Law entries, case metadata and precept counts hydrate from their existing public
records. Only keyword-Hit fields are returned, never arbitrary vector metadata or private chats.

Admission permits 10 requests/person/minute and 200/person/day, including cache hits. A coarse
6,000/IP/minute ceiling leaves room for shared mobile networks and the Mini App proxy. IP keys
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
Missing or invalid individual public records are omitted; no replacement wording is invented.

The prerequisite read-only audit found approximately 2.62 million vectors, 1,024 dimensions and
cosine distance, against 2,633,121 raw pipeline inputs. Stable-ID deduplication explains the small
gap within the dashboard's rounding. The coordinator lifted the gate without a repair or
re-embedding. This change creates no index or metadata index, changes no binding, and writes no
vectors. Tests use local recorded fixtures only. Merging `bot/src` enters the existing Ask Worker
release path; the coordinator and owner retain merge/deployment control.
