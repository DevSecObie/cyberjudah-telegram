# Search answers

The Search screen uses `SEARCH_AI_MODEL` for one answer from the retrieved CyberJudah library
passages. It does not enable Google web search, research tools or paid reader requests. Ask's
model picker and pricing are unchanged.

Production and staging use `@cf/meta/llama-3.1-8b-instruct-fp8`, eligible for Cloudflare's
Workers AI free allowance. `SEARCH_AI_FREE_ONLY=on` rejects third-party model settings before
retrieval, even when the reader has given consent. There is no paid fallback and no AI Gateway
credit purchase is needed for Search. The owner requested free models only on October 8;
Google is not enabled. Removing `SEARCH_AI_MODEL` uses `ASK_FREE_MODEL` with the same guard.

## Quotas and release verification

Cloudflare provides 10,000 free neurons per UTC day, shared by the account. Its Workers Paid
plan bills usage above that allowance. The app's existing dollar-equivalent admission budget
(`ASK_FREE_DAILY_USD_CAP`, $0.11 per Worker per day) limits Search and free Ask together; it is
not an account-wide Cloudflare billing limit. Other Workers, embeddings, staging and Ask admin
requests may also consume the account's allowance. Keep account usage within the provider's
free allowance; this application counter alone cannot promise a zero provider bill.

Search admins now share the same daily admission limit as other readers. Every answer has a
per-request budget (`ASK_FREE_MAX_USD`, $0.05), one model call and a bounded output. Missing
usage or provider failure retains the full reservation; unavailable storage blocks new work.
When the allowance is exhausted, ordinary search results remain available without an AI answer.

Production and staging run `bot/scripts/verify-release.mjs` after deployment. It verifies the
configured hosted model returns an answer with library citations, under the normal reader
allowance. No reader balance is charged and no Telegram message is sent. Request/response
payload logging is disabled with `collectLog: false`.

The optional third-party adapter remains tested but disabled. Enabling it requires a future
owner decision, `SEARCH_AI_FREE_ONLY=off`, provider funding and explicit reader consent;
setting a paid model name alone cannot enable it.

`SEARCH_AI_DAILY_LIMIT` still caps uncached answers per reader (20/day). A reader never needs
an Ask balance for Search. Cached answers live for two minutes and are separated by model;
consent is checked before the cache. Browser responses use `private, no-store`.

## Documentation checked

- [Cloudflare AI Gateway Workers bindings](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/):
  third-party `env.AI.run()` calls, Unified Billing, BYOK precedence and `collectLog`.
- [Workers AI pricing and free allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/).

Local tests use a fake AI binding and real SQLite-backed D1. Staging and production deploys
also run `bot/scripts/verify-release.mjs`: it checks the app and reader shells, database health,
unsigned request rejection, a cited answer from the configured provider, and consent before
and after caching. It signs the existing synthetic test reader and makes at most one provider
request per run, under the normal free-answer allowance; it sends no Telegram messages and
does not touch a real reader's balance. Missing gateway funding, exhausted allowance or an
uncited answer fails that deployment's verification step. A failed verification after upload
does not automatically roll the Worker back. Review the run before calling the release ready.
