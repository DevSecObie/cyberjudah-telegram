# Upload notice recovery

Before: PR #123 at `ae3dcbdde9fb2ccd64617bb605220c8003fa5801`, production build.
After: `4715b891d8fc2f1a0c60f991e3604588a478a3af`, development build with the same
production styles; typecheck, production build and unit tests also pass for this source.
Captured 3 October 2026 (America/Los_Angeles) in Chromium at 390×844 and 1280×800,
light and dark. These are actual Classes screens using a deterministic retained-recording
fixture; the blank thumbnail is deliberate. They are not a capture of a live YouTube outage.

| View | Before | After |
| --- | --- | --- |
| Phone, light | [before](before/light-390.png) | [after](after/light-390.png) |
| Phone, dark | [before](before/dark-390.png) | [after](after/dark-390.png) |
| Desktop, light | [before](before/light-1280.png) | [after](after/light-1280.png) |
| Desktop, dark | [before](before/dark-1280.png) | [after](after/dark-1280.png) |

The dismiss target increases from 28×28 to 44×44. Measurements alongside the images
also check 200% text: neither the notice nor the page overflows horizontally in these
four views. The notice uses the existing content fill and text tokens; no glass or motion
is added. The copy permits successful fallback uploads while RSS is unavailable.

Five focused cases pass in each of Chromium, WebKit and Firefox: retained recordings and
keyboard dismissal at phone/desktop sizes, healthy and older-worker status responses, and
recovery followed by another outage. The original recovery investigation timed out because
`refetchOnWindowFocus` is disabled globally and `useRecent` had no polling. Status now
refreshes every minute during an RSS outage and every ten minutes otherwise, while visible.
Recovery resets dismissal. Backend fallback, retention, status semantics and caches are
unchanged from the parent's resolved implementation.

Typecheck, production build, 170 bot unit tests, 22 bot contract tests and 36 app unit tests
pass locally. Full browser CI runs independently for the review head. Physical Telegram
devices and live YouTube access are not available in this environment.
