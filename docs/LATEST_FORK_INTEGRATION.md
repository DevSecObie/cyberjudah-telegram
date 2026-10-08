# Reader integration: preserve the existing CyberJudah app

## Current owner direction — 8 October 2026

Improve the existing app in `app/`. Bring Bible Strong's reader and interaction behavior into that app while preserving CyberJudah's content, features, identity, navigation destinations and Apple Liquid Glass. The staged Expo app in `strong/` is reference work, not the replacement product. There is no plan to promote it over `/app`. PR #203 stays parked as a draft; extract useful changes into focused work on the existing app rather than merge the prototype wholesale.

The owner-approved Home, Tabs and New Tab previews establish a visual and interaction reference. They do not authorize replacing the application, dropping content or substituting upstream services. Show previews before applying further visible changes, using the existing CyberJudah app and real content. Exercise the resulting interactions end to end; screenshots alone do not establish parity.

The latest upstream checked is `smontlouis/bible-strong` master at `a40b63c5bef7fbe41dbd1573780e65e736eab333` (8 October 2026). GitHub's comparison from the vendored `eed343dcb6a119f048068cf16a4de31fd7bb160c` shows five newer commits affecting resource publication tooling and the resource catalog, with no Expo reader or navigation changes. This check does not establish full parity with the existing app.

## Features that must remain

| Area | Existing behavior to preserve |
| --- | --- |
| Reader | KJV and Apocrypha; taught-precept explanation chips, scripture links and overflow; personal precepts; class thumbnails, transcript readings, timestamps and notes; chapter people and resources. The owner's Genesis 1 screenshot is the content-in-reader baseline. |
| Ask CyberJudah | Existing answers, source links, saved chats, privacy controls, free-provider configuration and verified Worker identity. The upstream generic assistant is not a substitute. |
| Content | Classes and pending notes, 4 Chapters a Day study notes, People, Law, Precepts, Case studies, Timeline, Topics, Encyclopedia, Glossary, Concordance, Dictionary, Lexicon and Library. Preserve all timeline events and the final Redemption period. |
| Personal tools | Notes, highlights, links, relations, studies, annotations, bookmarks, tags, tabs/groups, history, plans and progress. Preserve existing data and export/backup access throughout migration. |
| App services | Apple Liquid Glass, reduced transparency/motion and accessibility, audio, offline resources, Sabbath, reminders, search, settings, privacy, sharing, support and the existing admin/CMS screens. |

Use `app/src/App.tsx`, Home, More, reader actions and `shared/app-features.mjs` together for the inventory; the feature register alone does not include every route or interaction. Renaming a feature or adding a link does not establish equivalent behavior.

The owner's Latest Teachings screenshot is an explicit requirement within that layout: thumbnail-and-text rows, collection badges, date and teacher, and the All classes link. For the classes of 3 October, the order is Haiti, You Are Hated And In Hell, The Slave Mentality, then Blood Toucheth Blood. This is broadcast order, not a fixed list of titles. Newer classes remain visible above them: the 5 October Day of Atonement class is first in the current published feed. The fork's generic Classes card does not replace a featured class, so the newest teaching must not be removed from its Home list.

## Implementation boundary and next work

1. Keep the existing application shell, routes, content adapters and reader supplements. Compare the current reader against the latest upstream source, including tap/long press, word selection, verse actions, sheets, free notes, passage context, chapter navigation, tabs and return behavior.
2. Port individual reader behaviors through the existing `app/src/bible`, studies and navigation modules. Present any visible layout change in the existing app for preview first. Preserve the taught-precept and class integrations in `app/src/lib/taught.ts`, `BibleTab.tsx`, `WhySheet.tsx` and `ResourcesSheet.tsx` while changing the interaction beneath them.
3. Continue the separately authorized Firebase architecture in the existing app. Reuse tested Worker identity and migration logic where appropriate; the prototype's components and Redux data model are not the new application contract. Firestore remains the intended record for notes/revisions, with SDK offline persistence, stable verified Telegram UIDs, separate CloudStorage/device migration commit points, and no D1 note mirror. Do not change the owner-published rules or switch storage before the required emulator and migration tests pass.
4. Preserve source/licence constraints for new editions and interlinear data. Do not replace CyberJudah datasets with upstream equivalents to make a screen appear complete.
5. Validate the integrated changes in the existing app: precept explanation → scripture → return, class thumbnail → recording/notes → return, Ask and saved chats, long presses, free-note create/edit/reload, tabs/groups, account isolation, offline edits and migration recovery. Use the existing glass, accessibility, CMS and content suites as regression checks.

