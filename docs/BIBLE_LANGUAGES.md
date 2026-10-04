# Language catalog research — Phase 2 scope

2026-10-04 UTC. **Research report only. No translation was selected, imported or
implemented.** American English is covered by the existing KJV, as the owner
confirmed. The requested Spanish, Haitian Creole, French, optional Portuguese
and North American Indigenous language investigation remains open.

## Verified baseline and unresolved access

The app's 81-book catalog preserves the KJV in the requested 1611 order. Its
Apocrypha books are: **1 Esdras, 2 Esdras, Tobit, Judith, Rest of Esther, Wisdom of
Solomon, Ecclesiasticus, Baruch, Epistle of Jeremiah, Song of the Three Holy
Children, History of Susanna, Bel and the Dragon, Prayer of Manasses, 1 Maccabees,
2 Maccabees.** This is the app's split-book representation, not a claim that every
provider uses the same book IDs or divisions. There is no second English text.

The owner excluded API.Bible entirely on 2026-10-04: no key, account integration,
or third-party Bible-text fetching. The environment draft removes its three
hosts and retains eBible/CrossWire for **catalog research only**. Those two
catalogs remain inaccessible under the current runtime policy; the saved draft
has not been applied. Their current edition inventories, book lists and licence
statements have not been verified in this review. Required catalog destinations:
[ebible.org](https://ebible.org/) and [CrossWire](https://www.crosswire.org/sword/modules/).
R2 remains the app’s only resource CDN. No translation import is authorized.

A translation in another language is not automatically a translation *of the
KJV*. Shared textual tradition, a KJV-based revision and a direct translation of
the KJV are separate claims. “Closest” needs the owner's criteria and sample
comparison; the candidates below do not establish an objective ranking.

## Candidate matrix

The public metadata links below were retrieved from scrollmapper's repository at
immutable revision `e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c`. They are independent
leads for identifying works and checking rights, **source assertions, not confirmed rights or import approval**.

| Language | Candidate to investigate | Verified metadata / comparison limit | Apocrypha / coverage evidence |
| --- | --- | --- | --- |
| English / American English | Existing KJV with Apocrypha | Preserve existing text and numbering; do not substitute a modern English version | Existing app’s 15 listed above; catalog coverage unverified |
| Spanish | Reina-Valera 1909; compare 1865 and Reina Valera Gómez if the owner wants KJV-oriented revision candidates | Retrieved metadata identifies [1909](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRV/README.md), [1865 with spelling changes](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRV1865/README.md), and [Gómez](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRVG/README.md). Metadata alone does not verify the extent of KJV dependence | Unverified; do not equate a Reina-Valera title with inclusion of Apocrypha |
| Haitian Creole | Haitian Creole Bible — exact publisher/edition unresolved | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/ht/Haitian/README.md) gives a generic title only. It does not justify identifying this as a particular Bible Society edition or a KJV translation | Unverified; no book inventory established |
| French | David Martin 1744; compare available Segond editions only after identifying the exact catalog editions | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/fr/FreBDM1744/README.md) identifies Martin 1744. Reformation-era textual affinity is a comparison lead, not proof it translates the KJV | Unverified; exact edition book list required |
| Portuguese, if requested | Bíblia Livre — Textus Receptus; compare Almeida editions after catalog access | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/pt/PorBLivreTR/README.md) identifies this work. Textus Receptus in the title does not make it a KJV translation | Unverified; exact edition book list required |
| Cherokee (additional Indigenous-language lead) | Cherokee New Testament, 1860, with Sequoyah transliterated forms | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/chr/Che1860/README.md) confirms this title. New Testament scope means this candidate cannot provide Old Testament/Apocrypha coverage; KJV dependence and added transliteration provenance need verification | None in the named NT-only work; other catalog editions unverified |

Cree, Ojibwe, Inuktitut, Mohawk, Dakota and Navajo are separate possible searches,
not interchangeable language variants. No edition inventories or licence statements were obtained for them. The owner allowed American English; no Indigenous
translation is needed merely to fill that heading. Language labels here follow
the requested research categories and make no historical ancestry determination.

## License, attribution and offline status

| Candidate | Evidence retrieved | What remains before live/offline use |
| --- | --- | --- |
| Existing KJV | Existing repository corpus/provenance; historical public-domain text in the US | Preserve current attribution; the KJV has jurisdiction-specific printing rights, so US public-domain status is not a blanket worldwide licence |
| Reina-Valera 1909 / 1865 | The linked module READMEs state “Public Domain” | Verify exact publisher/source files, spelling revisions, attribution and edition-specific terms; no digital redistribution permission established |
| Reina Valera Gómez | Linked README states “Creative Commons: BY-NC-ND 4.0” | Noncommercial/no-derivatives restrictions require checking the intended app use and versification mapping. It is outside the new PD/CC-BY bundle allowlist; not approved |
| Haitian Creole module | Linked README states “Public Domain,” but gives no exact edition/publisher | Treat as an unresolved metadata assertion; obtain the actual copyright page/rightsholder statement and original copyright statement. Do not infer that another Creole edition has the same rights |
| David Martin 1744 | Linked README states “Public Domain” | Verify digital transcription/additions and provider attribution/terms |
| Bíblia Livre — Textus Receptus | Linked README states “Creative Commons Attribution 3.0 Brazil” | Obtain full attribution and modification requirements from the original rightsholder; this differs from the phase-one manifest's CC-BY-4.0 identifier and needs explicit review, not relabelling |
| Cherokee 1860 module | Linked README states “Public Domain” | Verify the historic printing and rights/provenance of the added transliteration; provider terms and availability remain unknown |

## Remaining catalog research

Once the saved eBible/CrossWire network settings are applied, record each relevant
catalog assertion with its URL and retrieval date: exact edition/publisher,
language/dialect, actual books (including each Apocrypha book), licence wording,
and required attribution. Distinguish a catalog’s assertion from a rightsholder’s
statement; do not label rights “confirmed.” No remembered service rule or title
match establishes offline redistribution rights.

Compare publisher statements before describing a work as a KJV translation.
Present candidates without selecting one. The owner allowed American English;
Indigenous-language findings are optional leads, not a requirement to substitute
an unrelated language or establish ancestry. Any future import requires a separate
edition decision and licence review. The app must continue using its own R2 for
approved text, preserving KJV numbering and labelling any future coverage gaps.
