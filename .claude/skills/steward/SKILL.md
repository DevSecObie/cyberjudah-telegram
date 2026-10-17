---
name: steward
description: Keep CyberJudah for Telegram working. Use when driving a pull request to green, answering CI or review events, checking that main and production are healthy, or before saying a change is ready.
---

# Steward: keep the app working

A pull request is done only when all three hold:
- CI is green on its current head.
- It has no merge conflict.
- Its user-visible changes have been shown to the owner.

Only the repository owner merges, approves the production deploy and tags releases. Never merge, approve or tag yourself.

## What runs on a pull request

| Check | Workflow | What it is |
|---|---|---|
| `check` | stage.yml, deploy.yml | `npm ci`, `npm run typecheck`, `npm test` (app and bot), `npm run build` |
| `browser-tests (chromium / firefox / webkit)` | e2e.yml | The Playwright suite in `app/e2e`, one job per engine |
| `playwright` | e2e.yml | A summary job. It is red when any engine is red, and when a newer push cancelled the run. Read the engine jobs, not this one. |
| `stage` | stage.yml | Deploys the PR to the staging Worker, then runs `bot/scripts/verify-release.mjs` against it. Runs take turns (one staging Worker), so they queue. |
| `changelog` | changelog.yml | Needs a new `changes/<branch with / as ->.md` file with `- ` lines, or `Changelog: not applicable — <reason>` in the PR description |
| `codeql`, `dependency-review`, `cms-content`, `ios`, `android` | security.yml, cms.yml, native-build.yml | Usually green; read the log if not |

On a push to main, `deploy` runs the same browser checks, then waits for the owner's approval in the `production` environment. After that it deploys, verifies the live app and rolls itself back if verification fails.

## Diagnosing a red check

1. Read the failed job's log with the GitHub tools (`get_job_logs`, `return_content`, `tail_lines` around 100–300). Playwright prints the failing test, the assertion, and expected and received values near the end.
2. Playwright artifacts (traces, screenshots) cannot be downloaded from this environment: blob storage returns 403. To see more, put the data in the assertion message (`expect(x, JSON.stringify({...})).toBe(...)`) and push. The message shows in the job log.
3. Decide whose failure it is before you fix anything:
   - **This PR's:** the failure is in code the PR touches or breaks. Root-cause it, fix it and push. A test that passes on a re-run is not fixed.
   - **Also red on main:** look at the latest `end-to-end` run on main. If a fix already exists in another open PR, merge that PR's branch into this one, so it becomes a no-op once main has it. Then post one comment on the PR naming the check, why it isn't this PR's, and what you merged.
   - **Known outside causes:** see the list below.
4. Re-run a job at most once, and only to confirm an outside cause. Never skip, disable or quarantine a test, never push an empty commit, and never close and reopen a PR to restart CI.

## Known causes that are not the PR's code

- **`stage` fails with `Search answer: HTTP 429 (limit)`.** The release check signs in as one synthetic reader (id 1). That reader's 20 search answers per UTC day (`SEARCH_AI_DAILY_LIMIT`) run out after many staging runs, and reset at 00:00 UTC. `SEARCH_AI_QUOTA_EXEMPT` on staging removes this once it is merged (PR #274). It is not the AI provider's limit.
- **`playwright` red with every engine green or cancelled:** a newer push superseded the run. Wait for the run on the new head.
- **`bot/tests/privacy-migrate.test.mjs`, "the subscription is sealed at rest":** the test looks for the text `333` inside random ciphertext, which occasionally contains it. It is a real flake with a known cause. Don't count it against a PR; propose the fix (check for `"chatId"` instead) in its own PR.

## Before you push

Run what CI runs, for the packages you changed:

```sh
npm run typecheck            # at the root: app and bot
npm test --workspace app     # app unit tests
cd bot && npm test           # bot unit tests (needs the root node_modules)
npm run build
```

Browser tests, locally:
- Only Chromium is available, at `/opt/pw-browsers`. Firefox and WebKit can't be downloaded, so those two engines run only in CI. Use a local config that is not committed (`app/playwright.local.config.ts`) that keeps only the chromium project and sets `launchOptions.executablePath` to the preinstalled Chromium. Run `npx playwright test -c playwright.local.config.ts <spec> -g "<name>"`.
- The suite starts its own server (a build, then `wrangler dev` on :8787) and reuses one that is already running. To stop it, run `pgrep -f '[w]orkerd serve' | xargs -r kill`. Never `pkill -f` a pattern that also appears in your own command line, because it kills your shell (exit 144).
- `e2e/telegram.spec.ts` reads live scripture from `data.cyberjudah.io`. `e2e/reader-parity.spec.ts` mocks scripture. Put a test that needs chapters and books where its data comes from.
- The local Worker has no search index. Search results and AI answers fail there; that is expected.
- Running the bot tests rewrites `bot/tests/.build/mydata.mjs`. Restore it (`git checkout -- bot/tests/.build/mydata.mjs`) before committing.

Before you push, re-read your diff and ask what would make CI reject it. Layout tests (large titles, bars, sheets) differ between engines. Firefox and WebKit can lay things out a frame later than Chromium, so in a test, measure once the thing being measured has settled (`expect.poll`). If a cross-engine layout fix is still red after two rounds of diagnosis, stop iterating and propose a simpler change or a revert to the owner.

## Conventions

- **Pull requests:**
  - One concern per PR.
  - Add a `changes/` entry for anything a reader would notice, written in plain words.
  - The description ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Open a PR only when asked to, or when it is the fix for a PR you are already driving.
- **Commits:** descriptive messages. No AI model names anywhere, in code, commits, PRs or docs. No `Co-Authored-By` or tool footer lines.
- **GitHub comments:** keep them few, and end each one with `---` and `_Generated by [Claude Code](https://claude.ai/code)_`.
- **Branches:** on someone else's branch, merge main in, and never rebase, amend or force-push. Regenerate lockfiles with npm, never by hand.
- **Visible changes:** take before-and-after screenshots (390×844, the light and dark themes) and show them to the owner before asking for a merge.
- **Bible reader:** follow what Bible Strong does (the `strong/` fork). Don't invent behaviour it doesn't have.
- **Never** disable TLS verification, commit secrets or launch data, or copy R2 class-outline text into a repository.

## Standing holds (ask the owner first)

- Firestore security rule changes.
- PR #213: wait until the owner confirms the Firebase API key restriction.
- PR #246: do not merge until the owner says to switch production.

## Health check of main and production

When asked whether things are working, or before saying the app can be released:
1. Find the latest `deploy` run on main. Check that its `deploy` job succeeded, and that the steps "Verify the Bible app" and "Verify the deployed app and authenticated search" passed with no rollback.
2. Check the latest `end-to-end` run on main for all three engines. A red engine on main is work: find or open the fix.
3. List the open PRs that are red or conflicted, and say what blocks each one.

Report it plainly: what is live, what is red and why, and what you did about it.
