# OCR inspection — approved Phase 2 resources

Assessed 2026-10-04. The converter preserves the pinned library transcription
exactly. No observed error was silently corrected. The earlier library importer
joined wrapped words/lines and removed running heads/chapter headings; those
existing changes are disclosed in every book manifest.

One median dense-text page (at least 1,500 characters, printed page > 1) was
selected from each of the 17 volumes. A legible prose excerpt on each page was
transcribed from its scan and compared with the existing OCR. This is a small,
nonrandom excerpt sample, **not a whole-page or whole-book accuracy estimate**.
Foreign scripts, tables and marginal layouts were not systematically measured.
The scan URLs/hashes, source pins, exact excerpt offsets and manual transcriptions
are in [ocr-samples.json](../resources/ocr-samples.json).

Character error rate (CER) is character-level Levenshtein edits / reference
characters; word error rate (WER) uses word tokens. Both normalize Unicode NFC,
case, curly quotes and whitespace. CER retains punctuation and word-joining
spacing; WER uses Unicode letters/numbers with internal apostrophes and hyphens.
Errors include insertions and deletions, so rates are not percentages of pages.
The reproducible [measurement script](../resources/ocr-report.mjs) emits counts;
the percentages below are rounded, weighted by the reference length.

## Measured excerpts

| Resource | Volumes sampled | Reference words | WER | Reference characters | CER |
| --- | ---: | ---: | ---: | ---: | ---: |
| Josephus (1905) | 1 | 68 | 2.94% | 360 | 0.56% |
| Jewish Encyclopedia (1901–1906) | 12 | 560 | 4.82% | 3260 | 1.47% |
| Smith’s (1889) | 4 | 280 | 6.79% | 1555 | 2.96% |

Strong’s uses the existing digital JSON, so no OCR accuracy claim is made. Its
fields are verified against the pinned upstream conversion. Its concordance
entries and continuation pages are checked against the existing engine output.

## Pages needing a human proofreader

Every sampled page has a character discrepancy. Zero WER can still mean punctuation
or spacing errors. These pages need full-page review; they are not the only pages
with errors. Examples include JE volume 11’s 1630 read as 1680, volume 9’s 1892 as
1893, and Smith’s “Noachian” misread as “Moachiaii.” Dates and scripture-reference
digits require special care.

| Resource | Volume | Printed page / scan | Word errors / words | Character errors / characters |
| --- | ---: | --- | ---: | ---: |
| Jewish Encyclopedia (1901–1906) | 1 | [359](https://archive.org/download/cu31924091768188/page/n408_w1200.jpg) | 3 / 51 | 5 / 304 |
| Jewish Encyclopedia (1901–1906) | 2 | [345](https://archive.org/download/cu31924091768196/page/n386_w1200.jpg) | 2 / 39 | 2 / 220 |
| Jewish Encyclopedia (1901–1906) | 3 | [339](https://archive.org/download/jewishencycloped0003isid/page/n372_w1200.jpg) | 1 / 21 | 1 / 126 |
| Jewish Encyclopedia (1901–1906) | 4 | [345](https://archive.org/download/cu31924091768212/page/n380_w1200.jpg) | 1 / 43 | 1 / 261 |
| Jewish Encyclopedia (1901–1906) | 5 | [346](https://archive.org/download/cu31924091768220/page/n377_w1200.jpg) | 6 / 70 | 13 / 406 |
| Jewish Encyclopedia (1901–1906) | 6 | [342](https://archive.org/download/cu31924091768238/page/n375_w1200.jpg) | 4 / 59 | 3 / 368 |
| Jewish Encyclopedia (1901–1906) | 7 | [342](https://archive.org/download/cu31924091768246/page/n365_w1200.jpg) | 0 / 32 | 2 / 196 |
| Jewish Encyclopedia (1901–1906) | 8 | [347](https://archive.org/download/cu31924091768253/page/n376_w1200.jpg) | 4 / 76 | 8 / 409 |
| Jewish Encyclopedia (1901–1906) | 9 | [332](https://archive.org/download/cu31924091768261/page/n361_w1200.jpg) | 4 / 29 | 7 / 197 |
| Jewish Encyclopedia (1901–1906) | 10 | [345](https://archive.org/download/cu31924091768279/page/n376_w1200.jpg) | 0 / 50 | 3 / 263 |
| Jewish Encyclopedia (1901–1906) | 11 | [339](https://archive.org/download/jewishencycloped0011isid/page/n372_w1200.jpg) | 1 / 44 | 1 / 255 |
| Jewish Encyclopedia (1901–1906) | 12 | [378](https://archive.org/download/cu31924091768295/page/n421_w1200.jpg) | 1 / 46 | 2 / 255 |
| Josephus (1905) | 1 | [491](https://archive.org/download/completeworksoff05jose/page/n498_w1200.jpg) | 2 / 68 | 2 / 360 |
| Smith’s (1889) | 1 | [450](https://archive.org/download/1889dictionaryofb01smituoft/page/n467_w1200.jpg) | 4 / 86 | 8 / 511 |
| Smith’s (1889) | 2 | [1346](https://archive.org/download/1889dictionaryofb02smituoft/page/n467_w1200.jpg) | 4 / 63 | 8 / 334 |
| Smith’s (1889) | 3 | [2242](https://archive.org/download/1889dictionaryofb03smituoft/page/n465_w1200.jpg) | 3 / 76 | 16 / 399 |
| Smith’s (1889) | 4 | [3179](https://archive.org/download/1889dictionaryofb04smituoft/page/n494_w1200.jpg) | 8 / 55 | 14 / 311 |

The bundle’s `conversion-report.json` additionally lists every empty-text page
and every page with unclear reference candidates. These require triage against
the scans: an empty page can be a plate or blank leaf, and a reference-like string
can be a non-Bible citation. No absence of detected candidates proves correctness.
Scripture annotations use the existing parser plus exact KJV chapter/verse bounds;
ambiguous, reversed, cross-chapter and nonexistent ranges remain plain text and
are counted. A valid but incorrectly OCR’d verse number cannot be detected by
bounds alone. The annotations are navigation aids, not proofreading certification.
