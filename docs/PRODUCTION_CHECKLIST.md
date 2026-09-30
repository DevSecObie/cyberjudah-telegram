# Production checklist

Everything that needs a human before CyberJudah goes public. The code side is done
(staging workflow, rollback workflow, hourly health paging, paced broadcasts); this is
the account-and-settings side that only the owner can do.

## 1. The two Telegram bots

Production bot: `@CyberJudah_bot` (already live).

1. Open `@BotFather`, `/newbot`, name it something like `CyberJudahStaging`, note the token.
2. On the staging bot: `/setinline` (enable inline mode), `/newapp` (attach the Mini App —
   point it at the staging worker URL after the first staging deploy, then set the
   `APP_URL` var in `wrangler.jsonc`'s staging env to the `https://t.me/<staging-bot>/cybr` link).
3. Production bot: confirm `/setinline` and `/newapp` are set (menu button "Open", app link `cybr`).

## 2. Repository secrets and variables

Settings → Secrets and variables → Actions.

Repository secrets (production deploys fail by name without the first four):

| Secret | Used for |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploying the worker; needs Workers Scripts Edit, D1 Edit, KV Edit, Vectorize Edit, Workers AI Read, R2 Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Same |
| `BOT_TOKEN` | The production bot token (never commit it) |
| `WEBHOOK_SECRET` | Any long random string; must match between Telegram and the worker |
| `STAGING_BOT_TOKEN` | The staging bot's token |
| `STAGING_WEBHOOK_SECRET` | A different long random string for staging |
| `ANTHROPIC_API_KEY` | Optional: Ask CyberJudah answers with Claude when set, Llama 3.3 70B otherwise |
| `CYBERJUDAH_TOKEN` | Optional: a fine-grained GitHub token (contents write on `DevSecObie/cyberjudah`) — enables in-app note edits |
| `ADMIN_IDS` | Optional: comma-separated Telegram user ids that can edit notes and receive health pages |

Repository variables:

| Variable | Used for |
|---|---|
| `TELEGRAM_APP_URL` | The production Mini App URL, baked into the app build |
| `WORKER_URL` | Optional: override for the worker's public URL |

Do **not** set `ADMIN_IDS` on the staging worker — staging's hourly self-check would page
you about staging's own (expected) differences. Staging keeps its own `health:state` in its
own KV namespace.

## 3. Branch and environment protection

- Settings → Branches → add a rule for `main`: require a pull request before merging,
  require approvals (1 is enough to start), require status checks to pass (typecheck,
  tests, build), dismiss stale approvals on new commits.
- Settings → Environments → `production`: add yourself as a required reviewer. Until you
  do, `deploy.yml`'s `environment: production` is a label; after, every production deploy
  waits for your approval. The `rollback` workflow targets the same environment, so
  rollbacks are gated too.
- First staging deploy: merge any PR (or run the `stage` workflow manually) and confirm
  the staging bot answers `/start`, search works, and the smoke step passes.

## 4. Billing decision

`ASK_BILLING` is `"off"` in `wrangler.jsonc`: every answer is measured for
`/api/admin/usage` and the old 100-a-day cap applies, but nothing charges. Before turning
it on with a large audience:

- Re-check `ASK_USD_PER_MTOK` against Anthropic's current input-token price for the
  configured `CLAUDE_MODEL`, and `ASK_USD_PER_STAR` against what a Star nets after
  Telegram's cut. The margin math is in `wrangler.jsonc`; if either price moved, the
  plans stop paying for themselves.
- Run a paid end-to-end on staging: buy the smallest Star pack, confirm the balance,
  ask until it deducts, confirm the meter in the app matches.
- The billing balances live in D1 as of Sep 30 (atomic, version-checked updates;
  payments idempotent per Telegram charge id; usage totals in D1 too). The KV race is
  closed; leftover `acct:` keys are adopted on first sight.

## 5. Launch gates (from PRODUCT_READINESS.md)

- [ ] Required checks pass on protected `main`
- [ ] Staging and production have separate secrets and databases (done in code; verify)
- [ ] A failed deployment can be rolled back without rebuilding (run the `rollback`
      workflow against staging once as a drill)
- [ ] D1 size alert threshold (`D1_SIZE_ALERT_BYTES`, default 8 GB) matches Cloudflare's
      current per-database ceiling
- [ ] Daily-message opt-out tested end to end on staging
- [ ] Auth, webhook, payment, sharing, and subscription abuse cases reviewed
- [ ] `docs/PRIVACY.md` matches actual telemetry and retention
- [ ] Five representative users complete search → timestamp → Scripture → share

## 6. Sharing it with a large audience

The code is built for it, but know the levers:

- **Daily verse:** paced at ~25 messages/second with 429 backoff and resume checkpoints.
  10,000 subscribers take about 7 minutes inside the hourly cron; 100,000 take about
  70 minutes, and the previous hour's unfinished slot is finished first, so nothing is
  skipped. Watch the `daily` log lines (`sent`/`dropped`/`failed`) after the first big day.
- **Ask CyberJudah:** the expensive path. Per-user daily quotas (100 asks, 50 TTS) bound
  one person's spend; the free allowance (`ASK_FREE_DAILY`, 120,000 units ≈ 2 average
  answers) bounds everyone's. `/api/admin/usage` shows real averages — re-tune the
  allowance from that data, not from guesses.
- **Search:** D1 FTS, cheap and cacheable. The `/api/search` cache headers are the lever
  if read volume spikes.
- **What pages you:** the hourly self-check messages `ADMIN_IDS` on Telegram when D1,
  the teachings index, Vectorize, D1 size, or the daily send's failure rate goes bad —
  and again when it recovers. It repeats every 6 hours while still failing.
