# Ask research and remaining limits

Ask can now open the published material behind search results. It shares public reading functions
with the authenticated MCP service, without exposing MCP's account operations or bypassing either
transport's authentication. The five added tools are `search_classes`, `read_note`,
`read_transcript`, `commentary` and `read_data`. Tool results become numbered sources from their
recorded metadata. Opening a longer version of an existing class moment keeps its citation number.

Answers quote and cite the teacher named in that class's published note record instead of vague phrases
such as "the classes". The shared notes index supplies `teacher` and `date` on video sources before
research and in JSON/NDJSON responses. Missing names stay unspecified; conflicting video records do
not supply a guessed name. Names are never inferred from thumbnails, titles, voices or another
recording. Public metadata is cached per data origin for an hour. The answer-cache prompt revision
changes so previous answer wording is refreshed after deployment.

For a substantial question, the research instructions ask the model to search from different
angles, open the strongest relevant classes, follow their notes and captions, read exact Scripture,
and consult verse studies, people, timelines and the other relevant resources. A simple follow-up
can finish immediately. Research ends when the evidence answers the question. The existing rules
against inventing teaching, source text or attribution still apply to every model.

## Capability and output

- Research adapters can make up to 25 model calls, including the final answer. This replaces the
  six-round paid and four-round linked-Claude guards. Free answers default to three rounds and may be configured up to 25. The last round asks for
  an answer without more tools. The guard prevents a model that keeps calling tools from running
  forever; it is not a target. Plain models still answer from retrieved passages in one call,
  because they do not have a supported tool adapter.
- Linked admins use their configured `CLAUDE_MODEL_ADMIN`, defaulting to `claude-opus-5-5`, first
  in the native app's model list as well as Telegram. Supported Claude models use adaptive
  thinking and high effort. Older models keep the parameters their APIs accept. Thinking blocks,
  including empty signed blocks, pass intact between research rounds.
- Every Claude call has a hard output ceiling of 12,000 tokens; other adapters and the backup
  have an 8,000-token ceiling, even when billing is off. A smaller published model/context limit
  or the remaining reserved budget wins. Adaptive thinking and high effort stay enabled where
  supported. These are per-call runaway-cost bounds, not answer-length targets.
- `shared/model-capacities.json` records published capacities separately from model routing and
  pricing. It identifies the Cloudflare documentation commit and each source blob. Regenerate it
  with `node bot/scripts/model-capacities.mjs <cloudflare-docs/src/content> <commit-sha>` after a
  catalog update. Catalog `maxOutput` remains authoritative where supplied. No provider calls are
  made by this generator.

## Why limits remain

Existing financial limits remain: the reader's accepted per-answer limit, available balance,
deployment per-request maximum, sponsored daily/total allowance, and sponsored per-answer ceiling
(`ASK_FREE_MAX_USD`, normally $0.05). Research starts writing its answer after 70% of a reserved
budget has been used, leaving money for a final response. Each call's input is allowed for before
its output allowance is chosen. Missing usage stops further budgeted calls because the remaining
balance cannot be established. A budget can therefore stop research before round 25 or shorten an
answer before the model's maximum. These protect real money; they do not change teaching rules or
remove reading tools. `ASK_FREE_MAX_ROUNDS` defaults to 3 in code, production and staging,
and is clamped to at most 25 even with invalid/unbounded input. Paid holds use a six-round planning
estimate rather than reserving a 25-round worst case for every question; the agent can use up to
25 calls while the money actually reserved still covers them. This can stop a costly run early.
The deployment per-request dollar ceiling is unchanged; the owner controls price policy.

All admin answers, including billing-off paths and backups, reserve against a separate UTC-day
pool (`ASK_ADMIN_DAILY_USD_CAP`, default $10 for all admins together). They do not consume the
ordinary free-reader pool or a reader wallet. Invalid/unreadable/exhausted budgets fail closed.
The owner can change this dollar cap in configuration. It prevents unlimited sponsor spend under
the default Opus model; it does not switch admins to a different model.

Research reserves its final 20 seconds for writing: tools stop around 90 seconds and the next
model round must write from registered evidence. The hard deadline remains 110 seconds; if a
provider stalls through it, the result is marked partial and shows existing verbatim excerpts
rather than invented text. Provider work aborts on disconnect, and cancellation is checked before
further tools/calls. Accounting still finishes under waitUntil. A cancelled request before any answer text and a cut answer are not charged; a paid cancellation
after visible answer text is settled as partial for the provider-reported metered cost, at most
the hold. Unknown tokens are never invented. A cut answer is not cached. Provider costs already incurred still
count against the sponsor's pool. Known-usage admin failures release the unused reservation. Unknown or aborted usage keeps its
reservation because the unspent amount cannot be established. Partial SDK usage snapshots are
recorded as lower bounds, with usage_complete=false.
Source registration is bounded at 256 records; full source words are retained for those readings.

