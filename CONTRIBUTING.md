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
- Add a line to [CHANGELOG.md](CHANGELOG.md) under Unreleased. Anything that broke for people, or stopped a deploy, also gets a row in its Incident and hang-up log (what people saw, the cause, the fix).

## Releases

A release is cut from what reached `main`: Unreleased becomes the new version with its date (UTC), the version in `package.json` and `bot/package.json` is raised to match (regenerate the lockfile with `npm install --package-lock-only`), and the merge is tagged `vX.Y.Z`. Fixes only raise the patch number, new or visibly changed features the minor, and anything that breaks saved data, shared links or bot commands the major.

## Commit and review expectations

Use descriptive commit messages. Pull requests must pass type checking, unit tests, the production build, end-to-end smoke tests, dependency review, and CodeQL before merge.

Security-sensitive changes should describe the trust boundary and abuse cases considered. See [SECURITY.md](SECURITY.md).
