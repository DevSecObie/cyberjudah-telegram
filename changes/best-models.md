# The best model for every step (owner decision 2026-11-10)

- Claude answers use Opus 5.5 for every tier (`CLAUDE_MODEL`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_ADMIN`).
- The free model, free deep study, Search's answer and the backup when Claude is down use Kimi K2.6 (`@cf/moonshotai/kimi-k2.6`, Workers AI). The earlier free models stay selectable in the app.
- Speech is heard by Deepgram Nova-3 and answers are read by Deepgram Aura-2, both on Workers AI. Four Aura-1 voices have no Aura-2 voice of the same name; a reader's saved choice of one is read by the closest (stella→thalia, perseus→odysseus, angus→jupiter, helios→apollo). Kept audio is keyed by the voice model, so Aura-1 audio is never served as Aura-2's.
- The free per-answer ceiling (`ASK_FREE_MAX_USD`) is $0.15, up from $0.05, so a deep study on Kimi can finish its rounds (owner). The production free daily cap stays $25; staging's goes from $1.00 to $1.50 so it still holds ten answers' reservations.
- Readers' Claude answers are each held to $0.50 (`ASK_CLAUDE_MAX_USD`, was $0.20; owner), so an Opus answer has room to research. The $2.50 daily reader pool and the $70 total cap are unchanged: about 14 typical Opus answers a day, and at most 5 reserved at once.
- Unchanged: the embedding (bge-m3), the reranker (bge-reranker-base), the consent rule, D8 (every model is Cloudflare or Anthropic) and the $0.25 ask-first threshold (owner).
