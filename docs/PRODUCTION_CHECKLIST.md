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
| `FIREBASE_SERVICE_ACCOUNT` | Required once account sync is turned on for production builds (`VITE_ACCOUNT_SYNC`, below): the Firebase service account JSON the Worker signs Firestore access with (`bot/src/firebase-auth.ts`, `bot/src/firestore-admin.ts`). `deploy.yml` runs `wrangler secret list` before deploying and refuses the run — the Worker is not deployed — if `VITE_ACCOUNT_SYNC` is on and this secret is absent, so no reader signs in to a Worker that cannot verify them |

Repository variables:

| Variable | Used for |
|---|---|
| `TELEGRAM_APP_URL` | The production Mini App URL, baked into the app build |
| `WORKER_URL` | Optional: override for the worker's public URL |

Build-time flags set directly in `deploy.yml` (not repository secrets or variables, so there is
nothing to add in GitHub's Settings for these two):

- `VITE_ACCOUNT_SYNC` — bakes account sync (cross-device highlights, notes, bookmarks and
  personal studies through Firebase) into the production app build. Flip it off in `deploy.yml`
  to ship without account sync; flip it on only once `FIREBASE_SERVICE_ACCOUNT` is set, or the
  `wrangler secret list` check above stops the deploy.
- `VERIFY_ACCOUNT_SYNC` — tells the post-deploy smoke test (`bot/scripts/verify-release.mjs`) to
  also check the Firebase identity bridge (`POST /api/firebase/token` mints a real custom token
  for a synthetic reader); on only when `VITE_ACCOUNT_SYNC` is on.

Do **not** set `ADMIN_IDS` on the staging worker — staging's hourly self-check would page
you about staging's own (expected) differences. Staging keeps its own `health:state` in its
own KV namespace.

- [ ] **Before turning on `VITE_ACCOUNT_SYNC` in production:** restrict the Firebase web API
      key (`app/src/sync/account.ts`) to the app's own origins, in the Google Cloud console
      (APIs & Services → Credentials → the key → Application restrictions → HTTP referrers).
      The key is public in the client bundle by design (Firebase's own model); restricting it
      to CyberJudah's origins is what keeps another site from billing requests against it.

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

- Re-check `ASK_USD_PER_STAR` against what a Star nets after Telegram's cut: top-ups add
  exactly that per Star (no margin), so if the payout moved, update it. The models' prices
  come from `shared/ask-models.json` (rebuild it when Cloudflare's catalog changes).
- Run a paid end-to-end on staging: buy the $1 top-up, confirm the balance,
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
- **Ask CyberJudah:** the expensive path. Paid models are paid from each reader's balance at
  cost; the free model is bounded by the per-user daily quota (100 asks, 50 TTS).
  `/api/admin/usage` shows each day's real cost and charges.
- **Search:** D1 FTS, cheap and cacheable. The `/api/search` cache headers are the lever
  if read volume spikes.
- **What pages you:** the hourly self-check messages `ADMIN_IDS` on Telegram when D1,
  the teachings index, Vectorize, D1 size, or the daily send's failure rate goes bad —
  and again when it recovers. It repeats every 6 hours while still failing.
