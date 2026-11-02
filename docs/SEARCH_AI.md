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

### Claude for signed-in app readers

The owner chose (2026-10-31) to let every signed-in app reader ask Claude, paid from the owner's
Anthropic console: Haiku (`CLAUDE_MODEL_LIGHT`) answers by default and Sonnet (`CLAUDE_MODEL`)
answers deep questions. It is off until `ASK_CLAUDE_FOR_READERS` is `"on"`, the
`ANTHROPIC_API_KEY` secret is set and `ASK_CLAUDE_DAILY_USD_CAP` is above zero. Each answer
reserves `ASK_CLAUDE_MAX_USD` ($0.20) against Claude's own daily cap ($5.00 suggested), kept
apart from the free models' allowance under the `claude:` day prefix. The reader's daily limit
and the IP limit still apply. Past the cap, or when Claude cannot answer, the free model answers.
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

## Ask in the CyberJudah app

`POST /api/app/ask` (`bot/src/index.ts`, `answerApp` in `bot/src/ai.ts`) is Ask for the iPhone and Android app. It accepts any verified Firebase sign-in from project `cyberjudah-app` (`bot/src/app-identity.ts`), linked to Telegram or not; anonymous sign-ins are refused as everywhere else. It answers on the free model only, in one bounded call from the library passages, and returns the answer with the sources it cited. No balance is read or held, nothing is bought and no chat is saved on the server.

The app sends the conversation so far (`history`), so a follow-up such as "why?" or "who was he?" is searched together with the question before it (`retrievalText` in `bot/src/ai.mjs`). Verses the question names ("Deuteronomy 28:68") are read from the King James text and given to the model first, so it can quote them exactly. The response carries `followups`: up to three next questions the reader might ask. A greeting or a thank-you is answered briefly even when the library has nothing for it; a real question with no passages is told so, with no model call.

Limits: 100 answers a day per account, counted under a keyed hash of the Firebase UID (`ask_app:` in `rate_counts`); the per-IP Ask limit (`ASK_IP_DAILY_LIMIT`); the per-IP Bearer rate limit (`FIREBASE_SESSION_LIMIT`); and the shared daily free-answer budget, which every answer reserves before any model work. The reader must agree to the free model's provider first: without it the server answers 428 `consent` with the provider's name, and nothing is sent to the provider.

