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

## Commit and review expectations

Use descriptive commit messages. Pull requests must pass type checking, unit tests, the production build, end-to-end smoke tests, dependency review, and CodeQL before merge.

Security-sensitive changes should describe the trust boundary and abuse cases considered. See [SECURITY.md](SECURITY.md).
