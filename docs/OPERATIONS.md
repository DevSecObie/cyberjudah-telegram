# Operations runbook

## Services

Production:

- Cloudflare Worker `cyberjudah-telegram`: static app, API, bot webhook, cards, and hourly cron
- D1 `cyberjudah-telegram`: teaching and transcript search indexes
- D1 `cyberjudah`: the site's database (teaching_passages, teaching_refs), shared read-only
- KV `SUBS`: daily-verse subscriptions, billing accounts, health state
- Vectorize `cyberjudah-teachings`: the teachings index
- R2 `cyberjudah-audio`: spoken-verse cache
- `data.cyberjudah.io`: Bible and library content
- Telegram Bot API: bot commands, inline mode, sharing, payments, and delivery

Staging (`.github/workflows/stage.yml`, every PR): worker
`cyberjudah-telegram-staging` with its own D1 (`cyberjudah-telegram-staging`) and its own
KV namespace (`SUBS-STAGING`). It shares the site's D1, the Vectorize index and the R2
bucket read-only; the embed job never runs against staging. Staging's hourly cron runs the
daily send and the self-check against staging resources only — never set `ADMIN_IDS` on
the staging worker, or its self-check will page you about staging's expected differences.

## Health signals

The worker checks itself every hour (`src/health.ts`, inside the existing cron) and pages
`ADMIN_IDS` over Telegram when something breaks or recovers:

- D1 reachable and `search_docs` non-empty; the teachings D1 reachable and non-empty
- Vectorize index responds and is non-empty
- D1 size under `D1_SIZE_ALERT_BYTES` (default 8 GB — re-check against Cloudflare's
  current per-database ceiling before launch)
- The last finished daily-verse slot's failure share under 20%

Alerts fire on the bad transition and repeat every six hours while still failing; a
recovery sends one "recovered" message. State lives in KV (`health:state`) so deploys
don't reset the paging.

Still monitor in the Cloudflare dashboard:

- Worker 5xx rate and p95 latency by route
- Unauthorized and rate-limited requests separately from server failures
- Telegram webhook failures and processing latency
- Daily-verse attempted, delivered, blocked, and failed counts (the `daily` log lines)
- Search and transcript-query latency and zero-result rate
- Latest successful search and transcript ingestion timestamps
- Upstream content availability and schema compatibility
- Deployment status and current commit SHA

Logs must not include bot tokens, webhook secrets, raw Telegram `initData`, note contents, precise location, or full user profiles.

## Deployment

- Pull requests deploy to staging automatically (`stage.yml`): checks, staging worker
  deploy, webhook/commands/menu-button registration on the staging bot, search-index
  load, and a smoke test of `/api/health` and the app shell.
- Pushes to `main` deploy to production (`deploy.yml`) after checks pass. The deploy job
  targets the `production` GitHub environment: add required reviewers under Settings →
  Environments → production to gate every production deploy (and rollback) behind a human.
- Record the deployed commit SHA.

### Deployment checklist

What a production deploy does, in order (`deploy.yml`, job `deploy`), and what to check at each step:

1. **Before merging:** the pull request's checks are green: `check` (typecheck, unit tests,
   build), `playwright`, `stage` (a staging deploy with its smoke test), `codeql`,
   `dependency-review`. Dependabot pull requests have no secrets, so their `stage` is red by
   design; judge them on the rest.
2. **Approval:** the `deploy` job targets the `production` environment, and waits there when it
   has required reviewers (the run history shows deploys pending for up to two hours, so a gate
   appears to be set; confirm under Settings → Environments → production). Approve the newest
   pending run; an older pending run superseded by a newer one can be rejected, since the
   newer deploy carries its commits.
