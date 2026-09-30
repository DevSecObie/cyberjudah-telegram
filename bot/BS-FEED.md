# CyberJudah resource feed

The Worker serves the Bible Strong HTTP interface at `https://cyberjudah.io/bs`.
Set `EXPO_PUBLIC_RESOURCE_API_URL` to that base URL. These are public routes,
independent of Telegram authentication. All content comes from CyberJudah's dataset
(`DATA_ORIGIN`, normally `https://data.cyberjudah.io`) or its existing bundled Easton
file. There is no Bible Strong content or fallback to a Bible Strong server.

The interface is pinned to `smontlouis/bible-strong` commit
`61cf39c8c4a65220212dbac9536794e43ae8207e`. The test-only Effect contracts and their
GPL-3.0 license live in `tests/upstream/`. `npm test` from `bot/` runs the existing
suite and installs/runs the separately locked contract test dependencies inside
`bot/tests`, keeping the root workspace lockfile untouched.

## Compatibility and unavailable fields

- Bible version: **KJV only**, with 81 books. `data/bs-books.json` fixes books 1–66
  in Protestant order, then 67–81 as 1 Esdras, 2 Esdras, Tobit, Judith, Rest of
  Esther, Wisdom of Solomon, Ecclesiasticus, Baruch, Epistle of Jeremiah, Song of
  the Three Holy Children, History of Susanna, Bel and the Dragon, Prayer of
  Manasses, 1 Maccabees, 2 Maccabees. Source slugs stay unchanged. Rest of Esther
  retains source chapter IDs 10–16; it is not renumbered to 1–7.
- **An unchanged upstream app cannot fully consume this 81-book canon.** Its request
  validators, verse-key parser and `BibleVerseTextDto.book` stop at 77; its canon
  lists/names also need this numbering. Chapter/search/coverage response schemas
  already accept 81. Tests validate every other response with the unmodified
  upstream Effect schemas; the book-81 verse-text test records upstream rejection
  and validates the same schema with only the book bound extended to 81. We do not
  claim that this payload passes the original 77-book schema. The feed also accepts
  `canon=kjv-1611`; foreign numbered canons return `BIBLE_UNSUPPORTED`.
- Select the resource IDs advertised here: dictionary `easton/en`, commentary
  `cyberjudah/en`, Topics in `en`, classic Strong's in `en`. The API has no
  commentary catalog route. App catalogs hardcoded to other works must be configured
  for these IDs; this PR changes only the Worker.
- CyberJudah's `/api/lxx/<slug>/<chapter>.json` is **untagged Greek text** from
  Swete's Septuagint. The KJV Apocrypha chapter response carries available Greek
  as a labeled `presentation.notes` layer. Verse numbering can differ. No Greek
  words are falsely aligned to English; Apocrypha Strong spans are empty and Strong
  coverage contains only the 66 books with actual tags. No eStrong/dStrong/uStrong,
  STEP token IDs, morphology, lexeme/POS statistics, LSJ resources, named entities,
  or simplified/French lexicon definitions are supplied. `stepCode` is the classic
  Strong code used as the app's navigation key; `eStrong`/`dStrong` are empty.
  Transliteration/pronunciation are retained only where CyberJudah has them.
- Easton IDs are one-based positions in the existing bundled dictionary revision.
  Definitions are escaped HTML paragraphs. Passage discovery uses literal terms
  and phrases in KJV text (`verse-phrase` evidence), not invented source citations
  or cross-work correspondences. There is no offline download resource.
- Commentary HTML retains available class title/link, date, teacher, precept text
  or explanation, verse breakdown and timed YouTube link. Bishops precede Deacons,
  then other teachers, newest date first within each rank. Discontiguous verse
  associations remain separate reading sections. Missing dates/teachers/video IDs
  stay absent; a timestamp is not invented. Precept videos are resolved from exact
  class moments or `/api/notes/index.json`. Coverage uses concordance `cited`
  chapters: some contain only citations and therefore have empty teaching sections.
  Reading-section requests require the exact reading-index revision; stale IDs
  return a typed 404. The adapter does not supply book/chapter introduction prose.
- Our Hidden History currently describes **episodes**, with publication dates, not
  dated historical events with periods. Timeline lists return empty; event lookup
  returns `TIMELINE_EVENT_NOT_FOUND`. Episode dates are not presented as event dates.
- Pericopes and semantic search return schema-valid empty results. Interlinear
  routes return `INTERLINEAR_UNSUPPORTED` (404), rather than fabricating the required
  `BHG`/`STEP` publication metadata. Search events return `{accepted:false}` (202)
  and are not stored. Unsupported enhanced lexicon collections are empty or 404.