The Workers AI backup now has its own sponsored reservation before a call, including streaming
responses. Reported successful usage settles the actual cost; failed, canceled or unreported calls
retain the full reservation. It does not charge the reader for a failed primary model or a backup.
Admins use the separate daily admin pool as well as the per-request ceiling.

If a non-admin backup cannot reserve sponsored funds, it makes no further model call. When
retrieved text is available, it instead returns up to four attributed verbatim excerpts, saying
that it cannot generate a new answer right now. With no retrieved text, it remains unavailable
rather than inventing an answer. This also applies when the budget counter cannot be read.

Reading tools return manageable pieces that can be continued. Notes and public JSON use
40,000-character parts with a next offset. Transcripts return up to 600 seconds on either side of
a chosen moment; adjacent windows let the model follow a full class. Class search has pages
0–20; public data indexes can locate other recordings and notes. These are tool response sizes,
not a ban on reading beyond the first part. Prior conversation is bounded to eight normalized
messages: 3,000 characters for each earlier user message and 1,500 for each earlier answer. Longer
messages retain their opening and ending with an explicit shortening marker. This bounds repeated
prompt costs and oversized client history; it does not shorten the current question or tool readings.

Research progress starts with the existing `passages` snapshot. Further updates use the additive
`passages_delta` array, merged by citation number, and send only changed previews with at most
1,000 characters of source text. Repeated reads of an unchanged preview send nothing. The model
keeps the full source text, and `done.sources` retains the full cited sources. The backend app
merges updates without dropping earlier sources; older clients can continue using the initial
snapshot and final sources. The Telegram Mini App consumes `done.sources` only. A 25-round fixture
with about one megabyte of source readings sends less than 50 KB of progress-source packets.

Telegram accepts questions up to 4,000 characters, matching native Ask. Longer questions fail with
`too-long` before research instead of silently discarding text after character 400. Full source
documents belong in the reading tools. Source numbering is no longer capped at 48; citations can
name sources beyond 99.

Providing the model more tools and room does not guarantee a particular model's judgment. A
smaller plain model and a frontier research model use the same grounding and citation rules, but
have different native capabilities. Consent, authentication, billing and Sabbath admission stay
on their existing paths. Model auto-routing is a separate change.

## Validation

Regression fixtures cover complete note continuation, verbatim transcript metadata, the shared
MCP readers, citation extension, more than 48 sources, research past six rounds, the 25-round
guard, supported thinking settings and intact signed thinking blocks. Provider-format tests cover
output parameters and reserved spending, including paid OpenAI chat completions. Backup tests
cover sponsored reservations, missing usage, provider failure and streaming cancellation. Question
tests cover intact long input and explicit oversized-input rejection. Tests use stand-ins, not live
paid inference.


The Worker opts into `enable_request_signal` for non-stream client disconnections at its existing
compatibility date. Ask explicitly forwards that signal to model/embedding calls; the flag does
not itself add automatic subrequest cancellation. Webhook/payment handlers do not forward it to
their settlement work. See [Cloudflare's compatibility documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).


The reload/cancellation browser test uses Wrangler's real bundled Worker and `wrangler.jsonc`
on a direct workerd socket, with isolated local storage and the scripted local Claude provider.
Wrangler 4.156's development ProxyWorker has a 2023-12-18 compatibility date without
`enable_request_signal` and detaches its upstream fetch, so that proxy does not carry a browser
reload's disconnect to the Worker. The direct fixture avoids that development-only hop; it does
not skip the cancellation or refund assertions. A local HTTP relay converts the browser close
into a TCP reset so workerd reliably observes it before JSON response headers exist. Production keeps compatibility date `2025-05-01`
and explicitly opts into `enable_request_signal`.

To check the test's sensitivity, run the focused browser case with the test-only environment
variable `E2E_DISABLE_REQUEST_SIGNAL=1`. It removes only that flag from the isolated workerd
fixture. The JSON-response variant must fail its interruption assertion as the scripted answer
completes: unlike the streamed response, its internal NDJSON reader cannot observe the physical
client disconnect through a stream cancellation hook. No deployed
config or Cloudflare resource is changed. The provider-deadline unit test injects a TimeoutError
after provider entry so runner load cannot move its deadline into setup.
