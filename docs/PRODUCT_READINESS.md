# Product readiness and transcript-search growth plan

## Product thesis

CyberJudah should lead with one unmistakable promise:

> Search what was taught, jump to the exact moment, study the Scripture behind it, and share it in Telegram.

Timestamped search across the teaching archive is the primary acquisition loop. Bible reading, notes, plans, and daily verses turn that discovery into retention.

## Core funnel

1. **Acquire:** a shared timestamped result or Telegram inline result opens the app.
2. **Activate:** the visitor sees the matching words, surrounding caption, class title, and exact playback moment.
3. **Deepen:** linked Scriptures and class notes open without losing the result.
4. **Retain:** save the result, follow a topic, continue reading, or enable a daily verse.
5. **Refer:** share a timestamped teaching card back into a chat or story.

## First release success measures

Collect aggregate, privacy-conscious events without note text, raw queries tied to users, precise location, or Telegram launch data.

- Transcript searches completed and searches with zero results
- Result opens and successful timestamp playback
- Scripture or class-note opens from a result
- Shares initiated and completed
- Daily-verse opt-in and opt-out
- Returning sessions and reading-plan continuation
- API error rate, search latency, ingestion freshness, and D1 capacity

Before adding analytics, document the provider, retention, fields collected, opt-out behavior, and update PRIVACY.md.

## Delivery phases

### Phase 1 — Safe beta foundation

- Required CI: typecheck, unit tests, build, and Playwright smoke tests
- CodeQL, dependency review, and automated dependency updates
- Security, privacy, contribution, and operational documentation
- Stricter Telegram launch-data freshness checks
- Protected `main`, review requirements, and a staging environment
- Error, webhook, cron, ingestion, and upstream-health monitoring

### Phase 2 — Transcript acquisition experience

- Make transcript search the primary home-page call to action
- Give every hit a canonical deep link containing video and timestamp
- Generate share cards that preserve the matched excerpt and exact moment
- Add useful zero-result recovery: spelling suggestions, related topics, and Scripture search
- Preserve search context when opening notes, Scripture, or video
- Add topic landing pages built from transcript results

### Phase 3 — Retention and release discipline

- Saved searches or topics with explicit notification controls
- In-app privacy controls and a complete reset/export path
- Tagged beta releases, changelog, release checklist, and rollback drills
- Accessibility, low-bandwidth, older-Telegram, and browser-fallback testing

## Launch gates

A public beta is ready when:

- All required checks pass on protected `main`
- Staging and production have separate secrets and databases
- A failed deployment can be rolled back without rebuilding
- D1 and ingestion capacity have alerts and documented thresholds
- Daily-message opt-out is tested end to end
- Authentication, webhook, payment, sharing, and subscription abuse cases are reviewed
- Privacy wording matches actual telemetry and retention
- At least five representative users successfully complete search → timestamp → Scripture → share

## Product guardrail

Do not let secondary features obscure the core loop. A new feature should improve acquisition, activation, study depth, retention, or sharing—and should have a measurable success condition before implementation.
