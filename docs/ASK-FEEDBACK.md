# Ask feedback

Successful Mini App `/api/ask` JSON responses and NDJSON `done` events may include `answer_id`, a fresh server-issued UUID tied to the signed asker and the source numbers actually returned. It is not a client request ID or trace ID. Receipt storage failure leaves the answer intact and omits this optional field, so feedback stays hidden. Receipts never enter a shared answer cache.

```http
POST /api/feedback
Authorization: tma <signed Telegram launch data>
Content-Type: application/json

{"answer_id":"<server UUID>","rating":"down","reason":"wrong source","source_n":100}
```

`rating` is `up` or `down`. Optional `reason` is `wrong source`, `not in library` or `other`; there is no free-text field. Optional `source_n` must belong to this answer's actual returned registry, including sparse IDs such as 100. Extra fields are rejected. The existing browser/linked Firebase wallet authentication also works; this contract serves the Telegram wallet API, not the separate unlinked native Ask route.

Success is `200 {"ok":true}`. Repeated identical votes are no-ops; a changed vote updates the same person/answer record. Unknown, expired and another person's receipt all return the same `404 {"error":"not-found"}`. Invalid schema/source membership returns 400, missing sign-in 401, oversized input 413, rate exhaustion 429, and unavailable storage 503. Responses are not cached.

The server counts actual body bytes up to 2,048, including when Content-Length is absent or misleading. Atomic minute counters allow 30 submissions per person and a coarse 6,000 per IP for shared mobile networks and the Mini App proxy. The IP check runs first, so its rejection does not consume a person counter. Network keys are purpose-specific keyed hashes; plaintext addresses are not retained. No model, embedding, admin notification or paid inference call runs for feedback, and no wallet charge occurs.

Three small tables in the existing backend D1 binding hold receipts, one current vote per answer and short-lived rate counters. They initialize automatically; no new binding, resource or secret is needed. Receipts and votes expire after 30 days, with hourly cleanup. They contain only opaque IDs, pseudonymous ownership, source numbers, enum choices and timestamps—no questions, answers, transcripts, source text or private-chat exports. A conditional write rechecks ownership and expiry so deletion cannot resurrect a vote from an earlier read.

Download My Data includes this person's `askFeedback` metadata. Delete My Data removes their receipts, votes and person counters; other people's records stay intact. Aggregate IP counters expire independently and are not linked to the person. Feedback is not automatically converted into evals; any future case needs a separate, reviewed public/anonymized fixture.

The Mini App already parses `done.answer_id`, renders its feedback controls and posts this payload. Its remaining integration is the exact proxy allowlist entry `feedback: POST`; `store.ts` and the stream parser need no edit.

Merging backend changes enters the Ask Worker deployment path and requires the owner's release process. No live inference, resource creation or deployment is part of this PR.
