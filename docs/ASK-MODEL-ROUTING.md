# Per-question model selection

`GET /api/ask/account` includes two capabilities on every entry in `models`:

- `tier: "fast" | "balanced" | "frontier"`: the shared catalog's reviewed capability/latency tier.
- `tools: boolean`: whether the backend's model adapter can run the research tools. A plain model still receives retrieved library passages.

These fields come from `shared/ask-models.mjs`. Tiers and the frontier preference are explicit policy, independent of prices. New models default to balanced until reviewed. Tool support follows the catalog's request format. The generated catalog, native IDs, thinking/effort settings, prices and output limits are unchanged.

`POST /api/ask` accepts `model: "auto"` with either `stream: true` (the existing NDJSON protocol) or JSON output. An explicit model ID overrides routing. Model-aware JSON requests use the same admission and answer path as streaming, including model-specific cost confirmation. Legacy JSON requests without a model retain their existing behavior.

Auto classifies the question with the Mini App's `src/lib/route-model.ts` rules:

- Quick: a bare verse reference, a request to read one ("read John 3:16", "show me Genesis 1:1-3", "quote Isaiah 45:7", "what does John 8:32 say?"; asking what it means is not quick), a definition, or a short standalone lookup uses an available fast free model, preferring one with research tools. A restricted free menu falls back to its available free models.
- Deep: reasoning/history/comparison/study language, more than 28 words, multiple questions, or a longer follow-up (more than 8 words) after four earlier exchanges (question and answer) uses the first affordable tool-capable paid model in capability order. Affordability uses the same typical cost as the account menu and the spendable wallet after migration, expiry and existing holds. Admins and accounts with reader billing disabled may use the strongest available research model without a wallet balance. With no affordable paid research model, routing chooses free research when available.
- Normal: uses the existing account default, including the configured admin default.

Every finished stream line (`done`) written by a model names it in `model`: the resolved model for a research answer, the Workers AI answer model for a backup answer that model wrote. Fixed sentences written by no model (nothing found, not in the classes, the backup's no-budget notice with excerpts) and approved answers carry no `model`. Asking what something means is never quick, even short and without a "?".

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
