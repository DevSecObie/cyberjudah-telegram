# Per-question model selection

`GET /api/ask/account` includes two capabilities on every entry in `models`:

- `tier: "fast" | "balanced" | "frontier"`: the shared catalog's reviewed capability/latency tier.
- `tools: boolean`: whether the backend's model adapter can run the research tools. A plain model still receives retrieved library passages.

These fields come from `shared/ask-models.mjs`. Tiers and the frontier preference are explicit policy, independent of prices. New models default to balanced until reviewed. Tool support follows the catalog's request format. The generated catalog, native IDs, thinking/effort settings, prices and output limits are unchanged.

`POST /api/ask` accepts `model: "auto"` with either `stream: true` (the existing NDJSON protocol) or JSON output. An explicit model ID overrides routing. Model-aware JSON requests use the same admission and answer path as streaming, including model-specific cost confirmation. Legacy JSON requests without a model retain their existing behavior.

Auto classifies the question with the Mini App's `src/lib/route-model.ts` rules:

- Quick: a bare verse reference, definition, or short standalone lookup uses an available fast free model, preferring one with research tools. A restricted free menu falls back to its available free models.
- Deep: reasoning/history/comparison/study language, more than 28 words, multiple questions, or a longer follow-up after four history messages uses the first affordable tool-capable paid model in capability order. Affordability uses the same typical cost as the account menu and the spendable wallet after migration, expiry and existing holds. Admins and accounts with reader billing disabled may use the strongest available research model without a wallet balance. With no affordable paid research model, routing chooses free research when available.
- Normal: uses the existing account default, including the configured admin default.

Routing considers only models available under the deployment's existing provider configuration and free-model policy. It does not call an AI to classify questions. It does not grant provider consent or authorize spending: `consent` must include the resolved provider, and `caps` must authorize the resolved **model ID**, not `"auto"` or another model. Existing 428 consent, 409 confirmation, 402 balance, quotas, free budgets, request replay protection, settlement, source and doctrine rules still apply. A confirmation response names the resolved ID for the client to use in `caps` on retry. Wallet changes between retries can change the selection, in which case the new model needs its own cap.

Example body after consent and confirmation:

```json
{
  "q": "Explain the historical evidence in the library",
  "model": "auto",
  "stream": true,
  "consent": ["Anthropic"],
  "request": "one-unique-request-id",
  "caps": { "anthropic/claude-opus-5.5": 200000 }
}
```

The cap is only used if routing resolves to that model. This example does not promise a particular model or quote a price; use the account menu and confirmation response for the current reader.
