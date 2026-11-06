# Timeline chronology verification

The timeline uses an inherited BC calendar. The KJV states relative ages, not these
absolute BC dates. Preserve that distinction when correcting the chart.

## Abraham correction — 6 November 2026

The imported birth at 1950 BC and death at 1771 BC produced a 179-year lifespan.
Four independent, already-present chart anchors agree on a birth at 1946 BC:

| Existing chart anchor | KJV relation | Implied Abraham birth |
| --- | --- | --- |
| Death, 1771 BC | 175 years, Genesis 25:7 | 1946 BC |
| Ishmael's birth, 1860 BC | Abraham aged 86, Genesis 16:16 | 1946 BC |
| Departure from Haran, 1871 BC | Abraham aged 75, Genesis 12:4 | 1946 BC |
| Sarah's birth, 1936 BC | Ten years younger, Genesis 17:17 | 1946 BC |

`shared/timeline-chronology.mjs` applies that correction when building the web
timeline from the preserved upstream snapshot. The generated backend publication
inherits it. A native bundle must be imported from that same publication before
candidate acceptance. The regression checks cover rebuilding, the chart's
relative ages, and the API date string.

## Unresolved release blocker

Isaac's inherited birth at 1851 BC is 95 years after Abraham's corrected birth;
Genesis 21:5 states 100. Circumcision at 1852 BC also implies age 94 instead of 99
(Genesis 17:24), and conflicts with Ishmael's age 13 (Genesis 17:25). Simply moving
Isaac's birth five years later breaks his 180-year lifespan (Genesis 35:28) and
his age 60 at Jacob's birth (Genesis 25:26). Moving the whole descendant chain
affects later events and Egypt chronology. Those dates have not been shifted
without a coherent, sourced reconciliation.

Run `npm run verify:timeline` to require the original KJV assertions and the
circumcision ages to pass.
It currently exits 1 at Genesis 21:5 (95 versus 100); this is a real release
failure. The deploy workflow runs this check before its deploy dependency can
succeed; the root `npm run deploy` command requires it too. The ordinary unit suite retains the previously documented TODO for
this unresolved chronology, but does not establish release readiness. No test
assertion has been removed or weakened.

This correction is a review candidate, not a release approval. Resolving the
remaining chronology, exact-commit CI, account-deletion production verification,
and clean native/device acceptance remain necessary.

## Local verification of this correction

- `npm run typecheck` and `npm run build`: passed. The build still reports large
  chunks and the existing pending Between-the-Testaments boundary years.
- `npm test`: app 155 passed / 1 chronology TODO; bot 545 passed / 6 emulator
  skips; resource API 106 passed / 1 integration skip. These skips are not
  production acceptance evidence.
- The focused timeline suite: 13 passed / 1 chronology TODO. Strict release
  mode: 3 passed / 1 failed, with no skips or TODOs.
- The API regression verifies `1946 BC–1771 BC`, a 175-year chart bar, and the
  complete 991-event / 21-period publication. All 434 Final Captivity records
  continue to match their sources.
- Rebuilding the backend publication and importing it into the native candidate
  produces byte-identical JSON, metadata, catalogs and offline ZIP. A structural
  comparison confirms exactly one changed web event: Abraham's start year.
- The focused Chromium regression against a local Worker passed and captured the
  rendered event page showing `1946-1771 BC (175)`. This is a targeted browser
  check, not authenticated production or device acceptance.

The earlier account-deletion emulator/CI changes are preserved separately at
`f64b34f527a47532ded7b1c7049ffdffd9001ace` on
`codex/release-verification-20261106`. This chronology branch starts from
`b3d5f40403f56cc204bd7fddae9e91691d558d0e` and does not subsume that work.
