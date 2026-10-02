# Changelog

All notable changes to CyberJudah for Telegram (the Mini App at `cyberjudah.io/app`, the bot
[@CyberJudah_bot](https://t.me/CyberJudah_bot) and the Worker behind them) are recorded here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html):

- **Major**: a change that breaks a saved reader's data, a link people share, or the bot's commands.
- **Minor**: new features, or a visible change to how something works.
- **Patch**: fixes only.

Each release is what reached `main` (and from there production) that day. Dates are UTC.
Pull requests are linked as [#n]; changes made before `main` was protected are listed by commit.
Every entry says what changed for the person using the app first, and how second.

**How to add to it:** every pull request adds a line under [Unreleased] in the right section (Added,
Changed, Fixed, Security, Removed, Deprecated). When a release is cut, Unreleased becomes the new
version with its date, the version in `package.json` and `bot/package.json` is raised to match,
and the release is tagged `vX.Y.Z`.

- [Version history](#version-history)
- [Incident and hang-up log](#incident-and-hang-up-log)
- [Known issues](#known-issues)
- [Unreleased](#unreleased)
- Releases: [1.8.1](#181--2026-10-02) · [1.8.0](#180--2026-10-02) · [1.7.0](#170--2026-10-01) ·
  [1.6.0](#160--2026-10-01) · [1.5.0](#150--2026-09-30) · [1.4.0](#140--2026-09-29) ·
  [1.3.0](#130--2026-09-28) · [1.2.0](#120--2026-09-27) · [1.1.0](#110--2026-09-26) ·
  [1.0.0](#100--2026-09-25)

## Version history

| Version | Date | Kind | Headline | Pull requests |
|---|---|---|---|---|
| [1.8.1](#181--2026-10-02) | 2026-10-02 | Patch | The verse-selection sheet matches Bible Strong again | [#76] |
| [1.8.0](#180--2026-10-02) | 2026-10-02 | Minor | Liquid Glass dock you can drag; lists fit their cards | [#70] [#74] [#75] |
| [1.7.0](#170--2026-10-01) | 2026-10-01 | Minor | Precepts in the reader; one colour theme for the whole app | [#69] [#71] [#72] [#73] |
| [1.6.0](#160--2026-10-01) | 2026-10-01 | Minor | Navigation parity, human narrators, ambient sound, People, case studies, the Liquid Glass design system, audit fixes | [#42]–[#68] |
| [1.5.0](#150--2026-09-30) | 2026-09-30 | Minor | Production hardening; Bible Strong's tabs, bar, drawers and search; production at `cyberjudah.io/app` | [#16]–[#41] |
| [1.4.0](#140--2026-09-29) | 2026-09-29 | Minor | Strong's word study and the premium passes | — |
| [1.3.0](#130--2026-09-28) | 2026-09-28 | Minor | Ask as a chat with Claude, Stars, the Apocrypha, People, the Library | [#9]–[#15] |
| [1.2.0](#120--2026-09-27) | 2026-09-27 | Minor | Live classes, precepts under the verse, notes editable from the app | [#8] |
| [1.1.0](#110--2026-09-26) | 2026-09-26 | Minor | The Bible tab as Bible Strong's, search of what was said, Ask CyberJudah | [#1] |
| [1.0.0](#100--2026-09-25) | 2026-09-25 | Major | First release: the Mini App and its bot | — |

## Incident and hang-up log

Everything that broke for people, or stopped a deploy, and what fixed it. Newest first.

| Date | What people saw | Cause | Fix | In |
|---|---|---|---|---|
| 2026-10-02 | The verse-selection sheet grew into a large floating card with a cyan rim, six cramped actions and no close | [#75] changed the sheet's layout and behaviour, not only its material | The sheet restored to Bible Strong's layout, then matched to Bible Strong's iPhone sheet | 1.8.1 |
| 2026-10-02 | After dragging the dock, the next tap on a section did nothing (CI caught it) | The click that ends a drag was swallowed for 80 ms, eating the next real tap | Exactly the drag's own click is swallowed, cleared on the next press | 1.8.0 |
| 2026-10-01 | The nightly and post-deploy embedding failed ("Max context reached 63000 tokens") | A batch of 100 long passages passed bge-m3's 60,000-token limit | Batches also close at 120,000 characters; one still too long is halved until it fits | 1.6.0 |
| 2026-10-01 | Two end-to-end tests failed on `main` after [#67] | Tests still expected the old copy and layout | Tests follow the new copy ("No relations yet") and the plan's button placement | 1.6.0 |
| 2026-10-01 | A live-site probe workflow appeared on `main` | [#22] was merged by mistake | Reverted in [#55] | 1.6.0 |
| 2026-10-01 | A typed search was lost when a Classes filter changed | A filter replaces the address, which gave the screen a new history key | The kept state moves with the replaced address | 1.6.0 |
| 2026-09-30 | A phone's back gesture from the first screen left a black screen until a refresh | A back step walked out of the app's history onto a blank page | A guard entry sits under the app; screens get an error boundary that reloads a stale build once | 1.5.0 |
| 2026-09-30 | Ask: every later question in a chat failed | A history opening on an answer was rejected by the model with a 400 | The history is always well formed (`normalizeHistory`) | 1.5.0 |
| 2026-09-30 | Drawers closed by themselves while the Bible loaded (CI) | Drawers closed on any address change, including the Bible settling its own | They close on a push or back step, not on a replace | 1.5.0 |
| 2026-09-30 | Staging: chapters answered 503 and class media 500 | Cloudflare environments do not inherit `vars`; staging had no `DATA_ORIGIN` | Staging repeats every production setting; a test fails if one goes missing | 1.5.0 |
| 2026-09-30 | Staging deploys failed ("Currently processing a long-running import") | Two runs imported the search index into one database at once | Staging runs queue in one concurrency group | 1.5.0 |
| 2026-09-30 | Blank Mini App when opened from the bot's buttons | The router always took `/app` as its base, but the bot opens the Worker's root | The base is `/app` only when the page was opened under `/app` | 1.5.0 |
| 2026-09-30 | The production deploy failed | The deploy reloaded the search index from a file the data set had split into parts | The reload follows the `search-index/` parts; the health check reads D1's size from metadata | 1.5.0 |
| 2026-09-30 | Blank page at `cyberjudah.io/app` | Built assets were served at the wrong path (module scripts got `index.html`), and the router base ended in a slash | Assets staged at `/` and `/app/`; the trailing slash removed from the base | 1.5.0 |
| 2026-09-30 | Risk: concurrent requests could spend the same balance or slip past a rate limit | Billing and quotas were read-modify-write in KV | Atomic D1 accounts and quotas; a payment can be credited only once | 1.5.0 |
| 2026-09-29 | Search and Ask "not answering" for anyone who had left the app open | Launch data older than three days was refused | Thirty days accepted; each refusal is named (stale, invalid, missing) with a way to recover | 1.4.0 |
| 2026-09-28 | The note editor ran off the screen and Save could not be reached | The screen's entrance animation used a transform, which trapped fixed layers inside the page | The fade is opacity only; the editor mounts at the app's root, above the keyboard | 1.3.0 |
| 2026-09-27 | Long notes failed to save with a bare error | Encoding a long note overflowed the stack | Encoding in chunks (tested on a 150 KB note); errors returned with their reason | 1.2.0 |
| 2026-09-27 | A refused note edit gave no reason | The sheet showed one generic line | The Worker's reason is shown | 1.2.0 |
| 2026-09-26 | Every deploy failed at the check job | Easton's dictionary had been removed from the site repository (404) | The dictionary is kept in this repository | 1.1.0 |
| 2026-09-26 | Deploys failed without saying why | Index creation errors were hidden, and a pipe hid the deploy's own failure | Both stop the job and name the missing token permission | 1.1.0 |
| 2026-09-26 | Loading the recordings' captions failed, and searches stalled while it ran | `wrangler` pointed at a placeholder database id, and file imports lock the database | Loads go through D1's query API; stop cleanly at D1's daily write limit | 1.1.0 |

## Known issues

As of 2026-10-02. Each is tracked here until it is fixed and its fix is listed in a release.

- **Liquid Glass refraction is Chromium-only.** iPhone (Safari and Telegram's iOS WebView) cannot
  refract the page behind the dock, so there it is frosted glass without the lens bend.
- **Dependency alerts on `main`.** GitHub reports 24 Dependabot alerts (1 high, 16 moderate, 7 low).
  Two updates are waiting as pull requests: [#63] (codeql-action 3 → 4) and [#64] (cache 4 → 6).
- **Bible Strong parity, part 2.** The features Bible Strong has that the app does not yet are
  listed in [issue #47].
- **One end-to-end test fails on local runs only.** "An opened class keeps the tab bar" fails
  locally on `main` but passes in CI.
- **Production deploys wait for approval.** Merged changes reach `cyberjudah.io/app` only after
  the production deploy is approved in GitHub.

## [Unreleased]

### In progress (on branches, not on `main`)
- People portraits: per-tribe features, jewellery only where the scripture gives it, a first
  review batch (`claude/people-portraits`).
- Picture administration for admins: add, replace, remove or restore a person's picture from the
  app (`claude/portrait-admin`).

## [1.8.1] — 2026-10-02

### Fixed
- **The verse-selection sheet matches Bible Strong again** ([#76]). [#75] had made it a large
  floating card with a cyan rim, wrapped the actions and dropped its close. It now follows Bible
  Strong's iPhone sheet:
  - a card 8px in from the edges, with 38px corners and a fine hairline;
  - the 56px row of 20px colour swatches;
  - all six actions on one row with no scrolling (48px tiles, 11px labels);
  - the Annotate / Study / Share track, the chosen tab dark and in the accent colour;
  - no title or close: it closes by swiping down, the back button or Escape.
- The material is a dense tint with a light blur, opaque under Reduce Transparency, still under
  Reduce Motion.
- The chosen highlight colour shows a check as well as its ring, and every swatch has a spoken
  name ("Highlight yellow").
- The arrow keys move between the sheet's tabs, and pages not in view are hidden from screen readers.
- A selected verse is centred in the space above the sheet, and unselected verses are no longer
  dimmed twice when focus mode is on.

## [1.8.0] — 2026-10-02

### Added
- **The dock is a drop of Liquid Glass** ([#74]). The current section sits on a glass lens you can
  drag between sections: it lifts, stretches and swells the icons under it, with a haptic on
  each section. On Chromium the lens refracts the page behind it, with a slight colour fringe.

### Changed
- **Compare is now "Precepts side by side"** ([#70]), King James only, so it doesn't suggest
  other translations.
- **The verse-selection sheet in glass** ([#75]); its layout changes were reverted in 1.8.1.

### Fixed
- **List rows fit their cards** ([#70]): counts and chevrons were cut off. The chapter's class
  deck says "chapter".
- **The tap after a drag** on the dock is no longer swallowed ([#74]).

## [1.7.0] — 2026-10-01

### Added
- **Precepts in the reader** ([#69]). Relations under a verse become Precepts, with a mark of two
  pages of Scripture joined, in Bible Strong's inline layout. External links are removed.

### Changed
- **One theme** ([#72]): the whole app wears the Bible reader's day and night colours (Paper,
  Sepia, Nature, Sunset; Dark, Black, Mauve, Night blue).
  - Secondary text is mixed toward the page only as far as it still reads at 4.5:1.
  - Settings offers the same choice as the reader.
  - There's no flash of another theme on first paint.
- **Galleries close from the bottom centre** ([#73]), as the Home drawer does.

### Fixed
- **Link and Relation are their own verse actions again** ([#71]). The rename to Precepts was meant
  only for the label under a verse.

## [1.6.0] — 2026-10-01

### Added
- **Navigation parity with Bible Strong** ([#42], [#45]): pickers, tabs, drawers and audio controls.
  Stop now cancels playback reliably.
- **People as in Bible Strong** ([#46], [#52], [#53]):
  - "In this chapter" avatars, a family graph and a summary card;
  - what the classes taught, and every verse as Scripture cards with "Go to verse";
  - Man or Woman labels.
- **Human King James narrators** ([#48]): the reading follows the verse being read.
  - **Reading follows the passage** ([#52]): the verse being read is picked out and kept in view.
    Scrolling frees the page, and "Back to verse N" returns to it.
- **Ambient sound** ([#50]): music, rain, wind, ocean and fire. Published to R2 with checksums
  ([#57], [#59], [#62]).
- **Every class that read a chapter in the Bible's decks** ([#51]), and readers can request notes
  for a class.
- **Case studies redesigned and linked to people** ([#54]), era by era. References in the writing
  link to the verse.
- **Classes as a feed** ([#56], [#60]):
  - Classes in a feed of posts, with series chips and filters;
  - the Law to study, in cards with its Scriptures;
  - Ask laid out like a chat app, with Scripture in answers linking to the verse.
- **A book's prologue before chapter 1** ([#58]), for Ecclesiasticus.
- **Tapping a passage in class notes plays the recording from that place** ([#61]).
- **The bottom bar follows the reading** ([#49]), like iOS and Instagram.

### Changed
- **Recordings are labelled by their show or series** ([#65]) (Patient Saints Radio, Hammer Time,
  Our Hidden History…), not all as "Sabbath class".
- **Liquid Glass: one design system across every screen** ([#66]):
  - tokens for colour, materials, radii, space, type and motion;
  - at most two frosted surfaces at rest on any route (the reader had five);
  - shared sheet behaviour: focus kept inside, Escape, focus restored, scroll locked;
  - the theme set before first paint, and pinch zoom allowed again.
- **The collapsed bottom bar is one glass circle around its icon** ([#54]).

### Fixed
- **Audit fixes** ([#67]):
  - "Our Hidden History" opens the episodes.
  - Search names a browser outside Telegram, and failures are no longer shown as "0 results".
  - Ask says it answers inside Telegram.
  - Class notes open beside the desktop rail.
  - Headings are no longer misused by list labels.
  - Buttons keep their own colours.
  - People are listed name first.
  - Lexicon previews end on a whole word.
  - Empty states explain the feature.
- **The embedding job stays under bge-m3's token limit** ([#68]).
- **Two end-to-end tests updated** for the audit's new copy and layout ([#68]).
- **A typed Classes search survives a filter change** ([#56]).
- **Stalled downloads in the publish-audio workflow** retry; ambient runs on its own ([#59]).

### Removed
- **The live-site probe workflow**, merged by mistake in [#22] ([#55]).

## [1.5.0] — 2026-09-30

### Added
- **Production setup** ([#16]):
  - a staging environment;
  - a rollback workflow;
  - hourly health checks that page the admins;
  - paced daily broadcasts;
  - the app served from `cyberjudah.io/app`.
- **Read in class under every verse** (`c50f4ab`):
  - Compare;
  - topic threads;
  - the Greek of the Apocrypha from Swete's Septuagint;
  - search inside the Library's books;
  - what's new on Home.
- **Home on Bible Strong's plan** ([#17]): Learn, Study, Meditate, Go further; Lexicon, People and
  Tags screens.
- **Tabs as in Bible Strong** ([#23], [#31]):
  - the Bible is a tab;
  - a tab switcher with tab groups;
  - Ask back on the bottom bar.
- **Bible Strong's app forked and staged at `/app/strong`** ([#24]), loading content only from
  `cyberjudah.io/bs` ([#25]).
- **Class moments** as the reader's inline videos ([#26]), with class pictures after the verses ([#30]).
- **Bible Strong's bottom bar and class deck** ([#35]): the reader chooses up to six buttons; a deck
  of the classes that taught a verse spreads into a gallery and plays the class in place.
- **Home and the menu as Bible Strong's drawers** ([#36]), with its header menu and More cards.
- **Search as Bible Strong's search screen** ([#37]).
- **iPhone glass** ([#39]): the bar, the Bible's header, sheets and menus are frosted; solid
  colours under Reduce Transparency.
- **Ask CyberJudah answers reliably** ([#41]):
  - the conversation survives leaving the screen and reloads;
  - every failure is named, with a retry;
  - saved chats keep each retry and delete once.
- **Search finds what was taught** ([#41]):
  - one screen for what was said in class, the Scripture, the notes and the Law;
  - numbers and the KJV's other spellings of names match;
  - full keyboard control.

### Changed
- **A floating Liquid Glass tab dock** ([#28]).
- **The tab bar stays on class pages** ([#33]): the screen's actions float above it.

### Fixed
- **The selected-verses sheet**: its close button gets its own space beside the colour row (`0520154`).
- **Blank page at `cyberjudah.io/app`** ([#18]).
- **The failed production deploy** ([#20]): the search index loads from its parts. The staging
  workflow and the D1 size check are fixed, and two flaky tests now wait for what they read.
- **Blank Mini App from the bot's buttons** ([#21]).
- **Staging is given every production setting** ([#27]), and staging runs take turns.
- **Back from the first screen stays in the app** ([#38]), and a failed screen is never black.
- **Drawers stay open while a screen settles its address** ([#37]).
- **Ask:** a history opening on an answer no longer breaks the chat ([#41]).

### Security
- **Billing and rate limits** ([#16]):
  - atomic in D1, so concurrent requests can't spend one balance twice;
  - Ask reserves before answering and settles the exact amount;
  - Stars payments are credited once;
  - /support tiers are validated at checkout;
  - spoken verses are capped at 50 new a day per person;
  - `nosniff` on every API response, and no server error text returned to the client.
- **CI actions updated** ([#3], [#4], [#5], [#6]): upload-artifact 7, dependency-review-action 5,
  checkout 7 and setup-node 7.

### Performance
- **Every screen except Home loads on first visit** ([#16]): the first paint fell from 697 KB to
  389 KB (120 KB gzip).

## [1.4.0] — 2026-09-29

### Added
- **Strong's word study** (`802efa1`): a Words tab on every verse, and the word sheet with every
  verse that uses the word.
- **The Library's picture viewer** (`cb67d1b`), with the classes' own words.
- **Premium passes 1–7** (`b3ed6fe`, `64ad62d`, `29dd071`):
  - one scale of radii, type and spacing, and one accent;
  - screens settle in and lists arrive a row at a time, with Reduce Motion honoured;
  - paper and black inks;
  - skeletons and empty states with a way on;
  - class cards with hierarchy, and a Home that greets;
  - header blur, aligned numbers and pull to refresh.
- **Class notes** (`e46f17c`, `7e568e4`): the grip drags the notes full screen; a playing recording
  shrinks to a corner picture.

### Changed
- **Search and Ask say what went wrong** (`ed9ac6d`) and offer ways on.
- **The reader's controls**: precept chips under the verse by default (`37a4874`); the floating
  chapter arrows and play pill as they were (`5edeb77`).

### Fixed
- **Launch data**: up to thirty days accepted, so an app left open no longer loses Search and Ask
  (`ed9ac6d`).

## [1.3.0] — 2026-09-28

### Added
- **Ask CyberJudah as an AI chat** (`0956a05`):
  - Claude researches the library before it answers (`d8d965d`);
  - every conversation is saved to the person (`1ec8368`);
  - the CyberJudah lion is its face (`cf12c34`).
- **An allowance paid in Telegram Stars** (`6d32a5f`), measured per answer.
- **Navigation: five tabs that stay and remember** (`8fd0d9a`).
- **Export a note as a PDF** (`9e36f22`).
- **Edit a note's whole text from the app** (`e786320`). A save never overwrites one made in between.
- **The Bible:**
  - one Precept(s) note under a verse, saying why each precept is there (`4d154d7`, `5e2c2df`,
    `efe9919`);
  - reading progress in the reader and the plan (`6b02a8d`);
  - the Apocrypha in the 1611 order, and Search the Scriptures (`90dab2d`);
  - a link under a verse to each class that read it (`c95460d`);
  - a verse's Comments hold each class's own breakdown (`93a5fd1`), and open the note at that
    passage (`9249f4c`);
  - the Bishops' and Deacons' teaching comes first (`3f2c289`).
- **People**: everyone named in a verse, with a page for each (`d26d0a1`).
- **The Library** (`7918633`, `3d0198e`, `41e0863`): the books the classes read from, page by
  page, with scans, maps, pictures and multi-volume works.

### Changed
- **The app polished to an iOS standard** (`2cda30f`).
- **Every Bible sheet closes** with Telegram's back button, its ✕ or a swipe (`0484dcd`).

### Fixed
- **Screens that no longer fit** (`324ac1a`): the note editor runs off the screen no more.
- **PDF markup is parsed safely**, and entities are decoded once ([#12]).
- **Also taught in**: each note is listed once, only where it cites the verse (`6204bdb`).
- **A class without a note opens on YouTube**, and breakdowns keep their paragraphs (`ef58052`).

### Removed
- **The four-chapter daily reading reminders and Bible tracker** added in [#11] and [#13] were
  retired at the owner's request ([#14], [#15]).

### Security
- **Production security and browser coverage hardened** ([#9]). HTML is sanitised with DOMPurify
  instead of regular expressions ([#10]).

## [1.2.0] — 2026-09-27

### Added
- **Watch the class live** (`a11b96b`): a Live now card on Home opens the stream in the app. A
  class is in the app the hour it is uploaded (`6e69a0d`).
- **Precepts lined up with the verse** (`1a202e0`), and **notes editable from the app** by admins:
  each save is one commit to the cyberjudah repository.
- **Frames of the recordings** (`6723474`, `b77b50a`, `1739a1d`): what was on the screen, in the notes.

### Changed
- **A quieter interface** (`42a13bf`, `cb3401a`, `b91381f`): one type family, and the accent only
  where you tap.

### Fixed
- **Ask keeps the assembly's terms** (IUIC, Bishop Nathanyel) and rejects junk evidence ([#8]).
- **Live**: a stream scheduled for a time already gone is not "starting soon" (`ce6c7c7`).
- **Recordings are matched to their notes** by the site's local thumbnails too (`65af0a5`), and
  thumbnails lose the play badge (`12531b7`).
- **Note edits** say why a save was refused (`a469b61`), name an expired session (`b44cf0f`), and
  save long notes (`815836a`).

## [1.1.0] — 2026-09-26

### Added
- **The Bible tab is Bible Strong's**, ported behaviour for behaviour (`09374fd`):
  - one voice for the whole chapter, and a Voice chip (`81fa6ac`, `7c9e7ac`);
  - study relations and unfolding cross-references (`6c65218`).
- **Search what was said** (`d08a6ff`, `c3c6250`, `56915dd`): word for word, over every
  recording's captions, linking to the published note or the recording.
- **The AI** (`2105898`):
  - ask the teachings, and search by meaning;
  - reading voices, and drafted notes.
- **Ask CyberJudah**:
  - a conversation with the library (`98f3564`);
  - it reasons from the Scripture within the assembly's doctrine (`b3f8ede`);
  - it answers with Claude when the key is set (`ec32b83`);
  - it speaks in its own voice (`0d95b3e`).
- **Home is the front door** (`aa52d98`, `c6e6890`): search the teachings or ask CyberJudah.
- **Classes open like YouTube on a phone** (`a26137a`): the player pinned, the notes in a sheet.
- **Full screen by default** (`360b7a4`), with a real chat layout.
- **Product readiness** ([#1]):
  - security policy, contribution guide and templates;
  - operations runbook and privacy notes;
  - security scanning and dependency updates;
  - browser CI.

### Fixed
- **Ask's evidence** (`19e63f7`, `79b85f6`, `7e98dc0`): scraps of captions are kept out, and a
  reranker orders passages by whether they answer.
- **The embedding job**:
  - retries a Workers AI timeout (`dde5055`);
  - deletes stale vectors a hundred at a time (`ca41326`);
  - embeds from the repository when D1 cannot take more (`8b6242e`).
- **Search reloads** (`0c2e354`, `8c1c206`): a dropped D1 import retries once, and every run
  uploads fresh.
- **The deploy pipeline** (`ce9fdf3`, `95762a9`, `4fd4453`, `e4edbb8`, `c4b59d4`):
  - it creates its own KV namespace, index and bucket;
  - it checks its secrets by name, and fails loudly;
  - Easton's dictionary is kept in the repository.

### Security
- **Future-dated Telegram launch data is rejected** ([#1]).

## [1.0.0] — 2026-09-25

### Added
- **The Mini App and its bot** (`7b5f48b`): the CyberJudah library inside Telegram.
- **Study tools from Bible Strong** (`892c1fb`): highlights, notes, a reading plan, listening,
  offline reading and a dictionary.
- **Study relations and unfolding cross-references** (`6c65218`).

### Removed
- **The WEB parallel text** (`80a779b`): King James only.

[Unreleased]: https://github.com/DevSecObie/cyberjudah-telegram/compare/799f696...HEAD
[1.8.1]: https://github.com/DevSecObie/cyberjudah-telegram/compare/c8d8825...799f696
[1.8.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/a558e8e...c8d8825
[1.7.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/c53c9b0...a558e8e
[1.6.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/689de41...c53c9b0
[1.5.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/7e568e4...689de41
[1.4.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/41e0863...7e568e4
[1.3.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/1739a1d...41e0863
[1.2.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/360b7a4...1739a1d
[1.1.0]: https://github.com/DevSecObie/cyberjudah-telegram/compare/6c65218...360b7a4
[1.0.0]: https://github.com/DevSecObie/cyberjudah-telegram/tree/6c65218
[issue #47]: https://github.com/DevSecObie/cyberjudah-telegram/issues/47
[#1]: https://github.com/DevSecObie/cyberjudah-telegram/pull/1
[#3]: https://github.com/DevSecObie/cyberjudah-telegram/pull/3
[#4]: https://github.com/DevSecObie/cyberjudah-telegram/pull/4
[#5]: https://github.com/DevSecObie/cyberjudah-telegram/pull/5
[#6]: https://github.com/DevSecObie/cyberjudah-telegram/pull/6
[#8]: https://github.com/DevSecObie/cyberjudah-telegram/pull/8
[#9]: https://github.com/DevSecObie/cyberjudah-telegram/pull/9
[#10]: https://github.com/DevSecObie/cyberjudah-telegram/pull/10
[#11]: https://github.com/DevSecObie/cyberjudah-telegram/pull/11
[#12]: https://github.com/DevSecObie/cyberjudah-telegram/pull/12
[#13]: https://github.com/DevSecObie/cyberjudah-telegram/pull/13
[#14]: https://github.com/DevSecObie/cyberjudah-telegram/pull/14
[#15]: https://github.com/DevSecObie/cyberjudah-telegram/pull/15
[#16]: https://github.com/DevSecObie/cyberjudah-telegram/pull/16
[#17]: https://github.com/DevSecObie/cyberjudah-telegram/pull/17
[#18]: https://github.com/DevSecObie/cyberjudah-telegram/pull/18
[#20]: https://github.com/DevSecObie/cyberjudah-telegram/pull/20
[#21]: https://github.com/DevSecObie/cyberjudah-telegram/pull/21
[#22]: https://github.com/DevSecObie/cyberjudah-telegram/pull/22
[#23]: https://github.com/DevSecObie/cyberjudah-telegram/pull/23
[#24]: https://github.com/DevSecObie/cyberjudah-telegram/pull/24
[#25]: https://github.com/DevSecObie/cyberjudah-telegram/pull/25
[#26]: https://github.com/DevSecObie/cyberjudah-telegram/pull/26
[#27]: https://github.com/DevSecObie/cyberjudah-telegram/pull/27
[#28]: https://github.com/DevSecObie/cyberjudah-telegram/pull/28
[#30]: https://github.com/DevSecObie/cyberjudah-telegram/pull/30
[#31]: https://github.com/DevSecObie/cyberjudah-telegram/pull/31
[#33]: https://github.com/DevSecObie/cyberjudah-telegram/pull/33
[#35]: https://github.com/DevSecObie/cyberjudah-telegram/pull/35
[#36]: https://github.com/DevSecObie/cyberjudah-telegram/pull/36
[#37]: https://github.com/DevSecObie/cyberjudah-telegram/pull/37
[#38]: https://github.com/DevSecObie/cyberjudah-telegram/pull/38
[#39]: https://github.com/DevSecObie/cyberjudah-telegram/pull/39
[#41]: https://github.com/DevSecObie/cyberjudah-telegram/pull/41
[#42]: https://github.com/DevSecObie/cyberjudah-telegram/pull/42
[#45]: https://github.com/DevSecObie/cyberjudah-telegram/pull/45
[#46]: https://github.com/DevSecObie/cyberjudah-telegram/pull/46
[#48]: https://github.com/DevSecObie/cyberjudah-telegram/pull/48
[#49]: https://github.com/DevSecObie/cyberjudah-telegram/pull/49
[#50]: https://github.com/DevSecObie/cyberjudah-telegram/pull/50
[#51]: https://github.com/DevSecObie/cyberjudah-telegram/pull/51
[#52]: https://github.com/DevSecObie/cyberjudah-telegram/pull/52
[#53]: https://github.com/DevSecObie/cyberjudah-telegram/pull/53
[#54]: https://github.com/DevSecObie/cyberjudah-telegram/pull/54
[#55]: https://github.com/DevSecObie/cyberjudah-telegram/pull/55
[#56]: https://github.com/DevSecObie/cyberjudah-telegram/pull/56
[#57]: https://github.com/DevSecObie/cyberjudah-telegram/pull/57
[#58]: https://github.com/DevSecObie/cyberjudah-telegram/pull/58
[#59]: https://github.com/DevSecObie/cyberjudah-telegram/pull/59
[#60]: https://github.com/DevSecObie/cyberjudah-telegram/pull/60
[#61]: https://github.com/DevSecObie/cyberjudah-telegram/pull/61
[#62]: https://github.com/DevSecObie/cyberjudah-telegram/pull/62
[#63]: https://github.com/DevSecObie/cyberjudah-telegram/pull/63
[#64]: https://github.com/DevSecObie/cyberjudah-telegram/pull/64
[#65]: https://github.com/DevSecObie/cyberjudah-telegram/pull/65
[#66]: https://github.com/DevSecObie/cyberjudah-telegram/pull/66
[#67]: https://github.com/DevSecObie/cyberjudah-telegram/pull/67
[#68]: https://github.com/DevSecObie/cyberjudah-telegram/pull/68
[#69]: https://github.com/DevSecObie/cyberjudah-telegram/pull/69
[#70]: https://github.com/DevSecObie/cyberjudah-telegram/pull/70
[#71]: https://github.com/DevSecObie/cyberjudah-telegram/pull/71
[#72]: https://github.com/DevSecObie/cyberjudah-telegram/pull/72
[#73]: https://github.com/DevSecObie/cyberjudah-telegram/pull/73
[#74]: https://github.com/DevSecObie/cyberjudah-telegram/pull/74
[#75]: https://github.com/DevSecObie/cyberjudah-telegram/pull/75
[#76]: https://github.com/DevSecObie/cyberjudah-telegram/pull/76
