# Ask ranking v2 (RAG Phase 2), off by default

- New switch `ASK_RANKING`. Set to `v2`, Ask fuses its searches by meaning (50) and by words (the best 50 by bm25 across every kind) with reciprocal rank fusion. The reranker reads the best 60 (each passage's start and its sentences that match the question), and its scores now order the final passages, plus the same small word-overlap and Bishop/Deacon lifts. It also keeps at most two passages from one recording or page, and searches the parts of a several-part question with no model call. Unset, Ask ranks as before. See `docs/ASK-RANKING.md`.
- Every search, v1 or v2, now logs an `ask_retrieval` line with numbers only (counts, reranker status and time, a coarse best-score bucket); never a question, a passage or an id.
- The Bishop/Deacon lift's strength on the new scale, the pool size and the per-source cap are to be set from the Phase 1 recorded set before the switch is turned on (owner decision D6, ASK-POLICY A6).
