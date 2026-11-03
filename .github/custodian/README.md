# Custodian: deployment manager and repository custodian

`.github/workflows/custodian.yml` runs `custodian.py` (Python standard library only) with this
repository's own `GITHUB_TOKEN`. Settings are in `config.json`. The same three files are in every
CyberJudah repository (cyberjudah, cyberjudah-telegram, cyberjudah-app, cyberjudah-mobile, open-ota).

## What it does

| When | What |
|---|---|
| Every day at 12:07 UTC, and after each production deploy | Rewrites one open issue, **Deployment health**: latest deploys and their last success, runs waiting for your Approve, environments and when each was last deployed, live endpoints, which secrets are set, whether the Cloudflare, Telegram and GitHub tokens still work and when they expire, and ready pull requests older than 48 hours. It comments (and mentions the owner) only when something **new** turns red, and once when all is clear again. |
| A pull request merges | Deletes its branch, but only if a merged pull request's head is still the branch tip, no open pull request uses it as head or base, it is not the default branch, not protected, no ruleset covers it, and it is not on the keep list. |
| Every day | Same check for branches merged in the last 14 days (catches any the merge event missed). |
| By hand: task `branches`, `backlog` on | Lists every older merged branch that could go. Turn `delete` on as well to remove them (at most 100 per run). |
| A production deploy fails **after going live** (cyberjudah-telegram) | `deploy.yml` already puts production back on the version serving before it. The custodian then opens a revert pull request for the owner to approve, so the next merge does not ship the same change again. |

Every deleted branch can be brought back with **Restore branch** on its pull request page.

## What it never does

- Merge, deploy, approve a deployment or bypass the `production` environment's reviewers.
- Start a store build or submit to a store.
- Delete or change an environment. Environments not deployed in 30 days are marked
  "inactive; remove only if you say so" in the report.
- Read a secret's value into a log. Presence reaches the runner as `true`/`false` only
  (`secrets.NAME != ''` is evaluated by GitHub). The token checks print only valid, rejected
  or the expiry date, and never print error text from a call that carries a token.
- Create or rotate secrets.

## Keep list

Never deleted, whatever their state: the default branch, `main`, `master`, `develop`,
`gh-pages`, `gh-readonly-queue/*`, `release*`, `*release*`, `staging*`, `*staging*`, `codex/*`,
`*revenuecat*`, `archive/*`, `backup/*`, `hotfix/*`, `data`, plus `keep_branches` in
`config.json`.

## Settings the owner may want

- **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**:
  needed for the revert pull request. Without it the custodian pushes the revert branch and
  comments with a link instead. (Approving stays off: it never approves anything.)
- Pull requests opened by a workflow do not start other workflows, so a revert pull request's
  checks start when someone pushes to it or runs them by hand.
