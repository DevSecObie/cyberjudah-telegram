> October 27 scope update: the owner now requires paid Ask through all linked sign-in methods. The earlier free-only native profile described below is superseded. Firebase Google/Apple/email plus verified Telegram linking preserve the existing Ask wallet. See STORE_BILLING_SETUP.md for the native purchase release gate. Bible Strong remains the reference for provider and account-recovery behavior; its identifiers and credentials are not copied.

# Bible Strong parity review

Current owner direction, 27 October 2026: **use Bible Strong's behavior and UI; do not create anything outside what Bible Strong provides.** The earlier instruction to retain custom Apple Liquid Glass styling is superseded. Port the actual upstream screen/component structure, controls, spacing and interactions. Do not replace them with a newly designed dashboard, account panel, navigation item or approximation based only on screenshots. Keep CyberJudah's data and verified authentication adapters behind those components. The separate Expo prototype is not the deployed product.

Use upstream revision `39d878091d12c0f8074464f5ff79fa4bb94f737f` for this review. Read its `design-system/project/README.md` ("The app") and the corresponding source before changing a screen. Record the source path and test the real behavior, including keyboard, touch and narrow/wide layouts. The remaining differences below are an inventory, **not approval to retain custom UI or a claim of complete parity**.

The native staging branch restores `features/app-switcher/BottomTabBar`'s five actions: Home, Search, Bible, Tabs, Menu. Existing CyberJudah resources remain in the menu; no new action is added. The account-card fix changes its identity data source only, following upstream `useLogin`'s reactive account behavior. Browser Telegram and Firebase sessions now update that existing card, but an unlinked Firebase account still cannot use a Telegram wallet. A new custom Home/account draft was discarded. Login/profile visual parity remains unfinished; Telegram-linking and paid Ask are CyberJudah-specific flows and must not be described as copied upstream behavior.

Latest upstream checked for the current gesture work: `a40b63c5bef7fbe41dbd1573780e65e736eab333` (8 October 2026). Its changes after the previously checked `eed343d` concern resource publication, not the Expo reader/navigation source. The earlier review below remains a gap inventory, not a claim of complete current-source parity.

## Release fixes checked 27 October 2026

