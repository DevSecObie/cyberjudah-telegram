# Apocrypha People and Timeline: review sample

**Approved sample — 3 October 2026 (America/Los_Angeles).** The owner approved these ten
people and five events for expansion, with Bible Strong’s original Timeline layout and controls. Nothing here is imported by the app or published by
the content engine. No navigation, public data, teaching text, artwork or billing changes.

**Update (CYB-146):** the five sample events are now carried forward, in the app's real draft
format, at [`app/scripts/between-testaments/drafts.json`](../../../app/scripts/between-testaments/README.md) — still never shown in the app, still with no invented
position, pending the owner's citation of this period's BCE boundary years. The ten people are
the Timeline Researcher's to add under CYB-145, directly into `data/people/people.json` in the
content repository, following the owner's later correction there (full records, two-way
relationships, no separate proposal format) rather than this file's `people.json`, which stays
as the original review record.

The source is [DevSecObie/cyberjudah at ee09d540](https://github.com/DevSecObie/cyberjudah/tree/ee09d540382dfc8c64be363a95af1b5017fe2737).
`people.json` uses the app's existing `Person` contract. `timeline.json` is a proposed
editorial input, **not** the numeric-year `TimelineEvent` contract. `evidence.json` pins
the source, description references, name exclusions, 43 exact scripture quotations and
four verbatim caption excerpts with recording moments. Scripture spelling is preserved,
including apparent source typos. Caption spelling and repetitions are also preserved;
these excerpts are verified against the transcript, not independently against the audio.

## People

| Person | Action | Description evidence |
| --- | --- | --- |
| Mattathias | New, `mattathias-1ma-2-1` | 1 Maccabees 2:1–4 |
| Judas Maccabeus | New, `judas-maccabeus-1ma-2-4` | 1 Maccabees 2:1–4; 3:1 |
| Tobit | New, `tobit-tob-1-1` | Tobit 1:1, 9 |
| Tobias | New, `tobias-tob-1-9` | Tobit 1:9 |
| Raphael, also called Azarias | New, `raphael-tob-3-17` | Tobit 3:17; 5:12; 12:15 |
| Judith | New, `judith-jdt-8-1` | Judith 8:1–4 |
| Holofernes | New, `holofernes-jdt-2-4` | Judith 2:4 |
| Achior | New, `achior-jdt-5-5` | Judith 5:5 |
| Ezra / Esdras | Reuse `ezra-ezr-7-1` | Ezra 7:1, 6; 1 Esdras 8:1–3, 8; 2 Esdras 1:1 |
| Zerubbabel / Zorobabel | Reuse `zerubbabel-1ch-3-19` | Ezra 3:2; 1 Esdras 6:2, 27 |

This adds **eight identities**, not ten duplicates: the index would grow from 3,129 to
3,137 for this sample. Existing references and family links for Ezra and Zerubbabel are
preserved; aliases and Apocrypha references are added to the same IDs. Esther remains
`esther-est-2-7` in the next batch. The other existing men called Ezra remain separate.

For each selected identity, the sample lists exact named occurrences in the books named
in its evidence record. Pronoun-only narrative verses are not counted. This is not a claim
of complete coverage across all Apocrypha books. Omitted family relationships are not
claims that the person had no such relatives. New family links connect only the two
father/son pairs documented here; other relationships wait for their own identity review.

Do not attach every string match automatically. Judas son of Calphi and Judas son of Simon
are not Judas Maccabeus; Mattathias son of Absalom, son of Simon and Nicanor's envoy are
separate identities. The Judas of 2 Maccabees 1:10 remains unresolved in this sample.
Every excluded match and its reason is in `evidence.json`.

New records cite the KJV source, not STEPBible. Reused records retain STEPBible's attribution
and CC BY 4.0 licence alongside the added scripture provenance. No dictionary text is used.
Raphael's type is `Angel`, supported by Tobit 12:15; the existing string contract and
initial-letter fallback accept it, although the current generic heading still says Person.
No portraits or new images are proposed.

## Timeline

Approved period title: **Between the Testaments**, after **The Exile** and before
**Life of Christ**. The return under Zorobabel overlaps the preceding period and should
be cross-linked, not presented as a second return. Esdras's later return is a separate
event for the next batch.

| Sample event | Source | Date treatment |
| --- | --- | --- |
| The return with Zorobabel | 1 Esdras 5:8, 48, 56 | No absolute date; the building work has its own relative date |
| Alexander and the Greek kingdom | 1 Maccabees 1:1–9 | Reign length is not an absolute year |
| The desolation of the altar | 1 Maccabees 1:10, 54, 59 | 15 Casleu, year 145, in the source calendar |
| Mattathias at Modin | 1 Maccabees 2:1, 19–22, 27 | “In those days”; no inferred year |
| The cleansing and dedication of the sanctuary | 1 Maccabees 4:36, 52–54, 59 | 25 Casleu, year 148, in the source calendar |

`start` and `end` intentionally remain null. “Day” precision means a day in the stated
source calendar, not a Gregorian date. No BCE conversion or calendar equivalence is asserted.
The current Timeline requires integer BCE/CE years for placement, search and labels;
passing these objects to it would be invalid. **Keep Bible Strong’s original dated canvas,
period navigation, search and event controls, with CyberJudah styling.** The owner did not
approve a narrative-list replacement. Find and cite reliable absolute dates before plotting
events, retain the source-calendar labels and precision in their details, and keep unresolved
dates in research drafts. Never assign invented positions to undated events.

The four attached class excerpts belong under **From the classes**, labelled **Quotes and
sources**, with links to the recorded moments. Unknown teachers or upload dates stay blank.
“Bishop” is the exact available title for one source; no name is invented. The return event
has no selected, verified class excerpt yet and must remain a draft until that review finishes.
Nicanor, Jonathan, Simon, the league with Rome and the martyrs of 2 Maccabees 6–7 follow
in separate sourced batches.

## Before publishing

- People ingestion belongs in the **library repository**. Extend the engine to accept
  separately attributed Apocrypha records and alias additions; do not overwrite TIPNR or
  maintain a second production People index in the app.
- Regenerate the existing `taught` and case links for reused identities. Empty arrays in
  this review sample mean enrichment has not been collected, not that no classes exist.
  The two sample `taught` entries use verbatim excerpts and the existing API shape.
- Fix `Person.tsx`'s note-link assumption before exposing recording-only moments: it
  prepends `/note` even to external URLs. The Watch action already links to the recording.
  Do not invent a notes page or treat an unreviewed empty array as “No class has taught…”.
- Follow the approved original Bible Strong presentation. Keep the existing date geometry,
  navigation and controls, and the Final Captivity content and labels intact.
- Preserve all themes, 200% text, safe areas and accessibility preferences in the later UI
  PR; include phone/desktop light/dark before-and-after screenshots of that implementation.

## Validation

Run `python docs/proposals/apocrypha/check.py /path/to/cyberjudah`. It reads the pinned Git
objects without changing the library checkout, checks IDs, aliases, preserved references
and family links, named occurrences and exclusions, every scripture quote, and every class
excerpt inside its cited ten-minute window. It also checks the sample's source-calendar
limits. Human review still decides identity, description meaning and the period's title.

Screenshots are not applicable to this data proposal: the running UI is unchanged. A
preview with invented year positions would misrepresent the unresolved Timeline decision.

## Owner decision

The sample and **Between the Testaments** title are approved for implementation and
expansion in focused PRs. The owner requires the original layout and Bible Strong as the
reference. Source-backed dates remain necessary; a narrative list is not the implementation
plan. The subsequent historical-identity research request is a source review, not permission
to publish unsupported ancestry or complexion claims as person facts.
