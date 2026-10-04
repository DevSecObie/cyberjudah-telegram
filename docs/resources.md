# Study resource evidence and approval register

Owner decisions adopted 2026-10-04 (America/Los_Angeles). Phase 2 approves only
Strong's as a separate share-alike lexicon, Josephus/Whiston in the Scranton 1905
printing, all twelve volumes of the Jewish Encyclopedia (1901–1906), and Smith's
1889 Houghton Mifflin printing. Approval is the owner's decision; it does not
turn class captions or catalog metadata into a rightsholder's licence statement.
KJV with the Apocrypha remains the only Bible text. Easton's stays unchanged;
Brenton is on hold, reference-only if ever added. Webster 1828 and Britannica
1911 are dropped; their modern websites remain link-only. Interlinear work stays
paused. No remote R2 upload, merge or deployment is authorized for this work.

Sources, commit IDs and SHA-256 hashes are in
[`resources/sources.lock.json`](../resources/sources.lock.json). The converter
preserves existing source text and records prior import normalization explicitly.
See [OCR samples and limitations](BIBLE_RESOURCES_OCR.md) before using quotations.

## How evidence was checked

The scan covered 8,282 JSON files in `DevSecObie/cyberjudah/blog/transcripts/` at
source commit `694a7694`. Adjacent caption segments were joined before matching,
then matches were mapped back to the original segment's start time. Timestamps
below are `m:ss`, including minutes above 59. Auto-captions can mishear titles,
dates and names. A recording link supports a class-use claim; it does not establish
a license, the accuracy of a historical claim, or endorsement of a work.

The first broad scan found 125 Josephus, 111 Jewish Encyclopedia, 13 Strong's,
34 Britannica, 139 Webster, 32 Septuagint, 23 Easton, 15 Smith, 56 Zondervan,
15 Blue Letter Bible and 57 Bible Hub matching files. These are **raw search hits,
not verified class-use counts**. Most Easton hits were unrelated words/names.
A refined contextual search found Nelson's despite the initial exact-name pattern
missing it. These methods do not substantiate the approximate counts in the brief.

## Approved bundles and retained evidence

### Josephus — Whiston translation

