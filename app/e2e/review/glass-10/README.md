# Platform/performance visual review

Actual production-browser captures at 390×844 and 1280×800: light, dark, sepia and reduced-transparency appearances, each showing the reader, held dock selection, verse-selection sheet and Scripture menu. There are 32 images before and 32 after. Remote thumbnails are blocked consistently; Bible text/relations come from the same cached public data.

- Before: section 09 production bundle, with equivalent runtime at `8be015b`.
- After: `2ec3fb5281753d0b073be5cb4dbae0fd95434300`, including the static icon-path optimization and Search touch fix.
- The visual result should remain consistent; the optimizations change repeated rendering work and snapshot scope.
- These are browser screenshots, not physical Telegram-device captures.

## Production measurements

Chromium 153.0.8010.12, 390×844, 4× CPU throttle, one fresh browser context per action. Both builds use the same committed Genesis fixture and Telegram SDK mock. Remote fonts/thumbnails are blocked. These were sequential samples with no build or browser suite running alongside them. Each action includes 500ms after completion; the dock sample includes releasing onto Classes and the route's initial layout.

The following are animation-frame intervals, in milliseconds:

| Action | Before median / p95 / max | After median / p95 / max |
| --- | --- | --- |
| dock-drag | 16.7 / 33.3 / 183.2 | 16.7 / 16.7 / 50 |
| sheet-open | 16.7 / 83.3 / 200 | 16.7 / 33.4 / 66.7 |
| menu-morph | 16.7 / 33.3 / 183.3 | 16.7 / 50 / 166.7 |
| reader-scroll | 16.7 / 16.8 / 66.6 | 16.7 / 16.8 / 50 |

The 16ms target is **not met**. A 60Hz refresh interval is normally about 16.7ms, but the traces also show real work exceeding 16ms: this is not just rounding. Median/p95/maximum task work between instrumented animation callbacks is retained in the JSON reports. Those callback intervals are diagnostic windows, not exact display-refresh boundaries. Nested task spans are unioned, not double-counted.

The after sample's maximum work intervals are 47.73ms (dock), 87.60ms (sheet), 95.65ms (menu) and 57.25ms (scroll). Trace inspection attributes the remaining larger costs to initial layout/React commits and native View Transition setup. The menu retains the requested native transition; its p95 frame interval increased in this single sample. The evidence supports less repeated style/layout work, not a guarantee of improvement on every frame or device.

## Reproduce

Serve the production build of each named commit separately. With dependencies and Playwright Chromium installed, run from the repository root:

```sh
PROFILE_ORIGIN=http://127.0.0.1:4173 \
PROFILE_COMMIT=$(git rev-parse HEAD) \
PROFILE_DIR=/tmp/liquid-glass-profile \
node app/e2e/review/glass-10/profile.mjs
```

`PROFILE_COMMIT` must identify the source used to build the served assets, which can differ from the checkout containing this harness. The script writes `profile.json` and four raw Chrome traces to the chosen directory; load those traces into Chrome DevTools Performance. The committed reports contain the two measured source revisions. The harness uses the existing `bot/tests/fixtures/bs/api/kjv/genesis/1.json`, byte-identical to the data used in these samples. Raw traces remain generated artifacts because they are large and machine-specific.