- Xref identifiers are language-neutral. Both `/fr` (the original request schema's
  sole language) and `/en` return our same numeric references. No translated content
  is implied. Bible presentation layout/headings/start tags are empty; lexical search
  returns escaped full verse text in `highlighted` without synthetic highlight tags.

## Route/source/contract map

All paths below are relative to `/bs`. `GET` unless marked `POST`. Response type
names refer to the upstream files in `packages/resource-domain/src/contracts`;
problem responses use `resource-service/src/http/problems.ts`.

| Route | CyberJudah source / behavior | Response Effect schema |
|---|---|---|
| `/health` | Worker availability | `HealthResponse` |
| `/v1/bibles/:version/books/:book/chapters/:chapter` | `/api/kjv/<slug>/<chapter>.json`; optional `/api/lxx/...` parallel note | `BibleChapterDto` |
| `/v1/bibles/chapters` | Same chapter, KJV only; duplicate versions collapsed | `BibleChaptersDto` |
| `/v1/bibles/:version/verses` | KJV chapters grouped by requested verse keys | `BibleVerseTextsDto` (81-book extension above) |
| `/v1/bibles/:version/coverage` | Generated counts and actual source chapter IDs from all KJV chapters | `BibleVersionCoverageDto` |
| `/v1/bibles/:version/search` | CyberJudah D1 `search_docs`, verse-only; shared parser/FTS policy in `src/search.ts` | `BibleSearchResponseDto` |
| `/v1/bibles/search` | Same search; KJV only | `BibleMultiSearchResponseDto` |
| `/v1/bibles/:version/semantic-search` | Empty results/count 0 | `BibleSearchResponseDto` |
| `/v1/bibles/semantic-search` | Empty results/count 0 | `BibleMultiSearchResponseDto` |
| `/v1/bibles/:version/pericopes` | Empty verses | `BiblePericopeIndexDto` |
| `/v1/strong-bibles/:version/coverage` | Actual tagged verses in CyberJudah KJV chapters | `StrongBibleCoverageDto` |
| `/v1/strong-bibles/:version/books/:book/chapters/:chapter` | KJV `verses[].words` → exact UTF-16 spans and classic identities | `StrongBibleChapterDto` |
| `/v1/strong-bibles/:version/books/:book/identities/:reference/counts` | Complete generated chapter-tag index, distinct verses per book | `StrongBibleCountsDto` |
| `/v1/strong-bibles/:version/books/:book/identities/:reference/occurrences` | Same complete index; stable cursor, book/allBooks filter, matching spans | `StrongBibleOccurrencesDto` |
| `/v1/strong-bibles/:version/books/:book/identities/:reference/lemmas` | Empty; no disambiguated lexeme/POS data | `StrongBibleLemmaStatsDto` |
| `/v1/strong-lexicon/modules/:moduleId` | `core` available; enhancements unavailable | `StrongLexiconModuleStateDto` |
| `/v1/strong-lexicon/entries/:reference` | `/api/strongs/<Hn\|Gn>.json` | `StrongLexiconEntryDto` |
| `/v1/strong-lexicon/entries/batch` | Same entries for classic identities; unsupported identities omitted | `StrongLexiconEntryCardsDto` |
| `/v1/strong-lexicon/entries` | `/api/strongs/index.json`; filter and cursor | `StrongLexiconSearchResponseDto` |
| `/v1/strong-lexicon/random` | One matching entry from same index | `StrongLexiconSearchResponseDto` |
| `/v1/strong-lexicon/morphologies` | Empty; no morphology descriptions | `StrongLexiconMorphologyResponseDto` |
| `/v1/strong-lexicon/entities/:uniqueName` | Unsupported entity module | `ResourceNotFoundProblem` |
| `/v1/strong-lexicon/entities/chapters/:bookCode/:chapter` | Empty; no lexicon entity associations | `StrongLexiconChapterEntitiesResponseDto` |
| `/v1/dictionaries` | Existing `bot/data/easton.json` + provenance; one English work | `DictionaryCatalogResponseDto` |
| `/v1/dictionaries/directory` | Easton term directory with stable cursor | `DictionaryDirectoryResponseDto` |
| `/v1/dictionaries/:work/:language/entries` | Easton term list, initial/search/cursor | `DictionaryEntriesResponseDto` |
| `/v1/dictionaries/:work/:language/entries/batch` | Easton definitions for requested words | `DictionaryEntriesBatchResponseDto` |
| `/v1/dictionaries/:work/:language/entries/:word` | Easton exact word/slug, then existing `dictionary.ts` lookup | `DictionaryEntryResponseDto` |
| `/v1/dictionaries/:work/:language/entries/by-id/:id` | Easton ID in this revision | `DictionaryEntryResponseDto` |
| `/v1/dictionaries/:work/:language/verses/:verseKey/words` | Literal Easton term/phrase matches in KJV | `DictionaryVerseWordsResponseDto` |
| `/v1/dictionaries/:work/:language/verses/:verseKey/entries` | Same matches with `verse-phrase` evidence | `DictionaryPassageAnchorsResponseDto` |
| `/v1/dictionaries/verses/:verseKey/entries` | Same matches plus work metadata | `DictionaryPassageDiscoveryResponseDto` |
| `/v1/naves/:language/topics` | `/api/topics/index.json` | `NaveTopicListResponseDto` |
| `/v1/naves/:language/topics/:normalizedName` | `/api/topics/<slug>.json`, topic items and complete teaching thread | `NaveTopicResponseDto` |
| `/v1/naves/:language/verses/:verseKey/topics` | Exact verse and chapter-wide associations in topic threads | `NaveVerseTopicsResponseDto` |
| `/v1/naves/:language/random` | One topic from our index | `NaveTopicResponseDto` |
| `/v1/commentaries/:collection/:language/coverage` | `/api/concordance/index.json`, cited chapters | `CommentaryCoverageResponseDto` |
| `/v1/commentaries/:collection/:language/chapters/:book/:chapter` | Concordance `precepts` and `commentary`, serialized verse → HTML array | `CommentaryChapterResponseDto` |
| `/v1/commentaries/:collection/:language/verses/:verseKey` | Same teaching fragments for one verse | `CommentaryVerseResponseDto` |
| **POST** `/v1/commentaries/reading-index` | Same fragments → contiguous sections/excerpts, with unavailable selections | `CommentaryReadingIndexResponse` |
| **POST** `/v1/commentaries/reading-section` | Exact section and revision from reading index | `CommentaryReadingSectionResponse` |
| `/v1/cross-references/:language/verses/:verseKey` | `/api/xref/<slug>/<chapter>.json` tuples → numeric verse keys | `CrossReferenceResponseDto` |
| `/v1/timelines/:language/events` | Empty; Hidden History is episode data | `TimelineEventsResponseDto` |
| `/v1/timelines/:language/events/:slug` | No dated historical event record | `ResourceNotFoundProblem` |
| `/v1/interlinear-bibles/:version/languages/:language/coverage` | Unsupported | `ResourceNotFoundProblem` |
| `/v1/interlinear-bibles/:version/languages/:language/books/:book/chapters/:chapter` | Unsupported | `ResourceNotFoundProblem` |
| **POST** `/v1/search-events` | Not collected, `accepted:false`, status 202 | `SearchAnalyticsAcceptedDto` |

