# Language investigation — owner decision pending

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

A current, account-specific API.Bible catalog could not be checked: `api.bible`,
`docs.api.bible` and `rest.api.bible` were rejected by the environment's network
proxy, and neither `API_BIBLE_KEY` nor `BIBLE_API_KEY` was configured. A saved
network draft adds these hosts plus `ebible.org` and CrossWire. The draft still
requires publishing in environment settings. No key was requested in chat or
put in application code. API.Bible identifiers, coverage and contractual terms
below are therefore **unverified**, not guessed from another app's stale catalog.

A translation in another language is not automatically a translation *of the
KJV*. Shared textual tradition, a KJV-based revision and a direct translation of
the KJV are separate claims. “Closest” needs the owner's criteria and sample
comparison; the candidates below do not establish an objective ranking.

## Candidate matrix

The public metadata links below were retrieved from scrollmapper's repository at
immutable revision `e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c`. They are independent
leads for identifying works and checking rights, **not API.Bible permissions**.

| Language | Candidate to investigate | Verified metadata / comparison limit | API.Bible ID | API.Bible Apocrypha books |
| --- | --- | --- | --- | --- |
| English / American English | Existing KJV with Apocrypha | Preserve existing text and numbering; do not substitute a modern English version | Not needed for current corpus; provider ID unverified | Existing app's 15 listed above; provider coverage unverified |
| Spanish | Reina-Valera 1909; compare 1865 and Reina Valera Gómez if the owner wants KJV-oriented revision candidates | Retrieved metadata identifies [1909](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRV/README.md), [1865 with spelling changes](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRV1865/README.md), and [Gómez](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/es/SpaRVG/README.md). Metadata alone does not verify the extent of KJV dependence | Unverified for each edition | Unverified; do not equate a Reina-Valera title with inclusion of Apocrypha |
| Haitian Creole | Haitian Creole Bible — exact publisher/edition unresolved | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/ht/Haitian/README.md) gives a generic title only. It does not justify identifying this as a particular Bible Society edition or a KJV translation | Unverified | Unverified; no book inventory established |
| French | David Martin 1744; compare available Segond editions only after identifying the actual API catalog entries | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/fr/FreBDM1744/README.md) identifies Martin 1744. Reformation-era textual affinity is a comparison lead, not proof it translates the KJV | Unverified | Unverified; exact provider book list required |
| Portuguese, if requested | Bíblia Livre — Textus Receptus; compare Almeida editions after catalog access | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/pt/PorBLivreTR/README.md) identifies this work. Textus Receptus in the title does not make it a KJV translation | Unverified | Unverified; exact provider book list required |
| Cherokee (additional Indigenous-language lead) | Cherokee New Testament, 1860, with Sequoyah transliterated forms | [Module metadata](https://github.com/scrollmapper/bible_databases/blob/e1b254cef86d0e65b1a5d1a94b8b112d0f296a2c/sources/chr/Che1860/README.md) confirms this title. New Testament scope means this candidate cannot provide Old Testament/Apocrypha coverage; KJV dependence and added transliteration provenance need verification | Unverified; presence in another catalog does not show API.Bible availability | None in the named NT-only work; API.Bible edition unverified |

Cree, Ojibwe, Inuktitut, Mohawk, Dakota and Navajo are separate possible searches,
not interchangeable language variants. No verified API.Bible ID or permissions
were obtained for them. The owner allowed American English; no Indigenous
translation is needed merely to fill that heading. Language labels here follow
the requested research categories and make no historical ancestry determination.

## License, attribution and offline status

| Candidate | Evidence retrieved | What remains before live/offline use |
| --- | --- | --- |
| Existing KJV | Existing repository corpus/provenance; historical public-domain text in the US | Preserve current attribution; the KJV has jurisdiction-specific printing rights, so US public-domain status is not a blanket worldwide API license |
| Reina-Valera 1909 / 1865 | The linked module READMEs state “Public Domain” | Verify exact publisher/source files, spelling revisions, attribution and API.Bible-specific terms; no provider offline permission established |
| Reina Valera Gómez | Linked README states “Creative Commons: BY-NC-ND 4.0” | Noncommercial/no-derivatives restrictions require checking the intended app use and versification mapping. It is outside the new PD/CC-BY bundle allowlist; not approved |
| Haitian Creole module | Linked README states “Public Domain,” but gives no exact edition/publisher | Treat as an unresolved metadata assertion; obtain the actual copyright page/rightsholder statement and API catalog copyright. Do not infer that another Creole edition has the same rights |
| David Martin 1744 | Linked README states “Public Domain” | Verify digital transcription/additions and provider attribution/terms |
| Bíblia Livre — Textus Receptus | Linked README states “Creative Commons Attribution 3.0 Brazil” | Obtain full attribution and modification requirements from the original rightsholder; this differs from the phase-one manifest's CC-BY-4.0 identifier and needs explicit review, not relabelling |
| Cherokee 1860 module | Linked README states “Public Domain” | Verify the historic printing and rights/provenance of the added transliteration; provider terms and availability remain unknown |

**No API.Bible offline rights, retention period, redistribution right, request
quota, tracking requirement or mandatory attribution string has been verified.**
A public-domain work does not establish that an API service permits permanent
bulk caching of its responses. No remembered “500 verses” rule or request limit
is treated as current contractual fact. Commercial/noncommercial conditions and
end-user attribution must be checked for the specific API account and edition.

## Required completion once access is available

1. Read the current official API documentation and service/account terms at
   [API.Bible](https://api.bible/) and [its documentation](https://docs.api.bible/).
   Record dated evidence, including offline storage, expiry/deletion requirements,
   redistribution, quota, required tracking and exact attribution language.
2. With a read-only account key supplied through the environment's secure secret
   facility, retrieve `GET /v1/bibles` from `https://rest.api.bible`. Retain only
   public metadata; never write the key to the app, report, fixtures or logs.
3. For each matching ID retrieve its metadata and `/books` list. Record every
   available Apocrypha book individually; identify combined/split books and missing
   books. A name match alone is insufficient to select an edition.
4. Compare sample passages and publisher statements to distinguish KJV-based
   translations from related traditions. Present candidates to the owner without
   selecting one. Where no suitable translation exists, say so.
5. After the owner's choice, separately implement Worker-only access, labelled
   KJV fallback for missing books, and explicit KJV verse-number mapping tables.
   Online-only editions must remain online-only. Do not substitute other sources
   for gaps or silently drop/merge verses.

This is a documented investigation with an external access blocker, not a
completed API.Bible licensing clearance or authorization to build translations.