The detailed earlier gap review in `docs/BIBLE_STRONG_PARITY.md` remains a starting point, not a completion claim. Its remaining differences include rich notes/studies, retained screen history, inline commentary controls and offline full-text search. Reassess those against the current reference before implementation.

## Historical prototype work (parked)

- Update the Expo app and the four resource packages from the prior upstream pin, preserving CyberJudah's KJV/Apocrypha, public resource feed, English default, service configuration and security fixes.
- Preserve the approved navigation geometry, CyberJudah palette and navigation glass, including reduced-transparency behavior.
- Add a public, read-only class feed at `/app/strong/_content/teachings`. It uses the same broadcast sorting and series labels as the main app, the existing RSS/channel-page/last-good fallback, and the reader's time zone. Origin failures produce an error rather than a successful empty list.
- Use real CyberJudah thumbnails in the Classes card. Show the existing Latest Teachings rows on Home and populate the upstream Classes library. Noted classes open the existing CyberJudah notes; pending classes open the existing recording screen. Account and note editing rights remain enforced by their existing routes.

- Connect Timeline geometry and details to CyberJudah sources and approved photos, retaining all events and the final Redemption card. Show original source quotations and scripture separately.
- Use the actual Easton dictionary identity and CyberJudah's Strong's publication identity. Browser resource queries use browser connectivity instead of a third-party reachability probe.
- Generate five CyberJudah reading plans from the pinned book/chapter metadata, including the Apocrypha. Keep the upstream plan screens and progress model.
- Configure the owner's Firebase project, keep analytics disabled, and reconcile the owner-supplied rules with private saved-data sync. The base rules were owner-confirmed published on 8 October; the owner also confirmed publishing the revision amendment and delete correction, mirrored locally. Ten rules tests and seven migration-engine tests pass against Firestore emulators. See `strong/firebase/README.md`.
- Add verified Telegram-to-Firebase sign-in with stable `tg_<id>` UIDs, SDK session restoration before minting, and SDK persistent offline caching. Browser bridge tests prove fresh mint counts, cold-start restoration and two-device identity. The owner confirmed configuring the Worker-only service-account secret; live sign-in still needs verification after deployment.

## Why the prototype is not the product

- Its navigation omits existing CyberJudah features such as Ask CyberJudah, public Precepts, People, Law, Case studies, Topics and Library. The upstream reading plan is not the existing 4 Chapters a Day study notes, and its generic assistant is not Ask CyberJudah.
- Its reader does not consume the concordance's `precepts` field. The original app already renders the owner's Genesis 1 explanation chips, scripture links and overflow alongside personal relations.
- Its passage-media adapter consumes teaching `moments`; the existing reader also includes transcript `read` entries, including classes without notes. A working media endpoint or thumbnail screenshot did not establish equivalent coverage.
- Its complete content, CMS, help and share-link integration is unfinished. Its independent account-sync browser test also fails in CI at `8975aa8`; a local fix is pending verification. These are prototype limitations, not reasons to replace working CyberJudah screens.

The staged route `/app/strong` remains reference work. No entry point or production configuration is changed by this scope correction.

The 8 October staged walkthrough covers only Home, Latest Teachings, reader long press, tabs and one test-account note. It does not demonstrate content parity. During the subsequent audit, the published public data still returned 445 Precepts entries and Genesis 1 returned 38 taught-precept records, 14 teaching moments and transcript readings for 31 verses. These are observations of the current feed, not fixed test counts. PR #203 was still an unmerged draft; the original Ask and Precepts routes were unchanged. This confirms missing staged integration, not removal of those public source records. It does not verify any individual's private saved data.

## Verification

At `8975aa8`, the existing app's complete CI browser jobs passed in Chromium, WebKit and Firefox, alongside the app/Worker check jobs, CMS content checks and security checks. These suites cover existing reader/precept/class/Ask/navigation/glass flows; their success is a regression baseline, not proof of full latest-upstream parity or production AI availability. The separate Expo `web` job failed on cross-browser account note sync. Its production deployment jobs were skipped. The scope correction changes documentation and PR status only, so it does not require repeating the completed browser suites.
