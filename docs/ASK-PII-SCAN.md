# PII scan of transcripts before indexing (design)

MDLC work package 4, gap G4 in [ASK-THREAT-MODEL.md](ASK-THREAT-MODEL.md) (threat T9). Design only; nothing here is built yet. It changes no transcript and no teaching: by default it only reports.

## Problem

Class, captains and history recordings are transcribed from captions and become evidence for Ask in two places:

- **Vectorize** `cyberjudah-teachings`: `bot/scripts/embed.mjs` reads `blog/transcripts`, `captains/transcripts` and `history/transcripts` from `DevSecObie/cyberjudah`, cuts them into ~45-second chunks (`transcripts.mjs` `chunkSegments`) and stores each chunk's **text in the vector's metadata**.
- **D1** `teaching_passages`: built from the same files by the `DevSecObie/cyberjudah` corpus indexer and loaded with `bluegreen-load.mjs`.

Live classes sometimes contain personal data said out loud: a caller's phone number, an email address, a street address, a card or account number read for a donation. Once indexed, a matching question can retrieve the chunk and the model can quote it. Nothing checks for this today.

## What it detects

Patterns with a low false-positive rate on Bible text. Each detector has positive and negative fixtures (synthetic values only, never real ones).

| Kind | Rule | Must not match |
|---|---|---|
| `email` | RFC-ish `local@domain.tld`, also caption forms like "name at gmail dot com" | "at the Lord's house" without a mail domain |
| `phone` | 10+ digits in phone grouping: `(555) 555-0123`, `555-555-0123`, `555.555.0123`, `+1 555 555 0123`, international `+<cc>` with 8–15 digits | verse references ("John 3:16", "Revelation 7:4-8"), years ("1611", "1619"), counts ("144,000"), times ("7:30") |
| `card` | 13–19 digits (spaces/dashes allowed) passing the Luhn check | long numbers that fail Luhn |
| `ssn` | `ddd-dd-dddd` with the invalid ranges excluded (000, 666, 9xx area; 00 group; 0000 serial) | phone numbers, dates |
| `street` | house number + name + street suffix ("1234 Elm Street", "55 Main Ave") | "12 tribes", "40 years", "7 churches" (no suffix) |

Not detected, on purpose: **names**. Teachers, members, historical and biblical people are named constantly and the detector cannot tell a caller from a prophet. Name removal stays a manual request (below). Spoken digits ("five five five...") are not detected in the first version; the report says so.

## Where it runs

One pure module, `shared/pii-scan.mjs` (no I/O, no network), so both repositories can use the same rules:

1. **At the source (preferred):** a check in `DevSecObie/cyberjudah` on pull requests and pushes that add or change transcript JSON. It scans only changed files. This catches data before either index sees it. (That repo is outside this one; its owner agrees the step.)
2. **At indexing (last gate):** in `embed.mjs`, on each chunk after `chunkRecord` and before embedding. Same rules for the corpus indexer that fills `teaching_passages`.

## Modes (a switch, default report)

`PII_SCAN_MODE`:

| Mode | Effect |
|---|---|
| `off` | No scan. |
| `report` (**default**) | Scan and report; index everything unchanged. Readers see no change. |
| `mask` | Replace each match with a fixed label (`[phone number removed]`, `[email removed]`, ...) in the indexed copy only; the transcript file is not changed. |
| `skip` | Leave the matching chunk out of the index. |

`mask` and `skip` change what Ask can cite, so only the owner turns them on, after reading a report run. Masking replaces only the matched characters; no other word in the chunk changes.

## What the report holds

The report must not become a second copy of the personal data.

- Per finding: video id, segment start second, kind, detector version. **Never the matched text** and never surrounding words. A reviewer opens the recording at that second to check.
- Totals per kind and per feed.
- Output: the GitHub Actions step summary and a JSON artifact kept 7 days. No Telegram message, no D1 table, no log line with content.

## Removing data that was found

A confirmed finding is fixed in the transcript itself through the content owner's correction workflow (the class corrections feed), then the nightly embed re-embeds that chunk (its content hash changes) and the next corpus load replaces the passage. Until then, `skip` for that video can be used. A reader's request to remove their own words goes to privacy@cyberjudah.io and follows the same path.

## Tests (when built)

- Each detector: synthetic positives (`555-0100` range phone numbers, `example.com` emails, Luhn-valid test card numbers) and the scripture/number negatives above.
- The report never contains the matched string: a test scans a fixture and asserts the serialised report does not include it.
- `mask` changes only the matched span; the rest of the chunk is byte-identical.
- `report` leaves embed input byte-identical to today.

## Rollout

1. Module + tests + `report` in `embed.mjs --dry` (no Cloudflare writes): one run over the whole corpus, report shared with the owner (counts only).
2. The source check in `DevSecObie/cyberjudah`, report mode.
3. Owner decides `mask`/`skip`, per kind if wanted (for example `card` and `ssn` masked, `street` report-only).

No model call, no new service and no new secret is needed.
