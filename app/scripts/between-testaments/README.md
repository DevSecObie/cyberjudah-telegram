# Between the Testaments

The owner-approved period for the Apocrypha's history (CYB-145, CYB-146): the return under
Zorobabel, Alexander and the Greek kingdom, the desolation of the altar, Mattathias at Modin,
and the cleansing and dedication of the sanctuary. It follows **The Exile** and comes before
**Life of Christ** on the Timeline's dated canvas — the same canvas, the same controls, the
same Bible Strong layout, with CyberJudah styling. No narrative-list replacement.

Built the same way as [`app/scripts/final-captivity`](../final-captivity/README.md): these
files are the source of truth, `app/scripts/timeline-data.mjs` calls this directory's
`build.mjs` after its own build, and `check.mjs` must pass before anything here is published.
Unlike Final Captivity, this age names no IUIC leader, so there is no `leaders.json`, and (so
far) there is only one period, so there is no subperiod split to track in a ledger.

| File | What it holds |
| --- | --- |
| `periods.json` | The one period: id, title, years, interval, colour. `startYear`/`endYear`/`interval` are `null` until the owner approves real BCE boundary years for this age — see "Why this starts empty" below. |
| `events.json` | Published events. Empty today: nothing here has an owner-approved absolute year yet. Every one passes `check.mjs`. |
| `drafts.json` | The five approved-sample events, preserved from `docs/proposals/apocrypha/`: title, summary, scripture references and class citations, each with its source-calendar date (`date.calendar`, `date.sourceRef`) or `date.precision: "unknown"` where the text gives no date at all. Never shown in the app. |

## Why this starts empty

The approved sample's own review ([`docs/proposals/apocrypha/README.md`](../../../docs/proposals/apocrypha/README.md)) is explicit: "Find and cite reliable absolute dates before plotting events... Never assign invented positions to undated events." None of the five sample events has an owner-approved BCE/CE year yet (two give a day in 1 Maccabees' own Seleucid-era calendar, which this file keeps as `date.calendar`/`date.sourceRef` rather than converting on its own authority).

`build.mjs` mirrors Final Captivity's own rule ("a period shows once it has a published event; an empty canvas is left out") one step further: a period with no boundary years is left out of `app/src/data/timeline.json` even if `events.json` is not empty, and `check.mjs` treats a published event under a boundary-less period as a problem, not something to guess a position for.

**So a future batch is data only:** once the owner approves this period's boundary years (filling in `periods.json`'s three `null` fields) and a dated event is sourced, moving that event from `drafts.json` to `events.json` is the entire change — `timeline-data.mjs` (which calls this directory's `build.mjs`) inserts the period between The Exile and Life of Christ, places its bars, and writes the detail file automatically. No code here needs to change for that.

## An event

Same shape as [Final Captivity's](../final-captivity/README.md#an-event) (`shared/cms.ts`'s `TimelineShape`), with two additions this age needed and Final Captivity did not:

- `date.precision` accepts `"unknown"`: the text gives no absolute date at all (Mattathias at Modin's "in those days"). An `"unknown"`-precision event can never carry `start`/`end`; it stays a draft.
- `date.calendar` and `date.sourceRef` (both optional text): a source-calendar date stated in the text (`"15 Casleu, year 145"`, `1 Maccabees 1:54`) without asserting a BCE/CE conversion.

`group` additionally accepts `"Return from exile"` and `"Maccabean revolt"` (`GROUPS` in `shared/cms-timeline-rules.mjs`). `BOOKS` there already lists all fifteen Apocrypha books, so `scriptures`/`answer` refs into any of them (`"1 Maccabees 2:1"`, `"Tobit 3:17"`, …) validate the same way a canonical reference does.

## Validation

```sh
node app/scripts/between-testaments/check.mjs                 # shape, dates, rules
CJ_ROOT=../cyberjudah node app/scripts/between-testaments/check.mjs  # also against the corpus
```

Wired into CI the same way Final Captivity is: `scripts/check-cms.mjs` runs this directory's `checkAll()` on every PR and re-checks only changed published events against the transcript corpus; `.github/workflows/cms.yml` rebuilds `app/src/data/timeline.json` and `app/src/data/between-testaments.json` from reviewed source after.