Upstream reference: [smontlouis/bible-strong at `39d878091d12c0f8074464f5ff79fa4bb94f737f`](https://github.com/smontlouis/bible-strong/tree/39d878091d12c0f8074464f5ff79fa4bb94f737f). Its current README links the iOS, Android and web products. The store configuration is in `apps/expo/app.config.ts` and `eas.json`; native Firebase authentication and session recovery are in `src/helpers/FireAuth.ts` and `authSessionRecovery.ts`; `features/search/usePassageSearch.ts` keys local/online results by connectivity and pages local resources. Web sheets use `common/vaulBottomSheet.tsx`.

This release retains CyberJudah's current reader and content. Its offline-search adapter follows the upstream local-page contract using the already-downloaded KJV chapters, and reuses CyberJudah's server query parser for quoted phrases, number/name variants and strict/loose matching. Connectivity is part of the query key so reconnecting cannot append live hits to an offline page. Local results state exactly how many saved chapters were searched; they do not imply a complete library or identical SQLite/BM25 ranking.

Browser Telegram sign-in now unlocks Ask using the verified cookie session; conversation storage is scoped to the verified numeric user ID and clears its active state on logout/deletion. No Telegram SDK identity is fabricated. Cancelled class-notes gestures perform no action, an interrupted settling animation cannot reset a newer drag, and native Back delegates to the reader's existing sheet stack and tab history.

Bible Strong's Firebase identities, app IDs, signing accounts, store approvals and third-party content are not CyberJudah credentials or entitlements. Its native Apple/Google/e-mail authentication cannot be copied into a Telegram-ID backend without an explicit identity/account migration. Native authentication, the native paid offering and physical-device validation remain separate release gates in `STORE_READINESS.md`.

## Implementation constraint

The owner rejected custom substitutes on 8 October and reiterated this on 27 October 2026. Reuse the pinned Bible Strong components and interaction modules with CyberJudah's content. Custom Glass styling is no longer an exception. Do not add substitute forms, extra action rows or alternate annotation controls. The custom “Mark phrase” entry/form has been removed; its saved annotations and backup format remain intact. The separate Expo app is still not a replacement deployment.

## Current reader gesture corrections

The existing reader retains its taught-precept chips, explanation sheets, personal relations and inline class decks. Fast taps on distinct verses now deliver the first selection before starting the next gesture; cancellation, multi-touch and lost window focus clear the held press so a late release cannot select a verse or open resources. Both configured short/long press modes keep their existing actions. A fast sheet release uses its actual release position to decide dismissal.

`reader-parity.spec.ts` exercises rapid mouse/touch selection, cancelled-touch recovery, multi-touch interruption, focus loss and the press preference; `telegram.spec.ts` covers rapid sheet dismissal and the existing precept/class flows. These are interaction fixes, with no new layout or content substitution. Double-tap word annotation, rich/free-note behavior and the remaining differences below still need focused integration and previews; the existing gesture callback does not yet provide upstream's word-annotation workflow.

## Earlier baseline review

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
| Bible search: `search/README.md` | Public, paginated scripture search with relevance/Bible order. Book and testament filters run before paging, including Apocrypha. Typed ranges keep both endpoints. | Multiple versions and semantic search across translations need approved editions. Downloaded KJV chapters are now searchable offline with an explicit coverage label; complete-library search requires all relevant chapters to be downloaded. |

## Study, content and personal data

| Area / upstream source | CyberJudah implementation | Remaining difference |
| --- | --- | --- |
| Verse actions / `SelectedVersesModal` | Highlights, custom colors, text/underline styles, notes, tags, links, relations, bookmarks, focus, copy/share/export, phrase marks and Add to study. | Verse notes are plain text; personal study writing has Markdown formatting and a safe preview. |
| Personal studies / `studies` | Studies list/search, writing/scripture/Strong's blocks, ordering, tags, local autosave with conflict detection, import, JSON/Markdown export, print/PDF, manual cloud backup, and, where account sync is turned on, automatic synchronization through Firebase across a reader's own signed-in devices. | Not upstream's full rich-text editor, templates or image embeds. |
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
| Audio / `audio` | Device speech, free generated voices and licensed recordings; speed/pitch where supported, verse following, continuous chapters, repeat and ambient sound. Existing recording and continuity tests cover the engines. | No sleep timer in the active player. Browser/Telegram background and lock-screen behavior depends on the host; native long-running audio needs device validation. |
| Downloads / `resources`, `settings/DownloadsScreen` | Offline book/recording downloads, approved resource installation, checksums, pinned releases, quotas, progress and removal. Shell update test checks stale shell deletion. | Cannot promise persistent browser storage after OS eviction. Offline search uses the downloaded chapters and reports missing coverage. |
| Backup / `settings/ImportExportScreen` | Settings backs up reader preferences, notes and marks; Account backs up personal studies/phrase marks, with explicit restore and conflicts. | Two backup scopes; manual backup is **not** automatic sync. No silent cross-app backup import. |
| Account / `profile`, `settings` | Telegram identity, browser Telegram login, privacy export/deletion and optional platform capabilities. | Browser login needs owner's BotFather/OIDC configuration; this is not upstream Google/Apple/Firebase login. |
| Help / `settings/FAQScreen`, onboarding | Settings/Menu → Help & reading guide covers reading, study tools, audio, backups and platform keyboard controls. | Interactive guided onboarding remains different. |
| Native packaging | Capacitor packages the existing app; Android/iOS projects and CI exist. | Signing, store accounts, physical-device review, purchases and background behavior require owner/platform setup. See `STORE_READINESS.md`. |

## Verification and next work

`app/e2e/reader-parity.spec.ts` covers the changed reader/tab, export, search, settings, Home and plan workflows. It runs in Chromium, WebKit and Firefox. `tab-flow.spec.ts` retains transition and viewport tests; `study-tools.spec.ts` covers personal studies; existing recordings, ambient, resource, offline, CMS and privacy suites remain required. Pure export tests check scope boundaries, relation deduplication/direction and omitted fields; Worker tests check dated scripture and real FTS filtering/paging.

The remaining differences above are not marked complete. Work that can use existing approved data: retained screen history, richer notes/libraries, saved plans, global study tags/relations, inline commentary controls and guided onboarding. Offline scripture search is now implemented for saved chapters as described above. New translations, pericope text or interlinear data stay behind the existing source/licence requirements. Native platform guarantees need physical-device verification.
