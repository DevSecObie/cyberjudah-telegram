# Incidents and hang-ups

Everything that broke for people, stopped a deploy, or left production in a half-state, with
what people saw, the cause, the fix, where the fix first reached production, and what now
stops it from coming back. Newest first. Product-facing changes are in [CHANGELOG.md](../CHANGELOG.md).

How each row was checked (2026-10-02, against `main` at `799f696`):

- **Fix on main:** `git merge-base --is-ancestor <fix> origin/main`.
- **First deployed:** the first successful production deploy run whose commit contains the fix.
  The deploy runs are the `deploy` workflow's push runs; a run cancelled while waiting for approval
  deployed nothing.
- **Symptom and cause:** taken from the fix's commit or pull-request description, and from deploy
  logs where a run failed. None of the symptoms was reproduced again on the old code, except where
  a regression test now fails on it (noted as "fails on the old code").
- **Regression coverage:** the test that would catch the same failure now. "None" means none.

## Open

| Opened | What people see | Cause | Status | Tracking |
|---|---|---|---|---|
| 2026-10-01 | A production deploy goes red after the new Worker is already live; the webhook, commands and secrets step is skipped | The search-index import runs after `wrangler deploy`; D1 runs one import at a time and the single 15 s retry was shorter than a running import ([run 36915871818](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36915871818): "Currently processing a long-running import") | Fix in review: wait out a busy import (30–240 s pauses, ~9 min) | [#78] |
| 2026-10-01 | Search can fail while a deploy runs | Every deploy re-imports the full 147 MB search index, and wrangler warns that "your D1 database will be unavailable to serve queries" during the import. How long Search is down has not been measured | Needs a decision: skip the import when the data set's index is unchanged | None yet |
| 2026-09-30 | Precept-pass fixes requested with `@codex` are never made | The Codex GitHub connector answers every request with "To use Codex here, create a Codex account and connect to github" (cyberjudah #14, #15) | Codex connected by the owner on 2026-10-02; the fixes were requested again on both pull requests the same day | cyberjudah [#14](https://github.com/DevSecObie/cyberjudah/pull/14), [#15](https://github.com/DevSecObie/cyberjudah/pull/15) |

## Resolved

| Date | What people saw | Cause | Fix | Fix on main / first deployed | Regression coverage |
|---|---|---|---|---|---|
| 2026-10-02 | The verse-selection sheet grew into a large floating card with a cyan rim and wrapped actions, live 02:51–03:51 UTC | [#75] changed the sheet's layout and behaviour, not only its material | [#76] | yes / 2026-10-02, run 36961422040 | e2e "the verse-selection sheet keeps Bible Strong's size" ([#79]); before it, none |
| 2026-10-02 | After dragging the dock, the next tap did nothing (caught in CI before release) | The click ending a drag was swallowed for 80 ms | [#74] (`0026f8f`) | yes / 2026-10-02, run 36961422040 | e2e "liquid glass: … a plain tap on another section still opens it" |
| 2026-10-01 | The nightly and post-deploy embedding failed ("Max context reached 63000 tokens") | A batch of 100 long passages passed bge-m3's 60,000-token limit | [#68] (`2ac6602`) | yes / 2026-10-01, run 36916930059 | None |
| 2026-10-01 | Two end-to-end tests failed on `main` after [#67] | The tests expected the old copy and layout | [#68] (`fcef18d`) | yes / 2026-10-01 | The tests themselves |
| 2026-10-01 | A live-site probe workflow landed on `main` | [#22] merged by mistake | Reverted in [#55] | yes / 2026-10-01 | None (process) |
| 2026-10-01 | A typed search was lost when a Classes filter changed | A filter replaces the address, giving the screen a new history key | [#56] | yes / 2026-10-01, run 36916930059 | e2e "Classes: a feed of posts … kept on the way back" (`telegram.spec.ts:1136`) |
| 2026-09-30 | A phone's back gesture from the first screen left a black screen until a refresh | A back step walked out of the app's history onto a blank page | [#38] | yes / 2026-09-30, run 36792258330 | e2e "a back step from the first screen stays in the app" (`telegram.spec.ts:1567`) |
| 2026-09-30 | Ask: every later question in a chat failed | A history opening on an answer was rejected by the model (400) | [#41] (`normalizeHistory`) | yes / 2026-09-30 | unit `bot/tests/chats.test.mjs` |
| 2026-09-30 | Drawers closed by themselves while the Bible loaded (CI) | Drawers closed on any address change, including a replace | [#37] | yes / 2026-09-30 | e2e drawer tests (`telegram.spec.ts:345`) |
| 2026-09-30 | Staging: chapters answered 503, class media 500 | Cloudflare environments do not inherit `vars`; staging had no `DATA_ORIGIN` | [#27] | yes / 2026-09-30 | unit `bot/tests/wrangler.test.mjs` |
| 2026-09-30 | Staging deploys failed ("long-running import") | Two runs imported into one database at once | [#27] (concurrency group) | yes / 2026-09-30 | None |
| 2026-09-30 | Blank Mini App from the bot's buttons | The router always took `/app` as its base; the bot opens the Worker's root | [#21] | yes / 2026-09-30, run 36792258330 | unit `app/tests/basename.test.mjs` ([#79]); fails on the old code |
| 2026-09-30 | A production deploy failed: `https://data.cyberjudah.io/search.sql.gz: 404` ([run 36723132065](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36723132065)) | The data set had split the index into parts; the loader still fetched the whole file | [#20] | yes / 2026-09-30 | None |
| 2026-09-30 | Blank page at `cyberjudah.io/app` | Assets staged only at the root (module scripts got `index.html`), and the router base ended in a slash | [#18] | yes / 2026-09-30, run 36792258330 | unit `app/tests/basename.test.mjs` and `bot/tests/prepare-assets.test.mjs` ([#79]); both fail on the old code |
| 2026-09-30 | Risk, no reported loss: concurrent requests could spend one balance twice or slip past a rate limit | Billing and quotas were read-modify-write in KV | [#16] | yes / 2026-09-30 | unit `bot/tests/billing.test.mjs` (`takeOf`, `settleTake`) |
| 2026-09-29 | Search and Ask "not answering" for anyone who had left the app open | Launch data older than three days was refused | `ed9ac6d` | yes / 2026-09-29, run 36642791665 | unit `bot/tests/initdata.test.mjs` window test ([#79]); fails with a 3-day window |
| 2026-09-28 | The note editor ran off the screen and Save could not be reached | The screen's entrance transform trapped fixed layers inside the page | `324ac1a` | yes / 2026-09-28, run 36497486971 | e2e "an admin's note editor fits the phone" ([#79]) |
| 2026-09-27 | Long notes failed to save with a bare error | Encoding a long note overflowed the stack | `815836a` | yes / 2026-09-27, run 36306399441 | unit `bot/tests/edit.test.mjs` (150 KB note) |
| 2026-09-27 | A refused note edit gave no reason | The sheet showed one generic line | `a469b61` | yes / 2026-09-27 | None |
| 2026-09-26 | Every deploy failed at the check job | Easton's dictionary was removed from the site repository (404) | `c4b59d4` | yes / 2026-09-26, run 36279966157 | None |
| 2026-09-26 | Deploys failed without saying why | Index-creation errors were hidden, and a pipe hid the deploy's own failure | `4fd4453` | yes / 2026-09-26 | None |
| 2026-09-26 | Loading the captions failed, and searches stalled while it ran | `wrangler` pointed at a placeholder database id; file imports lock the database | `2d3392b`, `7ab3d2c` | yes / 2026-09-26 | None |

## Deploy record

From the `deploy` workflow's 154 push runs on `main` (2026-09-26 to 2026-10-02): 116 deployed,
22 were cancelled while waiting to deploy (nothing deployed; the next deploy carried their
commits), and 16 failed. 13 of the 16 failures fell on 2026-09-26 while the pipeline was being set
up (secrets, dictionary, index and bucket creation, D1 loading); they are summarised by the
2026-09-26 rows above and were not re-examined one by one. The other three: `d083f0e`
([run 36723132065](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36723132065), search index 404, fixed by [#20]); `e746728`
([run 36770171200](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36770171200), failed in "Deploy the worker"; the log shown by the API does not include the error
line, so the cause is not confirmed); `d971840` ([run 36915871818](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36915871818), the open D1 import row above).

[#16]: https://github.com/DevSecObie/cyberjudah-telegram/pull/16
[#18]: https://github.com/DevSecObie/cyberjudah-telegram/pull/18
[#20]: https://github.com/DevSecObie/cyberjudah-telegram/pull/20
[#21]: https://github.com/DevSecObie/cyberjudah-telegram/pull/21
[#22]: https://github.com/DevSecObie/cyberjudah-telegram/pull/22
[#27]: https://github.com/DevSecObie/cyberjudah-telegram/pull/27
[#37]: https://github.com/DevSecObie/cyberjudah-telegram/pull/37
[#38]: https://github.com/DevSecObie/cyberjudah-telegram/pull/38
[#41]: https://github.com/DevSecObie/cyberjudah-telegram/pull/41
[#55]: https://github.com/DevSecObie/cyberjudah-telegram/pull/55
[#56]: https://github.com/DevSecObie/cyberjudah-telegram/pull/56
[#67]: https://github.com/DevSecObie/cyberjudah-telegram/pull/67
[#68]: https://github.com/DevSecObie/cyberjudah-telegram/pull/68
[#74]: https://github.com/DevSecObie/cyberjudah-telegram/pull/74
[#75]: https://github.com/DevSecObie/cyberjudah-telegram/pull/75
[#76]: https://github.com/DevSecObie/cyberjudah-telegram/pull/76
[#78]: https://github.com/DevSecObie/cyberjudah-telegram/pull/78
[#79]: https://github.com/DevSecObie/cyberjudah-telegram/pull/79