3. **Configuration:** the job checks four secrets by name (`CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, `WEBHOOK_SECRET`), finds or creates the D1
   databases, KV namespace, Vectorize index and R2 bucket, and writes their ids into
   `wrangler.jsonc` in the runner only. Optional secrets (`ANTHROPIC_API_KEY`,
   `CYBERJUDAH_TOKEN`, `ADMIN_IDS`) are pushed to the Worker when present.
4. **Schema:** there is no migration step. Tables are created on first use with
   `CREATE TABLE IF NOT EXISTS` (`bot/src/billing.ts`, `bot/src/ai.ts`). A schema change must
   be additive (new tables or nullable columns) so the previous Worker still runs against it
   after a rollback.
5. **Publish:** `wrangler deploy` publishes the Worker and the app's assets; its log prints
   `Current Version ID`. **The new code is live from this moment**, even if a later step fails.
6. **Search index:** `load-search.mjs` replaces the whole search index from the data set. D1
   warns that the database "will be unavailable to serve queries" while it imports, so Search
   may fail for that time. If this step fails, the job is red with the Worker already live and
   step 7 skipped; re-run the job once the earlier import has finished (see
   [docs/INCIDENTS.md](INCIDENTS.md)).
7. **Bot setup:** secrets put on the Worker, then the webhook, commands and menu button
   registered (`scripts/setup.mjs`).
8. **Identify the release:** record the commit SHA, the deploy run id and the Worker's
   version id (from step 5) together, in the pull request or the incident log.
9. **Smoke test** (production, within minutes):
   - `GET https://cyberjudah.io/api/health` answers `ok: true` (search and teachings).
   - `https://cyberjudah.io/app` and `https://cyberjudah.io/app/read/john/3` render.
   - The bot's menu button opens the app (the Worker's root).
   - In Telegram: a search, an Ask question, opening a verse and a class.
   - The nightly `live-smoke` workflow runs the end-to-end suite against `vars.WORKER_URL`; a
     manual run (Actions → live-smoke → Run workflow) gives the same check on demand.
10. **Roll back** if a check fails: see below. The search index is not part of a rollback;
    the next deploy or the nightly `refresh-search` reloads it.

## Rollback

No rebuilds. The `rollback` workflow (`Actions → rollback → Run workflow`) repoints the
worker at an already-deployed version:

1. Pick the environment (production or staging) and optionally a version id from
   `wrangler deployments list`; empty means the deployment before the current one.
2. Approve the run if the environment has required reviewers.
3. Verify: the health endpoint, the Telegram webhook, authenticated search, a daily
   subscription, and a deep link.
4. If data compatibility prevents rollback, disable affected writes and follow the
   migration recovery procedure.
5. Record the incident and follow-up actions.

Drill this against staging before launch — a rollback you have never run is a rollback
you do not have.

## Scaling notes

- **Daily verse** (`src/daily.ts`): paced at ~25 sends/second with 429 backoff (the
  server's `retry_after` is honored, then the chunk retries once). Progress checkpoints
  per hourly slot in KV, so an interrupted run resumes; the previous hour's unfinished
  slot is finished first. Rough math: 10k subscribers ≈ 7 minutes, 100k ≈ 70 minutes,
  inside the hourly cron. Blocked users (403) are dropped from the list automatically.
- **Ask CyberJudah**: the expensive path. Every paid model is paid from the reader's own
  balance, at cost, so its spend is bounded by what readers top up; the free model is bounded
  by the per-user daily quota (100 asks; 50 new TTS generations). Balances, holds, the ledger
  and each answer's cost live in D1 (`credit_lots`, `credit_ledger`, `credit_holds`,
  `credit_usage`, `payments`); `/api/admin/usage` shows each day's cost and charges.
- **Search**: D1 FTS is cheap; `/api/search` cache headers are the lever if read volume spikes.
- **Quotas**: `takeQuota()` in D1 is atomic per user/day; `rate_counts` rows for old days
  are swept on use, so the table stays small.

## Incident priorities

- P0: credential exposure, unauthorized data access, destructive corruption, or widespread payment abuse
- P1: app/bot unavailable, authentication broken, or daily messages broadly failing
- P2: degraded search, stale ingestion, client-specific regression, or elevated latency

Rotate exposed credentials immediately, preserve non-sensitive evidence, and use GitHub's private vulnerability reporting for security incidents.

## Reading reminders

