# Tab navigation review

Actual Chromium production-browser captures of the Bible Strong tab-flow adaptation, retaining CyberJudah's content, palette and Liquid Glass navigation. These are app screenshots and recordings, not visual mockups or physical Telegram-device captures.

- Before source: `3b7a6036ca0413f7cbc0e0a8c61fe5866cfeaeff` (the parent Liquid Glass runtime, also identical to `2169711` for app/bot runtime files).
- After source: `ada408e05b65b04313f318ab600568e2faa0809e`.
- Both use the same committed Genesis 1 fixture and Telegram SDK mock, four saved tabs and a reader position of 420 CSS pixels. Remote fonts/thumbnails are blocked consistently.
- Each phase has 16 PNGs: switcher and returned reader at 390×844 and 1280×800, in light, dark, sepia and reduced transparency. The reduced-transparency captures use the light palette.
- Each phase has `phone-flow.webm`, showing startup, reader → Tabs → reader → Tabs → Add. The before recording returns to the top; the after recording restores the reader's position. Recordings include startup rather than hiding the initial load.

| View | Before | After |
| --- | --- | --- |
| Phone overview | [Light](before/light-390-overview.png) · [Dark](before/dark-390-overview.png) | [Light](after/light-390-overview.png) · [Dark](after/dark-390-overview.png) |
| Phone return | [Light](before/light-390-reader.png) · [Dark](before/dark-390-reader.png) | [Light](after/light-390-reader.png) · [Dark](after/dark-390-reader.png) |
| Desktop overview | [Light](before/light-1280-overview.png) · [Dark](before/dark-1280-overview.png) | [Light](after/light-1280-overview.png) · [Dark](after/dark-1280-overview.png) |
| Motion | [Before recording](before/phone-flow.webm) | [After recording](after/phone-flow.webm) |

Add creates and reveals a new preview before expanding it. The selected page contracts into its card and expands back with the reference easing curve, adapted to CyberJudah's shared 380ms token. The dock is captured separately. Reduced motion fades only; unavailable/rejected View Transitions use a transform/opacity entrance. Preview geometry measures the width available beside the sidebar. Timeline now has its own title and clock icon.

See [the reference comparison](../../../../docs/TAB_NAVIGATION_PARITY.md) and [PR #120](https://github.com/DevSecObie/cyberjudah-telegram/pull/120) for behavior coverage, completed integration results and remaining platform limits. The existing 16ms performance target has not been met; these screenshots do not establish frame performance or native Apple rendering parity.

## Reproduce performance measurements

Serve production builds of the named before and after commits separately. Run the shared profiler from the repository root for each origin/source:

```sh
PROFILE_ORIGIN=http://127.0.0.1:4173 \
PROFILE_COMMIT=ada408e05b65b04313f318ab600568e2faa0809e \
PROFILE_DIR=/tmp/tab-flow-profile \
PROFILE_ACTIONS=dock-drag,sheet-open,tab-overview,tab-return \
node app/e2e/review/glass-10/profile.mjs
```

The harness uses Chromium at 390×844 and 4× CPU throttle, fresh contexts for each action and the same committed Scripture/SDK fixtures. It records animation callback intervals and unioned main-thread task work, and writes `profile.json` plus four raw DevTools traces. Tab actions start with four tabs and a 420px reading position. The return measurement prepares the overview before tracing. All samples include 500ms after the action. Run it without builds or browser suites competing for CPU.
