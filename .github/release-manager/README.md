# Release manager

`.github/workflows/release-manager.yml` runs `release_manager.py` (Python standard library only,
reusing the GitHub helpers in `../custodian/custodian.py`) with this repository's own
`GITHUB_TOKEN`. The app repository (`DevSecObie/cyberjudah-app`) is public, so no other token is
needed. Settings are in `config.json`.

## What it does

| When | What |
|---|---|
| Every day at 13:17 UTC, and when run by hand | Rewrites one open issue, **Release status**, about the app's release branch (`release_branch` in `config.json`). It comments (and mentions the owner) and sends one Telegram message only when something **new** turns red, and once when all is clear again. |
| A pull request changes the release manager | Prints the same report in the run summary. Nothing is written. |

The report covers:

- **Store build settings**, read from `apps/expo/app.config.ts` and `apps/expo/eas.json` on the
  release branch's newest commit: app version and runtime, iOS build number, Android version
  code, Expo project id, the store profile's update channel and bundle id, the settings a store
  build must have (`store_env_expected`), no staging or local address in any of its values
  (`store_env_forbidden`), not a simulator, development or internal build, the App Store Connect
  app id, and that the iOS Firebase file it names exists and is for the store bundle id.
- **Next build number**: App Store Connect refuses a build number it already has. `store_builds`
  lists the builds already sent; the report says when `buildNumber` must be raised before the
  next store build, and turns red if the version goes below one already sent.
- **Checks** on the release branch's newest commit. `known_failing_checks` marks a failure that
  is already known (shown as a warning with the reason, not as red).
- **Build workflows**: latest run and last success of each workflow in `watch_workflows`, and
  runs waiting for Approve.
- **Pull requests into the release branch**, and those ready for more than 48 hours.
- **In the next release**: the pull requests merged since the newest entry in `store_builds`.

## After each store build

Add the build to `store_builds` (version, build number, the commit it was built from, date) so
the next-build-number check and "In the next release" start from it.

## What it never does

- Start a build, submit to a store, publish an app update, merge, approve or reject anything.
- Change a setting, a branch or a file in the app repository.
- Read a secret's value into a log. The report job runs in the `automation` environment and uses
  only the bot token and chat id it sends alerts with.
