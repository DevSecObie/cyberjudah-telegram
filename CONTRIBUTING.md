# Contributing

Thanks for improving CyberJudah for Telegram.

## Development

Use Node.js 22 or newer.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Run the browser suite before changing navigation, Telegram integration, storage, sharing, or Bible-reader behavior:

```sh
npx playwright install chromium
npm run test:e2e --workspace app
```

## Pull requests

- Keep changes focused and explain user-visible behavior.
- Add or update tests for every behavior change.
- Never commit tokens, launch data, production exports, or user information.
- Call out migrations, new permissions, new external services, and operational changes.
- Update documentation when routes, environment variables, scheduled jobs, or setup steps change.
- Add a line to [CHANGELOG.md](CHANGELOG.md) under Unreleased for anything a reader, an admin or the bot's users would notice. When nothing would be noticed (tests, CI, documentation, refactors), write `Changelog: not applicable — <reason>` in the pull request's description instead; the `changelog` check accepts either. Outages, failed deploys and data problems go in [docs/INCIDENTS.md](docs/INCIDENTS.md).

## Releases

No version has been tagged yet. A release is cut only from a commit that a successful production deploy ran (the `deploy` workflow's `deploy` job, green):

1. In one pull request, Unreleased in `CHANGELOG.md` becomes the new version with the deploy's date (UTC), and `package.json` and `bot/package.json` move to that version; regenerate the lockfile with `npm install --package-lock-only` and commit only that change.
2. Choose the number by the public contract (see the top of `CHANGELOG.md`): major if a reader's saved data, a shared link, a bot command or the app's API breaks; minor for a new or visibly changed capability; patch for fixes only.
3. After that pull request is merged and deployed, the repository owner tags the deployed commit `vX.Y.Z` and publishes the release notes from the changelog section. Tags and releases are created by the owner, not by automation.

## Commit and review expectations

Use descriptive commit messages. Pull requests must pass type checking, unit tests, the production build, end-to-end smoke tests, dependency review, and CodeQL before merge.

Security-sensitive changes should describe the trust boundary and abuse cases considered. See [SECURITY.md](SECURITY.md).