Reminders run every quarter hour (`sendReminders` in `bot/src/remind.ts`; cron `15,30,45 * * * *` plus the hourly `0 * * * *`, which alone also runs the daily verse, the self-check, pruning and frame warming). Each run logs one line: `{"event":"reminders","slot":"remind-slot:YYYY-MM-DDTHH:MM","telegram":n,"push":n,"fallback":n,"failed":n}`. Counts by channel are on the admin usage view (Settings → Ask usage, admins only).

- **Delivery is at most once a day per channel:** the day is claimed on the record before a send, and given back only when the send failed in a way worth retrying (Telegram errors other than 403; push 5xx/429/network), which the next quarter-hour run retries within three hours of the reader's time.
- **Push failures:** 404/410 drop that browser's subscription (when none is left, the reminder falls back to Telegram with a notice). 401/403 mean our VAPID keys are wrong: nothing is dropped and the admins get one Telegram message a day (`reminders_vapid_refused` in the logs) until it is fixed.
- **Rate limits:** the `REMIND_LIMIT` Workers Rate Limiting binding (`wrangler.jsonc` "ratelimits", 30 requests per caller per 60 s; namespace 1001 production, 1002 staging) answers 429 with `Retry-After: 60`. New browser credentials are also capped at 100 per address per day (`remcreate:` keys).
- **Telegram:** `/stop` turns reminders off; a reader who blocked the bot is switched off and restored when they `/start` it again or unblock it (`my_chat_member`, now in the webhook's `allowed_updates`, applied by `npm run setup` in the deploy).

Push needs three Worker secrets, added by the owner only: `VAPID_PUBLIC_KEY` (base64url, 65-byte uncompressed P-256 point), `VAPID_PRIVATE_KEY` (base64url, its 32-byte private scalar) and `VAPID_SUBJECT` (`mailto:` or `https:` contact). Without them `/api/push/key` returns `null` and the app shows push as not set up; Telegram reminders are unaffected. To make the keys, run this on your own machine (Node 18+) and copy each line's value into a GitHub repository secret of that name (Settings → Secrets and variables → Actions); the deploy puts them on the Worker, and stops if only some are set:

```sh
node -e 'const c=require("crypto");const j=c.generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey.export({format:"jwk"});console.log("VAPID_PUBLIC_KEY="+Buffer.concat([Buffer.from([4]),Buffer.from(j.x,"base64url"),Buffer.from(j.y,"base64url")]).toString("base64url"));console.log("VAPID_PRIVATE_KEY="+j.d)'
```

`VAPID_SUBJECT` is a contact the push services can use, such as `https://cyberjudah.io` or a `mailto:` address. Never paste the private key anywhere but the secret. Staging has no VAPID secrets, so push shows as not set up there. Rotating the keys makes every push service answer 403: subscriptions are kept, the admins are alerted, and readers must turn push on again in each browser (the app re-subscribes on open once permission is granted).

**End-to-end tests.** `app/e2e/reminders.spec.ts` runs against the real local Worker (`wrangler dev --test-scheduled`, fresh storage each run). The Worker is started with a test-only bot token and VAPID keys made for the run, and two variables that point its outbound calls at a loopback stand-in (`app/e2e/stand-ins.ts`): `TELEGRAM_API_ROOT` (the Bot API) and `PUSH_TEST_ORIGIN` (a push service). Both are honoured only for `http://127.0.0.1` or `http://localhost`, so a deployed Worker is unaffected; never set them in production. `/__scheduled` is in `run_worker_first` so the tests can run the cron; a deployed Worker hands it to the assets like any unknown path.

**Smoke test after a deploy that touches reminders:**

1. In Telegram, open Settings → Reading reminders. Push shows greyed with "Push notifications aren't available inside Telegram…". Turn the switch on with Telegram, and set the time to the next quarter hour.
2. Check the record: `wrangler kv key get --binding SUBS "remind:tg:<your user id>"` shows `"on":true`, the hour and your time zone.
3. At that time, the bot sends "Today's reading" (or "Continue where you left off") with Open, Done, Pause… and Stop, and no verse text. Pause… offers Until tomorrow, A week and Until I resume. Open lands on the chapter. Done answers "Marked done."; reopening the app marks the chapters read.
4. In a desktop browser at cyberjudah.io/app, choose Push notification and allow the prompt; `wrangler kv key list --binding SUBS --prefix pushep:` lists one more key. At the hour a notification arrives with Done and Pause.
5. The cron log for that quarter hour shows the `reminders` line with no `failed`.
6. Send `/stop` to the bot: it answers that reminders are off. Then use Forget this browser in the desktop browser.

## Ask CyberJudah's models and the backup

Ask answers with Claude (`CLAUDE_MODEL`), paid for as `CLAUDE_BILLING` says (below). Workers AI (Llama 3.3 70B, `ANSWER_MODEL`) is the backup:
- **No Claude:** with neither Unified Billing set up nor an `ANTHROPIC_API_KEY`, every answer comes from Workers AI.
- **Claude fails:** if Claude fails with an overloaded, rate-limited, server or connection error, the key is refused, or the Cloudflare credits have run out (402) (`claudeUnavailable` in `bot/src/providers.ts`), that answer is written by Workers AI from the passages already found. The reader sees "the backup model wrote this shorter answer" and is not charged. With no passages, it says the main model is busy, and nothing is saved as an answer.
- **Logs:** each failover logs `ask_claude_unavailable` with the status.

**Cloudflare AI Gateway** (`AI_GATEWAY` in `wrangler.jsonc`, `"default"` for production and staging):
- **Workers AI:** calls (answers, embeddings, reranking, voices) pass `{ gateway: { id } }` and appear under AI Gateway → `default` in the Cloudflare dashboard, with logs and analytics. Cloudflare creates the `default` gateway on its first request. The AI binding authenticates it, so no token is needed.
- **Claude:** calls go through the same gateway only when the **`CF_AIG_TOKEN`** Worker secret is set. That is an AI Gateway token with Run permission, made under the gateway's Settings → Create authentication token; it is sent as `cf-aig-authorization` because the default gateway is authenticated. Add it as the GitHub repository secret `CF_AIG_TOKEN` (Settings → Secrets and variables → Actions); the deploy puts it on the Worker. Without the token, Claude is called directly, as before. **The owner adds this secret.**
- **Who pays for Claude** (`CLAUDE_BILLING` in `wrangler.jsonc`, `"cloudflare"` for production and staging):
  - `"cloudflare"`: **Unified Billing.** Claude is paid from the Cloudflare account's AI Gateway credits, and no Anthropic key is sent, because the gateway uses a provider key whenever the request carries one (Cloudflare docs: Unified Billing → Credential precedence). It needs `AI_GATEWAY` and the `CF_AIG_TOKEN` secret. Until the token is on the Worker, the `ANTHROPIC_API_KEY` secret is used if there is one.
  - **Credits:** load them under AI → AI Gateway → Credits Available → Manage → Top-up credits. Cloudflare adds a 5% fee on each purchase and passes Anthropic's per-token prices through. Auto top-up is set in the same place. When the credits run out, Ask answers with the backup until they are topped up.
  - **Check it:** `/health` shows `ask.billing` as `cloudflare`, `anthropic` or `none`.
  - Anything else: the `ANTHROPIC_API_KEY` secret, billed by Anthropic; calls still go through the gateway when `CF_AIG_TOKEN` is set.
  - Once Unified Billing is confirmed in the gateway's logs, the `ANTHROPIC_API_KEY` repository secret and Worker secret are no longer used and can be removed.
- **Dashboard settings:** gateway-level caching, rate limiting and retries are set in the dashboard. Leave caching off for Ask: answers depend on the conversation.

## Privacy

What is kept about people, for how long, who else handles it and the standards it follows are in
[docs/PRIVACY.md](PRIVACY.md). Two owner actions: the `PRIVACY_KEY` repository secret (the deploy
refuses to run without it, and it must never change) and the bot's Privacy Policy URL in @BotFather.

## Ask's models

Readers pick the model in Ask’s header. The dollar balance under the question box opens the top-up sheet.
- **The list** is `shared/ask-models.json`, built by `node bot/scripts/ask-models.mjs <cloudflare-docs>/src/content <commit>` from Cloudflare's catalog (`catalog-models` for third-party models, `workers-ai-models` for Cloudflare-hosted ones). It holds every text model with a published price. Rebuild it to pick up new models or prices.
- **Claude** models go through the Anthropic SDK (`agent.ts`). Every other model goes through the AI binding and the gateway (`agent-open.ts`): chat completions, the Responses API or the Messages format, with the same tools, or no tools for models without function calling.
- **Pricing:** each answer is charged exactly what it cost, at the price of the model that wrote it, with Unified Billing's fee where it applies and the library searches at Cloudflare's rates (`shared/credits.mjs`, `bot/src/spend.ts`). No margin.
- **The free model** (`ASK_FREE_MODEL`, Llama 3.1 8B) is never charged. It is open to everyone (within the 100-a-day quota), and is offered when a reader's balance is too low for the model chosen. Before a non-admin free Ask or search answer begins, D1 atomically reserves its estimated maximum cost against `ASK_FREE_DAILY_USD_CAP` ($0.11 by default). Completed spend plus in-flight reservations cannot admit more than that allowance. The reservation settles once against the UTC day it started; failed calls, missing usage and lost workers conservatively keep their reserved allowance. Storage failures block new free work. This covers these metered answers, excludes admin testing and other AI uses (including paid-request backups and speech), and is not a guarantee that the Cloudflare account stays inside its shared free allocation.
- **Top-ups** ($1, $5, $20 in Stars) pause from full dark before each Sabbath, feast day and New Moon to full dark at its end, in the reader's time zone (`shared/holy-days.mjs`). The feast days and New Moons are in `shared/holy-days.json`, refreshed from the IUIC calendar by the weekly `holy-days` workflow as a pull request to approve.
- **Failures:** if any model fails or Cloudflare refuses it (out of credits, for example), the answer falls back to the backup as before.

### Billing integrity and retry handling

- Paid request ids can start work only once; concurrent or completed reuse returns `409 request-used`. The app creates a new id for an intentional new attempt. No provider work runs on a duplicate.
- `webhook_updates` in the existing D1 binding serializes Telegram deliveries and records completion after successful handling. A failed delivery releases its claim; an active claim returns an error for Telegram to retry. A crashed claim can be recovered after 20 minutes. Completed updates are kept for seven days, pruned hourly. Legacy KV update markers are ignored; charge-level ledger idempotency protects retried payments.
- Refund ledger rows mark refunded credit lots. Settlement and timeout recovery record unused reservations as refunds instead of restoring them to the spendable wallet. The same atomic batch keeps the balance and ledger equal.
- `free_spend_holds` is created additively beside the existing daily counter. Its random reservation ids are not linked to readers. Old reservations are pruned after seven days; the current day's unresolved reservations are never automatically released. Aggregate daily spend remains intact.
- No new secrets or bindings are required. Tables and the refund lookup index are created with `IF NOT EXISTS`; existing balances and payment records are retained. These changes do not retroactively reconcile any earlier incorrect balance. If an incident is suspected, review the relevant payment/hold/refund ledger before making an explicit admin adjustment. Rolling back the code reintroduces the old retry and accounting behavior; do not delete financial records as a rollback step.

## Backups and recovery

Define and test D1 backup/export and KV subscription recovery before public launch. Document recovery time and recovery point objectives after the first successful drill.

## Release checklist

- Required checks pass
- Security and dependency findings reviewed
- Staging smoke test passes
- Data migrations and rollback compatibility reviewed
- Privacy documentation matches telemetry changes
- Monitoring and alerts cover new routes or jobs
- Changelog updated (or marked not applicable); a version tag only on a deployed commit (CONTRIBUTING.md, Releases)
- Production smoke test and owner recorded
