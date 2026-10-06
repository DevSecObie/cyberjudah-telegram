## Summary

Describe the user or operational problem and the approach taken.

## Type of change

- [ ] Product feature
- [ ] Bug fix
- [ ] Security or privacy change
- [ ] Infrastructure or deployment change
- [ ] Data or schema migration
- [ ] Documentation only

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Playwright tests, when UI, navigation, Telegram integration, or storage changed
- [ ] Manual Telegram-client verification, when required
- [ ] A changelog entry as a new file in `changes/` (see `changes/README.md`), **or** `Changelog: not applicable — <reason>` in this description; outages and failed deploys also go in `docs/INCIDENTS.md`

## Risk and operations

- Trust boundary or abuse cases:
- New permissions, secrets, services, or data collected:
- Migration and rollback plan:
- Monitoring or alert changes:

## Product impact

- Core-loop stage affected: acquisition / activation / study / retention / sharing
- Success measure:
- Screenshots or recordings, if user-visible:

## Checklist

- [ ] Tests cover the changed behavior
- [ ] Documentation and contracts are updated
- [ ] No credentials, raw `initData`, personal data, or production exports are included
- [ ] Privacy documentation matches any telemetry or retention change
- [ ] Backward compatibility and older Telegram/browser fallbacks were considered
