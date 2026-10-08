# Bible Strong parity review

Reference: [smontlouis/bible-strong at 8ca8842](https://github.com/smontlouis/bible-strong/tree/8ca884298e109f20762415d4b9d6581d3506e963/apps/expo/src/features), reviewed 2026-10-08.
CyberJudah baseline: `4434426` (including personal studies, phrase marks, reading plans and native packaging from #200).

The active Telegram and website reader is `app/src/bible/BibleTab.tsx`. The separate Expo fork under `strong/` does not establish parity for this reader. This review compares navigation and behavior, not just whether a similarly named screen exists. CyberJudah keeps its KJV with Apocrypha, teachings, Liquid Glass navigation and reading surfaces.

## Navigation, Home and reading

| Area / upstream source | Current implementation and corrections in this change | Remaining difference |
| --- | --- | --- |
| Home: `home/README.md`, daily scripture | Home and its drawer share five dated verses, day controls, sharing and an image. The verse follows the reading font. Failed fetches no longer look like valid empty verses. | Uses CyberJudah's curated verses and image card. |
| Home resources and profile | Greek/Hebrew Strong's, dictionary, topic, person and precept widgets; shuffle, random verse, classes and resume reading. Studies now counts personal studies and opens them. | Uses CyberJudah's resources; Bible Project, upstream devotionals and upstream paid media are not copied. |
| Tabs: `app-switcher`, `state/tabs.ts` | Groups, colors, previews, close/new, swipe between groups and collapse/expand transitions already shipped. Fixed new-tab action selecting the first tab. Reader selection, expanded passage context and collapsed header now survive leaving and returning to a tab. | Other screens still store a route rather than retaining every mounted view and nested navigation history. |
| Desktop: `WorkspaceKeyboardShortcuts.web.tsx`, `commandPalette` | Search open tabs, tools and typed scripture; Cmd/Ctrl+K; Cmd/Ctrl+Alt+N/W; Alt+Up/Down; recent-tab chooser using Ctrl+Q on Mac or Alt+Q elsewhere. New Tab search opens this palette. | CyberJudah keeps its existing dock/drawers instead of adopting the upstream desktop sidebar. |
| Passage selection and context: `bible/README.md` | Book/chapter/verse picker, chapter swipes, reference focus, expand/return/exit, reading history. Focus now contains only the selected passage; removed the blurred neighboring verses that upstream also removed. | No additional translation selector until another translation has an approved source. |
| Appearance: `BibleParamsModal` | Fonts, size, theme, alignment, line height, inline/block verses, highlight palettes, share formatting and relation/tag layout. Added working verse-number visibility, retaining accessible verse numbers. | Pericope headings require a sourced dataset. |
| Export: `passageExport/PassageExportSheet` | Selection/chapter/book scope; scripture, notes, links, personal precepts, tags and phrase marks; preview, copy and real file saving. Overlapping notes identify their wider scope; failed preparation cannot produce a partial file. | Exports text and existing study formats. It does not translate another app's private backup schema. |
| Bible search: `search/README.md` | Public, paginated scripture search with relevance/Bible order. Book and testament filters run before paging, including Apocrypha. Typed ranges keep both endpoints. | Multiple versions and semantic search across translations need approved editions. Offline full-text Bible search is not implemented. |

## Study, content and personal data

| Area / upstream source | CyberJudah implementation | Remaining difference |
| --- | --- | --- |
| Verse actions / `SelectedVersesModal` | Highlights, custom colors, text/underline styles, notes, tags, links, relations, bookmarks, focus, copy/share/export, phrase marks and Add to study. | Verse notes are plain text; personal study writing has Markdown formatting and a safe preview. |
| Personal studies / `studies` | Studies list/search, writing/scripture/Strong's blocks, ordering, tags, local autosave with conflict detection, import, JSON/Markdown export, print/PDF and manual cloud backup. | Not upstream's full rich-text editor, templates, image embeds or automatic Firebase synchronization. |
| Notes/highlights/bookmarks / `notes`, `settings` | Kept lists, editing, deleting, labels, passage links and eight reader bookmarks. | Full upstream rich-text note format and multi-criteria library sorting remain different. |
| Relations / `studyRelations` | Typed, directed links between scripture, notes, dictionary entries and library entries; class precepts are separately sourced. | Personal-study blocks/tags do not yet participate in every global relation/tag workflow. |
| Lexicon / `lexique` | Pinned Strong's lexicon, lookup, search, occurrence pages, word-aligned KJV spans and Add to study. | Original-language morphology is not fabricated; dictionary forms are not verified verse morphology. |
| Interlinear / `bible` | Existing KJV alignment and separately labeled Greek parallel for covered Apocrypha. | Not a complete Hebrew/Greek interlinear; an aligned, licensed source is required. |
| Parallel Bible / `CompareVersesScreen` | Precepts and cross references beside the KJV. | This is **not** multi-translation comparison. More translations need licensing/source approval. |
| Dictionary / `dictionnary` | Easton's dictionary, browse/search, verse resources and downloaded approved editions. | Upstream's Westphal text is not substituted for CyberJudah's sources. |
| Topics / `nave` | Class topics, scripture threads, precepts and approved topical resource releases. | Source-specific content differs intentionally. |
| Commentary / `commentaries` | Verse resources show class teaching, breakdowns, source links and timestamps; precept and class cards appear in the reader. | No equivalent of upstream's full selectable inline commentary-source panel. |
| People / chapter entities | People index, scripture references, relationships and photos; chapter people and CMS editing already exist. | Dataset coverage governs available relationships; never fill gaps with invented family links. |
| Timeline / `timeline` | Timeline periods, events, search and admin editing; IUIC events remain within the timeline, ending with Redemption. | CyberJudah content and historical evidence rules take precedence. |
| Plans / `plans` | Whole Bible, NT, Apocrypha, Psalms/Proverbs, Law and single-book plans; pace, daily schedule, catch-up, reading progress and reminders. Fixed in-app reading action, reversible keyboard/touch completion, selected-plan restart and progress count. | One active schedule; saved/completed plan library and multimedia devotional schedules are not equivalent yet. |

## Audio, offline, account and platform

| Area / upstream source | CyberJudah implementation | Remaining difference |
| --- | --- | --- |
| Audio / `audio` | Device speech, free generated voices and licensed recordings; speed/pitch where supported, verse following, continuous chapters, repeat, sleep timer and ambient sound. Existing recording and continuity tests cover the engines. | Browser/Telegram background and lock-screen behavior depends on the host; native long-running audio needs device validation. |
| Downloads / `resources`, `settings/DownloadsScreen` | Offline book/recording downloads, approved resource installation, checksums, pinned releases, quotas, progress and removal. Shell update test checks stale shell deletion. | Cannot promise persistent browser storage after OS eviction. Offline full-text search remains separate from downloading readable chapters. |
| Backup / `settings/ImportExportScreen` | Settings backs up reader preferences, notes and marks; Account backs up personal studies/phrase marks, with explicit restore and conflicts. | Two backup scopes; manual backup is **not** automatic sync. No silent cross-app backup import. |
| Account / `profile`, `settings` | Telegram identity, browser Telegram login, privacy export/deletion and optional platform capabilities. | Browser login needs owner's BotFather/OIDC configuration; this is not upstream Google/Apple/Firebase login. |
| Help / `settings/FAQScreen`, onboarding | Settings/Menu → Help & reading guide covers reading, study tools, audio, backups and platform keyboard controls. | Interactive guided onboarding remains different. |
| Native packaging | Capacitor packages the existing app; Android/iOS projects and CI exist. | Signing, store accounts, physical-device review, purchases and background behavior require owner/platform setup. See `STORE_READINESS.md`. |

## Verification and next work

`app/e2e/reader-parity.spec.ts` covers the changed reader/tab, export, search, settings, Home and plan workflows. It runs in Chromium, WebKit and Firefox. `tab-flow.spec.ts` retains transition and viewport tests; `study-tools.spec.ts` covers personal studies; existing recordings, ambient, resource, offline, CMS and privacy suites remain required. Pure export tests check scope boundaries, relation deduplication/direction and omitted fields; Worker tests check dated scripture and real FTS filtering/paging.

The remaining differences above are not marked complete. Work that can use existing approved data: retained screen history, richer notes/libraries, saved plans, global study tags/relations, inline commentary controls, offline scripture search and guided onboarding. New translations, pericope text or interlinear data stay behind the existing source/licence requirements. Native platform guarantees need physical-device verification.
