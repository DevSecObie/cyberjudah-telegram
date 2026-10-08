# Search answers

The Search screen uses `SEARCH_AI_MODEL` for one answer from the retrieved CyberJudah library
passages. It does not enable Google web search, research tools or paid reader requests. Ask's
model picker and pricing are unchanged.

Production and staging retain `@cf/meta/llama-3.1-8b-instruct-fp8` until the gateway is funded.
The Google integration supports `google/gemini-2.5-flash-lite`, already in the pinned, priced
catalog in `shared/ask-models.json`. The October 8 live staging check reached the gateway but
was refused with `2021: Insufficient AI Gateway credits`; Google is not advertised as live.
Only known Google chat models and Cloudflare plain/chat
models are accepted. An unknown or unsupported setting disables the answer instead of silently
choosing another paid provider. Remove `SEARCH_AI_MODEL` to return to `ASK_FREE_MODEL`.

## Owner setup and release verification

1. In the Worker's Cloudflare account, open **AI → AI Gateway → default** (or the gateway named
   by `AI_GATEWAY`). Confirm that Unified Billing is enabled and has credit available for
   third-party calls. The existing `AI` binding authenticates the request; no Google key needs
   to be added to the app or to this repository. If a Google BYOK key is already stored under
   the gateway's `default` alias, it takes precedence and Google bills that key instead.
2. After funding, set `SEARCH_AI_MODEL` to `google/gemini-2.5-flash-lite` in both the production
   and `env.staging.vars` sections of `bot/wrangler.jsonc`, and match `EXPECTED_SEARCH_MODEL`
   in the staging and deployment workflows. No extra Worker secret or client variable is required for this binding
   path. Existing secrets for other features stay as configured.
3. After an authorized staging deployment, submit a Search query with reliable library results.
   Before accepting, confirm ordinary results appear and Google has not received a model call.
   Accept **Agree and answer**, then check the answer, citation links and **Google · free** label.
   Confirm the gateway records the intended model, successful status and reported token usage;
   request/response payload logging is disabled by `collectLog: false`.
4. Check the Worker's `ask_usage` event: `free: true`, `charged_mc: 0`, expected model and a
   finite cost/latency. Test using a non-admin so the shared daily allowance is exercised.
   Withdraw AI agreement in Settings → Privacy, reopen Search, and confirm consent is requested
   again, including for a recently cached question. Leave the production approval gate in place.

The owner's cost is capped by the existing admission reservations (`ASK_FREE_DAILY_USD_CAP`,
currently $0.11 per UTC day) and per-answer budget (`ASK_FREE_MAX_USD`, currently $0.05).
Reservations are shared with free Ask answers. Search gets one call, with output tokens limited
by the remaining reservation and a conservative input allowance. Missing usage or provider
failure retains the full reservation cost; storage failure blocks new work. There is no second,
unbudgeted provider call on failure. Admins retain their existing exemption from the daily
allowance; other account usage is separate. This does not promise a zero provider bill.

`SEARCH_AI_DAILY_LIMIT` still caps uncached answers per reader (20/day). A reader never needs
an Ask balance for Search. Cached answers live for two minutes and are separated by model;
consent is checked before the cache. Browser responses use `private, no-store`.

## Documentation checked

- [Cloudflare AI Gateway Workers bindings](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/):
  third-party `env.AI.run()` calls, Unified Billing, BYOK precedence and `collectLog`.
- [Google AI Studio through AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/google-ai-studio/).

Local tests use a fake AI binding and real SQLite-backed D1. Staging and production deploys
also run `bot/scripts/verify-release.mjs`: it checks the app and reader shells, database health,
unsigned request rejection, a cited answer from the configured provider, and consent before
and after caching. It signs the existing synthetic test reader and makes at most one provider
request per run, under the normal free-answer allowance; it sends no Telegram messages and
does not touch a real reader's balance. Missing gateway funding, exhausted allowance or an
uncited answer fails that deployment's verification step. A failed verification after upload
does not automatically roll the Worker back. Review the run before calling the release ready.
