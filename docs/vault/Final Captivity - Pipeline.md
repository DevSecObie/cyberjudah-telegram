---
tags: [timeline, code]
---
# Final Captivity: pipeline

All of it is in `app/scripts/final-captivity/`.

| File | Role |
|---|---|
| `periods.json` | The age and its periods (id, years, summary) |
| `events.json` | Published events |
| `drafts.json` | Events waiting on a decision. Not shown in the app |
| `ledger.json` | Which sources were reviewed, and through what date |
| `leaders.json` | The IUIC leaders and their portrait files |
| `COVERAGE.md` | The coverage inventory: what each period has and lacks |
| `check.mjs` | The validator: groups, peoples, books, references, quote windows, teaching URLs, leaders and portraits |
| `build.mjs` | Writes the bars into `timeline.json` (`fc:true`, `group`, `leader`, ids from 900000) and the content into `app/src/data/final-captivity.json`. Skips periods that have no events |

`timeline-data.mjs` calls `writeFinalCaptivity`.

## Tests
- `app/tests/final-captivity.test.mjs` (12 tests).
- `e2e/timeline.spec.ts`: period count, the Final Captivity flow, the leader portrait.

## Adding an event
1. Add it to `events.json`, or to `drafts.json` if it is not ready.
2. Run `node app/scripts/final-captivity/check.mjs` until it is clean.
3. Run the timeline data build, then the unit and e2e tests.
4. Open a PR. Never merge without the owner.

Back to [[Final Captivity]].