Proposed edition: *The Complete Works of Flavius-Josephus*, William Whiston,
S. S. Scranton, Hartford, **1905** (translation first published 1737). Text source:
[Internet Archive scan/OCR](https://archive.org/details/completeworksoff05jose).
[Item metadata](https://archive.org/metadata/completeworksoff05jose), retrieved in
this review, confirms 1905, Whiston and the publisher; it contains no `licenseurl`
or `rights` grant. The historical edition is public domain in the US by publication
age. That conclusion is about this edition, not any modern publisher's added notes.
Pin the scan/OCR filenames and hashes, retain source attribution, and proofread
OCR against the scan before bundling. Existing library metadata names this scan.

Class evidence:

- [`0DwfIBNGOP0` 23:46](https://www.youtube.com/watch?v=0DwfIBNGOP0&t=1426s): the complete works/Antiquities are identified and read.
- [`0N1tUWScwMU` 151:48](https://www.youtube.com/watch?v=0N1tUWScwMU&t=9108s): Josephus, page 30, is called for and read.

Status: work use supported; the captions alone do not prove both physical copies
are the proposed 1905 printing. Confirm edition against recording frames before
claiming an exact class-edition match. The owner approved this specific 1905
printing for Phase 2; the caption limitation remains recorded.

### The Jewish Encyclopedia — 1901–1906 first edition

Proposed edition: Isidore Singer et al., Funk & Wagnalls, **12 volumes, 1901–1906**.
Use the original scans/OCR, starting with
[volume 1](https://archive.org/details/cu31924091768188); the existing library's
`data/library/jewish-encyclopedia/book.json` lists all 12 scan IDs. Retrieved
[metadata](https://archive.org/metadata/cu31924091768188) confirms 1901 and Funk &
Wagnalls; there is no explicit license URL. Original published text is US public
domain by age. This does not license a modern website's added material or layout.
Verify each volume's title page, source file and checksum individually.

Class evidence:

- [`1OFE8p0VnoQ` 27:57](https://www.youtube.com/watch?v=1OFE8p0VnoQ&t=1677s): page 20 is read concerning censorship.
- [`0GhFdpcxERw` 110:46](https://www.youtube.com/watch?v=0GhFdpcxERw&t=6646s): the diaspora entry, page 449, is used.

Status: all twelve 1901–1906 volumes approved for Phase 2. Individual volume
source files are pinned; approval does not certify the OCR as error-free.

### Strong's — separate share-alike lexicon

Historical work: James Strong, *Exhaustive Concordance*, **1890**, with Hebrew and
Greek dictionaries. Current text source is
[Open Scriptures](https://github.com/openscriptures/strongs); the existing
[conversion](https://github.com/DevSecObie/cyberjudah/blob/main/scripts/strongs/build.py)
identifies **CC BY-SA** for the digital transcription. The owner's follow-up decision
explicitly permits `CC-BY-SA-unversioned` for this lexicon only. Register status:
**version unstated by the rightsholder; recorded verbatim; to be updated if Open
Scriptures states one**. Do not infer 3.0 or 4.0. The JSON headers at upstream
commit `0acd2f251c2d35ff8db2dece4e0593979d3ac223` are quoted word for word in the
manifest, including David Instone-Brewer and David Troidl's Hebrew credits and
Ulrik Petersen's Greek credits. Each manifest licence URL points to its pinned
upstream file; `source` records the commit and file SHA-256. The converted lexicon
carries the same unversioned share-alike notice, remains separate from the other
bundles, and describes the conversion in `modifications`. The reader-visible
attribution line is unchanged. The XHTML file's GPL notice is not substituted
for the JSON headers. [Upstream discussion](https://github.com/openscriptures/strongs/issues/11).

Class evidence:

- [`fkw8ImUjZ8c` 32:41](https://www.youtube.com/watch?v=fkw8ImUjZ8c&t=1961s): Strong's H1408 is looked up and its definition read.
- [`oq0l6dUtMCA` 18:08](https://www.youtube.com/watch?v=oq0l6dUtMCA&t=1088s): the Strong's *ethnos* entry is read.

Other classes criticize Strong's; those criticisms were not counted as approval.
Phase 1 preserves existing attribution and fixes selection/pagination, without
adding definitions or inventing word alignments. Phase 2 repackages the existing
data without changing the text, alignments, first page or continuation results.

### Britannica — 1911 bundle dropped; modern website link-only

Proposed edition: *Encyclopaedia Britannica*, **11th edition, 1910–1911**. Candidate
[volume 2 scan](https://archive.org/details/Encyclopaediabri02chisrich_201303), found
through Archive's title/year index. Original edition is US public domain by age;
the complete scan set, title pages, OCR and per-item rights metadata still need
verification. No modern Britannica article may be substituted.

Evidence inspected:

- [`0h8U1T4Vc64` 91:06](https://www.youtube.com/watch?v=0h8U1T4Vc64&t=5466s): Britannica material concerning Columbus.
- [`LCl0ehoaInc` 69:02](https://www.youtube.com/watch?v=LCl0ehoaInc&t=4142s): a Britannica dictionary definition of “eye.”

**Dropped by owner:** neither establishes use of the 1911 edition. These two links
are evidence of the mismatch, not two verified uses of the proposed edition.

### Webster — 1828 bundle dropped; modern website link-only

Proposed edition: Noah Webster, *An American Dictionary of the English Language*,
**1828**, two volumes. Candidate scans:
[volume 1](https://archive.org/details/americandictiona01websrich),
[volume 2](https://archive.org/details/americandictiona02websrich), found through
Archive's title/year index. Original edition is US public domain by age; digital
artifact verification and an exact class-edition match remain pending.

Evidence inspected:

- [`NcQpeYx1KZM` 18:50](https://www.youtube.com/watch?v=NcQpeYx1KZM&t=1130s): captions say “Merriam Webster” and “1828” while defining “ghetto.” A site's “since 1828” branding is not proof that an entry is from the 1828 dictionary.
- [`UJS8-8gATkE` 108:25](https://www.youtube.com/watch?v=UJS8-8gATkE&t=6505s): an online definition is called “1828,” but the speaker alternates between Oxford and Webster; edition identity is unresolved.

**Dropped by owner:** do not present these ambiguous mentions as two confirmed
uses of Webster's 1828 text or copy modern Merriam-Webster entries.

### Brenton's Septuagint — reference only, never replacement Bible text

Proposed edition: Lancelot C. L. Brenton, Greek Septuagint with English translation
and Apocrypha, **1851**. Candidate
[scan record](https://archive.org/details/septuagint-with-apocrypha-the), found via
Archive title/author/year search. Original translation is US public domain by age;
verify the scan's actual title page and digital transcription rights before import.

Evidence inspected:

- [`N8ApGt1a0ts` 113:54](https://www.youtube.com/watch?v=N8ApGt1a0ts&t=6834s): “Brenton Septuagint translation” is named while comparing Numbers 15:38.
- [`bkW1A5IL0sQ` 6:39](https://www.youtube.com/watch?v=bkW1A5IL0sQ&t=399s): Septuagint Job 42:17 is read, but Brenton is not identified in the inspected passage.

**On hold by owner:** one explicit Brenton use, not two confirmed edition uses.
General discussion of the Septuagint's history is not use of Brenton's English
translation. It would be an approved reference resource only.

### Easton's — existing resource; a second class-use citation is missing

Proposed historical edition: M. G. Easton, *Illustrated Bible Dictionary*,
**third edition, 1897**. Current app provenance is recorded in
[`bot/data/provenance.json`](../bot/data/provenance.json): the dataset card does
not specify a license. The historic edition is public domain by age, but this
specific digital copy is not cleared for a new bundle. A
[CrossWire module](https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton)
is a candidate source whose metadata/terms could not be fetched in this environment.

- [`fRmaWUNOw6c` 66:24](https://www.youtube.com/watch?v=fRmaWUNOw6c&t=3984s): “Easton Bible Dictionary” is named and the Abib entry read.
- **Second verified class: not found.** The other broad matches were mostly
  unrelated names, Easter, or caption errors. No substitute citation is invented.

Status: current app behavior retained; new bundle blocked on digital license,
second class-use evidence and owner approval.

### Smith's Dictionary of the Bible

Approved edition: William Smith, Hackett/Abbot American edition, **1889**,
four volumes, Houghton Mifflin, using the existing library's
[volume 1 scan](https://archive.org/details/1889dictionaryofb01smituoft) and its
three companion volumes. Label this bundle **1889**. The owner explicitly chose
this printing; no alternative printing is being sought. Retrieved
[metadata](https://archive.org/metadata/1889dictionaryofb01smituoft) states
“no visible notice of copyright; stated date is 1889.” The class dates below
remain historical evidence, not the name or year of the approved bundle.

- [`Dt0hL9vHpZ8` 132:47](https://www.youtube.com/watch?v=Dt0hL9vHpZ8&t=7967s): full title and publication year 1890 are read before the Obadiah entry.
- [`ND_RbWngH9I` 83:08](https://www.youtube.com/watch?v=ND_RbWngH9I&t=4988s): full title and 1890 are again identified before reading.

Status: the owner has resolved the edition choice in favor of 1889. All four
source transcriptions are pinned; sampled OCR problems remain documented.

## Link-only resources

These entries never authorize offline copying, OCR import or redistribution.
Exact modern editions were not established from these excerpts; retain links to
the recording and authorized publisher/website, not unauthorized copies.

| Work | Class evidence | Disposition |
| --- | --- | --- |
| Zondervan's Compact Bible Dictionary | [`-2NEChSWFds` 38:40](https://www.youtube.com/watch?v=-2NEChSWFds&t=2320s), “ruddy,” p. 510; [`7x23t5fyanU` 20:10](https://www.youtube.com/watch?v=7x23t5fyanU&t=1210s), “Israel” | Copyrighted modern reference; link only; no redistribution grant established |
| Nelson's Complete Book of Bible Maps and Charts | [`4omT-pzRYQE` 117:26](https://www.youtube.com/watch?v=4omT-pzRYQE&t=7046s), title named and Joel section read; [`X4Hm0O-_2go` 10:01](https://www.youtube.com/watch?v=X4Hm0O-_2go&t=601s), title named for historical study | Copyrighted modern reference; link only; this is the named title, not an inferred Nelson dictionary |
| Blue Letter Bible | [`119XxnwI6so` 29:06](https://www.youtube.com/watch?v=119XxnwI6so&t=1746s), translation statement read critically; [`FSymeiJmmB0` 49:23](https://www.youtube.com/watch?v=FSymeiJmmB0&t=2963s), website opened | Website use/criticism is not endorsement or a dataset license; link only |
| Bible Hub | [`5FhMWXGhp-0` 73:52](https://www.youtube.com/watch?v=5FhMWXGhp-0&t=4432s), 1 Samuel 16:12 comparison; [`6C495CkHZIo` 107:37](https://www.youtube.com/watch?v=6C495CkHZIo&t=6457s), Acts 24:14 | Website with mixed-source rights; link only |

## Publication

CI builds the four separate bundles and attaches them as artifacts. The admin-run
script verifies all hashes and indexes, uploads immutable release objects with
the admin's credentials, then uses authenticated `PUT /api/resources/catalog`
with the current ETag. It never directly writes the catalog pointer or approval
markers. See [`resources/README.md`](../resources/README.md). R2 remains the sole
resource CDN; the app does not fetch Bible text from third parties.
