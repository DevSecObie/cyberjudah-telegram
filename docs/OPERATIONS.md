# Operations runbook

## Services

- Cloudflare Worker: static app, API, bot webhook, cards, and hourly cron
- D1: teaching and transcript search indexes
- KV: daily-verse subscriptions
- `data.cyberjudah.io`: Bible and library content
- Telegram Bot API: bot commands, inline mode, sharing, payments, and delivery

## Health signals

Monitor:

- Worker 5xx rate and p95 latency by route
- Unauthorized and rate-limited requests separately from server failures
- Telegram webhook failures and processing latency
- Daily-verse attempted, delivered, blocked, and failed counts
- Search and transcript-query latency and zero-result rate
- Latest successful search and transcript ingestion timestamps
- D1 size, row writes, query errors, and capacity thresholds
- Upstream content availability and schema compatibility
- Deployment status and current commit SHA

Logs must not include bot tokens, webhook secrets, raw Telegram `initData`, note contents, precise location, or full user profiles.

## Deployment

Use separate staging and production Cloudflare resources and GitHub environments. Production deployment should require a successful staging smoke test and an approval. Record the deployed commit SHA.

## Rollback

1. Identify the last known-good commit and confirm whether a database migration is involved.
2. Redeploy that exact artifact or commit; do not rebuild with newly resolved dependencies.
3. Verify the health endpoint, Telegram webhook, authenticated search, daily subscription, and a deep link.
4. If data compatibility prevents rollback, disable affected writes and follow the migration recovery procedure.
5. Record the incident and follow-up actions.

## Incident priorities

- P0: credential exposure, unauthorized data access, destructive corruption, or widespread payment abuse
- P1: app/bot unavailable, authentication broken, or daily messages broadly failing
- P2: degraded search, stale ingestion, client-specific regression, or elevated latency

Rotate exposed credentials immediately, preserve non-sensitive evidence, and use GitHub's private vulnerability reporting for security incidents.

## Backups and recovery

Define and test D1 backup/export and KV subscription recovery before public launch. Document recovery time and recovery point objectives after the first successful drill.

## Release checklist

- Required checks pass
- Security and dependency findings reviewed
- Staging smoke test passes
- Data migrations and rollback compatibility reviewed
- Privacy documentation matches telemetry changes
- Monitoring and alerts cover new routes or jobs
- Changelog and version tag prepared
- Production smoke test and owner recorded
