# Timeline chronology verification

The KJV establishes relative ages and sequence, not the absolute BC calendar
used by this inherited chart. This correction retains Abraham's 1946 BC anchor.
It does not establish a uniquely proven biblical-to-BC chronology.

## Primary evidence and reconciliation — 6 November 2026

The existing death at 1771 BC, Ishmael's birth at 1860 BC, departure from Haran
at 1871 BC and Sarah's birth at 1936 BC agree on Abraham's birth at 1946 BC:
Genesis 25:7 gives 175 years; 16:16 gives 86 at Ishmael's birth; 12:4 gives 75
at departure; 17:17 gives the ten-year age difference from Sarah.

Keeping that anchor yields the following internally consistent sequence:

| Event | Chart year(s) BC | Primary constraint |
| --- | --- | --- |
| Circumcision | 1847 | Abraham 99, Ishmael 13; Genesis 17:24–25 |
| Isaac | 1846–1666 | Born when Abraham is 100; lives 180; Genesis 21:5, 35:28 |
| Isaac's marriage | 1806 | Isaac 40; after Sarah's death (1809); Genesis 25:20, 24:67 |
| Jacob and Esau born | 1786 | Twins; Isaac 60; Genesis 25:24–26 |
| Esau marries | 1746 | Esau 40; Genesis 26:34 |
| Jacob with Laban | 1709–1689 | Seven + seven + six years; Genesis 29:20, 29:27, 31:41 |
| Joseph | 1695–1585 | His 110 years; Genesis 50:22; birth derived through the rows below |
| Joseph's dreams | 1678 | Joseph 17; Genesis 37:2 |
| Butler/baker episode | 1667 | Two full years before Pharaoh's dream; Genesis 41:1 |
| Joseph before Pharaoh | 1665 | Joseph 30; Genesis 41:46 |
| Seven years of famine | 1658–1651 | After seven years of plenty; Genesis 41:53–54, 45:6 |
| Jacob enters Egypt | 1656 | Jacob 130; two famine years elapsed; Genesis 47:9, 45:6 |
| Jacob dies | 1639 | Seventeen years in Egypt, age 147; Genesis 47:28 |

Joseph's birth follows from Jacob's birth + 130 minus (Joseph's age 30 + seven
plentiful years + two famine years). The family's move is placed in the same
chart year as Joseph's invitation; scripture does not supply exact travel dates.
The famine-end event is now a point at 1651 BC; its inherited end preceded its
start. The butler/baker interval was also one year too short.

Genesis 17:21 promises Isaac the following year; Genesis 18–19 places the visit
and Sodom's destruction before his birth in Genesis 21. The chart places Sodom
and the immediately following cave episode in 1847 BC. The cave episode's exact
date is not stated; it retains an inferred narrative placement.

## Propagation and limits

The Isaac–Jacob–Joseph cluster moves five years later. Its other family events
and lifespan estimates move with it, preserving inherited relative intervals
where scripture gives no number. Their specific ages and BC dates are **not**
new claims proven by the cited passages. For example, Genesis 21:8 does not give
Isaac's age at weaning, and Genesis 22 does not give his age at the sacrifice.
Rebekah's separate inherited birth estimate and unrelated historical dates stay
unchanged. The correction changes 53 event identities / 69 repeated chart rows
beyond the earlier Abraham fix; only start/end dates change.

`shared/timeline-chronology.mjs` records explicit final dates rather than repeated
addition, so import and rebuild are idempotent. Every copy in adjacent periods
uses the same dates. The backend and native artifacts are regenerated from this
same source, retaining 991 events, 21 periods and 517 readable records. Jacob
and Joseph currently have geometry but no published readable article; this
change does not fabricate articles or change that API behavior.

The inherited wider calendar still requires review. In particular, Exodus
12:40–41 and Galatians 3:17's 430-year statements require an explicit sojourn/
covenant starting-point interpretation before using them as an absolute calendar
anchor. This bounded Genesis reconciliation does not choose one silently.
Other inherited estimated lifespans, historical dates and period subtitles are
outside this correction. Do not describe the whole timeline as historically
verified merely because these relative-age checks pass.

## Verification

`npm run verify:timeline` now passes all six tests with no TODOs or skips.
The original lifespan and birth-age assertions remain, with additional marriage,
twins, Laban-service, prison, plenty/famine, Egypt-arrival and death checks.
Rebuilding from the preserved upstream snapshot, applying twice and comparing
all repeated rows also pass. The deploy workflow and root deploy script still
require this command; the gate was not removed.

Local validation: server typecheck and production build passed; app tests
158/158, bot tests 545 passed / 6 emulator skips, API tests 107 passed / 1
integration skip. The API test also preserves the existing 404s for the
unpublished Jacob/Joseph articles. Three focused Chromium checks passed for
Abraham, Isaac and both deletion-contact links. The native app typecheck, four
timeline tests and complete offline archive/SQLite verification passed. All six
generated artifacts reproduce byte-for-byte and all ten unrelated native
catalog entries are unchanged. These checks are not deployed/device acceptance.

The earlier account-deletion verification work remains separately preserved at
`f64b34f527a47532ded7b1c7049ffdffd9001ace` on
`codex/release-verification-20261106`. Its full CI run exposed browser deletion
fixture failures and must not be described as green. No deployment, rule change,
store submission or merge is authorized by this chronology correction.
