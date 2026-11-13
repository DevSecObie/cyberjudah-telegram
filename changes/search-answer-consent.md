# Search's hosted answer model needs the reader's agreement too

- The owner's rule (2026-11-10): any model that writes an answer needs the reader's agreement to its provider, wherever it runs. Search processing on the host (embedding the question and reranking passages with Workers AI) writes no answer and needs no separate agreement. The agreement card is unchanged. (OWASP LLM02.)
- Before this change, Search's answer model on Cloudflare (`@cf/`) needed no agreement, because Cloudflare is the host (`search-answer.ts`, `ai.ts` `answerSearch`). Now it is treated like any other provider: without the reader's agreement to "Cloudflare (Workers AI)", the server answers 428 with that provider before the edge cache, the quota or any model call.
- The Search card names the provider the server asks about (Cloudflare (Workers AI) or Google), and agreeing stores that provider. `ApiError` now keeps the error body, so the card can read it. A reader who already agreed to Cloudflare in Ask is not asked again.
- The release check (`scripts/verify-release.mjs`) now probes consent and withdrawn consent for every Search model, and sends the hosted provider's agreement for a hosted model.
- `docs/PRIVACY.md` states the new rule.