`commentarySections` has no response Effect schema of its own. Tests additionally
compare the adapter's actual sections/indexes with its upstream section builders.
`strongBibleConcordance` is tested for the same Hebrew/Greek prefix normalization.
Invalid/missing/unavailable responses are tested against the original problem schemas.

## Coverage, completeness and updates

The engine caps `/api/strongs/<code>.json` occurrence samples at 600. The Worker
therefore builds its complete concordance from all 1,362 published KJV chapters,
not from those samples. The generated files contain coverage, SHA-256 hashes and
numeric locations/offsets only, not a second copy of scripture or definitions.
`bs-strong-index.json` stores base64 unsigned LEB128 tuples per identity:
`[delta(book*1000000+chapter*1000+verse), ordinal, startOffset, length]`.

The initial snapshot was read from CyberJudah data commit
`ac2faca11db79a8bdbd36472d83e15e2ff690bf1`, source commit
`20fb34b7556d48d35c7d7d9bda6a2f0dcc9dd263`, built 2026-09-30. The data domain
returned HTTP 403 from the development environment, so inspection used the
engine README's documented GitHub `data` publication. Runtime reads still use
`DATA_ORIGIN`; a production-origin end-to-end check remains necessary after deploy.

Refresh after a KJV text/tag change from a consistent CyberJudah data checkout:

```sh
cd bot
npm run build:bs-index -- /absolute/path/to/cyberjudah-data-checkout
npm run typecheck
npm test
```

The text hash covers canonical JSON `[book, chapter, [[verse, text], ...]]` rows in
our fixed book order and source chapter order. Chapter reads verify text/tag hashes
before publishing the corresponding Bible/Strong revision. Changed scripture/tags
fail with a typed 503 requiring an index refresh, rather than serving stale offsets
as if they matched. Counts/coverage describe the bundled snapshot. Changes to class
notes, Topics and lexicon definitions are read live through the origin cache and
receive content-derived revisions; they do not require a KJV index rebuild.

Responses use the dictionary cache policy: public GETs for one hour, detail/chapters
for a day; upstream JSON is edge-cached for one hour. POSTs and errors use `no-store`.
All `/bs` responses include CORS and `nosniff`; failed source responses are not cached.
