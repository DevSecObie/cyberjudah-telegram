# Ask alerts and Worker error tracking (design)

MDLC work package 4, gaps G2 and G5 in [ASK-THREAT-MODEL.md](ASK-THREAT-MODEL.md); MDLC stage 6 ("Operate and monitor"). Design only. Everything ships behind switches that default to showing numbers in Ask Health and nothing else, so readers and admins see no change until the owner turns paging on.

## Privacy rules (apply to every item below)

The same promises as `docs/PRIVACY.md`, restated as rules a reviewer can check:

1. No question, answer, passage, chat title, reminder setting or other reader content.
2. No Telegram ID, Firebase UID, `pid`, IP address (plain or hashed), user agent, cookie or request URL with its query string.
3. No raw `error.message` from a provider or library: they can quote the request. Errors become fixed codes (below).
4. The trace id (random UUIDv4) may be kept: it is not an account identifier, and it lets a reader's own report find its event.
5. Alert messages carry an alert code and numbers only.

## Error codes (fixes G2)

Today `ask_events.detail` and several `console.error` lines carry `error.message` (`app-ask.ts`, `ai.ts` `ask_failed` / `app_agent_failed` / `search_answer_failed` / `ask_stream_failed`, `mcp.ts`). Replace with one classifier, `errorCode(e): string`, returning only:

`timeout`, `aborted`, `rate-limited`, `provider-4xx`, `provider-5xx`, `provider-refused` (content filter / safety), `budget`, `ui-rejected`, `network`, `bad-response` (unparseable model output), `storage` (D1/KV/Vectorize), `unknown`.

It looks at the error's class, `status`/`code` fields and a fixed set of known message prefixes, and **returns only the code**; the message never leaves the function. `detail` keeps the existing fixed non-content strings (for example the study path's `teaching`/`cut` counts) and gains `code=<errorCode>`. A test feeds errors whose messages contain a planted question and asserts nothing of it reaches `ask_events`, `console` or the tracker.

## Alerts (fixes G5)

Computed by the hourly cron from tables that already exist and hold no content: `ask_events` (14 days), `free_spend_daily`, `free_spend_holds`, `credit_usage`, plus `/api/health`. Each alert needs a minimum sample so a quiet hour can't trip it. The numbers are **proposed starting values**, taken where possible from the pipeline doc's own proposals; the owner sets the final ones.

| Code | Measures | Window, minimum | Warn | Page |
|---|---|---|---|---|
| A1 `error-rate` | (`failed` + `timeout` + cut-off) / answers, as Ask Health counts them | 60 min, ≥ 20 answers | > 10% | > 25%, or any model with ≥ 5 answers all failed |
| A2 `coverage-miss` | `no-evidence` + `fallback` + `empty` / answers. Needs the coverage decision recorded as a fixed label in `ask_events` (shadow decisions are only console counts today) | 24 h, ≥ 50 | > 30% | > 50% |
| A3 `citation-fail` | Search `no-cited-answer` share; Ask answers with non-empty `unsupported_refs`; study `ui-rejected` | 24 h, ≥ 20 each | > 10% (ui-rejected > 5%, pipeline doc) | > 25% |
| A4 `cost-day` | Free spend today vs `ASK_FREE_DAILY_USD_CAP`; paid model cost today from `credit_usage` vs an owner-set daily figure; existing Claude funds alert | UTC day | free ≥ 80% of cap before 18:00 UTC; paid > owner figure | paid > 2× owner figure; no figure set = no paid alert |
| A5 `latency` | p95 `elapsed_ms` of completed answers | 60 min, ≥ 20 | > 45 s | > 60 s (pipeline doc) |
| A6 `index-stale` | Vector count drop day over day; corpus release id (WP1) older than the latest library release | daily | drop > 2%, or lag > 36 h | drop > 10% |
| A7 `health` | `/api/health` failing checks (`d1-search`, `d1-teachings`, `vectorize`, `d1-size`) | each run | any one | two runs in a row |

Delivery, by `ASK_ALERTS_MODE`:

| Mode | Effect |
|---|---|
| `off` | Nothing computed. |
| `shadow` (**default**) | Computed hourly and shown in Ask Health as an "Alerts" list (code, level, numbers, since when). No message is sent. |
| `notify` | Also sends `tellAdmins` once per alert per 6 hours, and once when it clears: `A1 error-rate page: 31% of 42 answers failed in the last hour (since 14:00 UTC).` No other text. |

The owner turns on `notify` after a week of `shadow` shows the thresholds are not noisy. Reader "wrong"/"harmful" reports are not an alert; they go to the weekly review that turns them into eval cases (WP3/WP5).

## Worker error tracking

The Worker has no error tracking today; failures are `console.error` lines kept up to seven days. Send unexpected errors to the project's own GlitchTip at `errors.cyberjudah.io`, through the existing ingest proxy (which drops every request header, so GlitchTip stores no address; `Setup/Monitoring/glitchtip-privacy.md` in the vault).

**No Sentry SDK in the Worker.** The Workers SDK attaches the request (URL with `?q=`, headers) by default; one missed option would break rule 2. Instead, one small function builds the envelope by hand from an allowlist and posts it with `fetch` inside `ctx.waitUntil`.

The event contains only:

| Field | Value |
|---|---|
| `event_id`, `timestamp`, `platform: "javascript"`, `level` | generated |
| `release` | the deployed git SHA |
| `environment` | `production` / `staging` |
| `tags` | `route` (the route **template**, e.g. `/api/app/ask`, never the URL), `surface`, `model`, `provider`, `code` (the error code above) |
| `exception.values[0].type` | the error's class name only |
| `exception.values[0].stacktrace` | frames with `filename`, `function`, `lineno`, `colno` from our bundle; no `vars`, no `context_line` |
| `fingerprint` | `[route, code, top in-app frame]` |
| `extra.trace_id` | the request's trace id (rule 4) |

Never set: `message`, `exception.value`, `request`, `user`, `breadcrumbs`, `contexts` beyond `runtime`, `extra` beyond the trace id. A test builds an event from an error whose message and stack carry a planted question and a fake ID, and asserts the serialised envelope contains neither.

Limits: at most 10 events per minute per isolate (dropped beyond that, counted in a `console` line); a failed send never affects the response.

Switch: `ASK_ERROR_TRACKING` `off` (**default**) / `on`, plus a `GLITCHTIP_WORKER_DSN` Worker secret; without the DSN it stays off. A separate GlitchTip project ("cyberjudah-telegram-worker") keeps Worker errors apart from the Mini App's (project 1) and gets its own alert rule.

**Owner actions before `on`:** create the GlitchTip project and set its DSN as a Worker secret (DSNs are public by design, but keep them out of the vault); decide whether the Mini App privacy page should mention server error reports. Nothing personal is sent, so `docs/PRIVACY.md` gains an operator row; any reader-facing wording is the owner's.

## Build order

1. `errorCode` classifier + replace the raw messages in `ask_events.detail` and the `console.error` lines listed above, with tests (t1x; touches `ai.ts`/`app-ask.ts` lines that log, not answer logic, so coordinated with the AI owners).
2. Alerts in `shadow`: computation + Ask Health list (whoever owns `ask-health.ts`; t1x reviews).
3. Worker error envelope behind `ASK_ERROR_TRACKING=off` (t1x).
4. Owner: thresholds, `notify`, the GlitchTip project.
