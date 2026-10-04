# Changelog

Product-facing changes to CyberJudah for Telegram: the Mini App at `cyberjudah.io/app`, the bot
[@CyberJudah_bot](https://t.me/CyberJudah_bot) and the Worker behind them. Outages, failed deploys
and their fixes are in [docs/INCIDENTS.md](docs/INCIDENTS.md); how a release is cut is in
[CONTRIBUTING.md](CONTRIBUTING.md#releases).

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Versions will
follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) from the first tagged
release:

- **Major**: a change to the public contract that breaks it: a reader's saved data, a link people
  share (`/app/...` paths and `startapp` deep links), the bot's commands, or the API the app calls.
- **Minor**: a new capability, or a visible change in how one works, that keeps the contract.
- **Patch**: fixes only.

**No version has been released yet.** There are no tags; `package.json` reads `1.0.0`, which has
not been tagged. Everything below "Unreleased" is a **retrospective grouping** of what reached
production, one group per UTC day, ending at that day's last successful production deploy. The
groups are not versions and must not be cited as releases. A proposed first tag is in the pull
request that introduced this file ([#77]).

## [Unreleased]

Merged to `main` and not yet in a tagged release. Production currently runs `861242f`
([deploy run 37060784554](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/37060784554)).

### Added
- Study resources can be installed, removed and rolled back for offline reading. The four approved editions preserve source notices, and Strong’s and Ask use the reader’s selected release.
- Ask names its existing Strong’s API fallback when an installed release is unavailable; edition searches first match all query words before falling back to the rarest word.
- Ask's free answers now run on Llama 3.1 8B inside Cloudflare's free tier, answering from the retrieved passages in one call, and pause for the day before they could ever cost the project anything.

### Fixed
- The Home screen's featured class label now follows the calendar: a class dated in the current Sabbath-to-Sabbath week reads "This week's class", last week's reads "Last week's class", and older classes show just their date.
- The YouTube-outage fallback now reads the channel page's current card layout (`lockupViewModel`): YouTube changed its markup after the #122 hotfix shipped, so the fallback silently found nothing. Classes again appear as "Notes coming soon" while the RSS feed is down.
- Answering no longer scans the whole rate-limit table on every request; old rows are swept once an hour instead.
- A retried Telegram update can no longer run a bot command twice.

### Added
- The Final Captivity, the twelve tribes: 41 events of the North American Indians (Gad) and the
  Seminoles (Reuben), from the Pequot War (1637) to today, from Wikipedia, the National Park
  Service and the classes. Each event names the tribes it concerns; an event may stand on its
  documented sources alone; an outside charge can be answered from the KJV and the Apocrypha
  ("What the scriptures say"); and a new period, Unto This Day (2003 to today).
- Ask CyberJudah answers from the whole app: Easton's Bible Dictionary and Strong's, a person's
  whole entry in People (family, tribe, picture), a verse's study (the classes and notes that read
  it, its precepts, cross-references), the Law handbook, the precept topics and the Timeline (with
  the classes' own words and sources), each with its in-app link; and it can show the app's own
  pictures in an answer (only the app's, never another site's).
- Ask CyberJudah can read approved outside sources (the owner's whitelist: israelunite.org,
  Wikipedia, archive.org, Project Gutenberg, the Library of Congress and others, editable by an
  admin), after the app and the classes, cited by number and opened in the browser; and it covers
  the Apocrypha (its text, its verses' study, and its people through the dictionary and approved
  sources until People has them).
- When YouTube's feed is having trouble, the Classes screen says so: a dismissible notice
  explains that new uploads aren't reaching the app, instead of silently showing nothing new.
  Everything already in the app keeps working; the notice clears itself when the feed recovers.
- Ask CyberJudah is pay as you go, at cost, with the balance in dollars: "$4.82 left" at the
  top, and under each answer what it cost ("$0.05", or "<$0.01"), at the model's own price.
  CyberJudah makes no profit. Top-ups of $1, $5 and $20 are bought with Telegram Stars; the
  sheet shows each one's Stars and why a dollar costs about 77 of them (Telegram's and the app
  store's share). A usage history lists each answer and top-up. Dearer models ask before an
  answer that may cost more than $0.25, and with too little balance Ask offers the free model,
  which stays free for everyone.
- No top-ups on the Sabbath, feast days and New Moons: from full dark the evening before to full
  dark at the day's end, wherever the reader is, the top-up buttons say when they open again,
  and Telegram's checkout is refused. A balance already held can still be used. The feast days
  and New Moons come from the IUIC calendar, refreshed weekly as a pull request to approve.
- An opt-in reminder to top up before the Sabbath and feast days: a Telegram message at midday
  the day before, only when the balance is under $1.
- Admins can change a photo from the app: a leader's portrait, a Timeline period's cover or an
  event's picture. Choose a photo, drag and zoom it in the frame, Save; everyone sees it straight
  away, and Remove photo brings back the app's own.
- The Bible Timeline's last age, **The Final Captivity**: five periods from the first ships (1441)
  to Israel United in Christ today, 161 events so far, more being added as each is checked. Each
  event keeps apart the documented history (with its sources), quotes from the classes (each linked to the
  class or episode at the moment it was taught) and the Scriptures read with it; where sources
  disagree, both are shown. Sources reviewed through 3 October 2026.
- The Bible Timeline moves as Bible Strong's does: a period opens on its title card before the
  canvas slides in, the line and year travel with the canvas past either end, the next period's
  card fades in behind, and back from an event, a verse or a case study returns to the same place.
  Its periods and events now have pictures: our own period paintings and the approved People
  portraits. Its search works like the main search, and keeps its words when you come back.
- Ask CyberJudah as the app's assistant: it answers questions about the app from the app's own
  list of screens, with links that open in place; finds people and case studies; finds and reopens
  your saved chats; reads your reading reminder; and proposes changes to it as a card you Confirm
  or Cancel. Nothing changes until you confirm, and the card says what was done. Built to the
  Claude docs' tool-use guidance: cached instructions, streamed and checked tool input, and
  refusals and cut-off answers said plainly. While it works, Ask shows a line suited to the
  question, drawn from the King James words the assembly reads (serious for doctrine, the law and
  judgment; lighter for the app, the time and short follow-ups).
- A backup for Ask CyberJudah: if Claude is overloaded, rate limited, down, or its key is refused,
  Workers AI answers from the passages already found, says it is the backup, and does not charge.
  Workers AI calls now go through Cloudflare AI Gateway (`default`) for logs and analytics; Claude
  goes through it too once the `CF_AIG_TOKEN` secret is added.
- Ask's allowance works as the large AI apps' do: with the day's in-depth answers used, Ask
  goes on with shorter answers from the library at no charge instead of stopping; an answer that
  fails on our side is no longer charged; and the meter says when answers come back, in the
  reader's own time.
- Ask's allowance is on in production: about 2 in-depth answers a day free per reader, then up to
  25 shorter answers until the next day, or a plan or top-up in Stars. Admins are not limited.
- Privacy, to Telegram's Bot Developer Terms and Standard Bot Privacy Policy and Apple's 5.1.1 and
  5.1.2 (docs/PRIVACY.md): records about people are filed under a coded ID, never the Telegram ID,
  and encrypted at rest with a key kept apart; saved chats go after 180 days unused; the AI Gateway
  keeps no question or answer text; Ask asks before a question first goes to an AI provider (the
  server refuses otherwise); a Privacy screen and `/privacy`, Download my data (`/mydata`) and
  Delete my data (`/deletemydata`); `/paysupport` for Stars payments.
- Readers choose the model for Ask: every text model in Cloudflare's catalog (92: Claude, OpenAI,
  Google, xAI, DeepSeek, Qwen, Kimi, MiniMax and the Cloudflare-hosted ones), each researching
  the library with the same tools and sources and charged at its own price. A free model, GLM 5.3
  Flash, is always there, never charged, and takes over when the paid answers are used up.
- Plans and top-ups are sold at cost: every Star a reader pays buys Claude use at Claude's own
  price, with no margin.
- Claude can be paid through Cloudflare (Unified Billing, from the account's AI Gateway credits)
  instead of an Anthropic key; production and staging are set to it (`CLAUDE_BILLING`). When
  the credits run out, Ask answers with the backup.
- Reading reminders ([issue #47]): opt-in and off by default, at a quarter-hour time in the
  reader's own time zone, by Telegram (the bot), Web Push (cyberjudah.io/app in up to ten
  browsers) or both. The reminder names today's plan portion, or the last chapter read, with
  Open (the chapter) and Done (marks it read); Done in either place clears both. Pause (until
  tomorrow, a week, a date, or until resumed) and Stop work from the app, the reminder, or `/stop`
  in the bot. An expired push subscription (404/410) falls back to Telegram with a notice; a push
  key error alerts the admins and drops nothing. Every reminder endpoint is rate limited, and an
  unused browser is forgotten after 180 days or on request. Admins see reminder counts by channel.
  This reverses the removal of the earlier reading tracker and reminders on 2026-09-28 ([#14],
  [#15]), on the owner's decision recorded in [issue #47]. Push needs three new Worker secrets
  (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); until they are added, push is shown
  as not set up and Telegram reminders work. The Worker's cron now also runs at :15, :30 and :45
  for reminders; the hourly jobs still run only on the hour. If the browser's permission prompt is
  closed without an answer, push is not called blocked; choosing it again asks again.
- The Bible Timeline ([issue #47], item 2), ported from Bible Strong's: its periods, each event
  placed by year on its canvas, the date bar, the line with the year under it, the periods
  either side, search, and event pages. The years are Bible Strong's (their history only: their
  descriptions, articles, pictures and prophetic interpretation, including the "Revelation
  Prophecies" period and 20 prophecy events, are left out). Events open to our case studies on
  them (by exact name only), their verses in the KJV, and for 25 kings the reign from *Who's Who
  in the Bible*. Regenerate the data with `node app/scripts/timeline-data.mjs <cases>`.

### Fixed
- Upload notices refresh while the app is open, clear when the feed recovers, and can announce a later outage after dismissal. Their dismiss button has a full 44px touch target.
- Keep uploaded classes marked “Notes coming soon” visible during YouTube RSS outages, using channel-page fallback and retained recent recordings.
- The book picker brings the current book into view after its animated panel mounts, including when the browser delays the opening snapshot.

- Navigation materials share opaque accessibility fallbacks; menus avoid stacked glass, while content sheets and media controls keep their text legible.
- Keep a reader's chosen keyboard focus when the Search screen finishes loading late, while retaining initial search-field focus on ordinary navigation.
- Keep the audio reading’s return control visible when scrolling changes the Bible header before its pending position update.
- The glass dock keeps its labels crisp in every browser, with one material behind the controls,
  a gentle selection response and tint that preserves contrast in every reader palette. Ordinary
  taps and canceled drags work reliably. Reduce Transparency also makes the Bible dock opaque,
  and Reduce Motion stops selection and icon scaling.
- Privacy deletion reports incomplete cleanup when storage fails and can be retried; data exports no longer silently omit unavailable billing records.
- Ask CyberJudah: an answer is finished and saved even if you leave mid-answer, and coming back
  (a refresh, the app reopened, the connection back) waits for it instead of calling it lost; an
  answer still arriving for a chat you left never appears in the next one; a question typed while
  an answer is coming is kept; tapping Send after typing no longer misses; conversations on a shared
  device are kept per account; links in answers lead only inside the app; and if search by meaning
  is unavailable, Ask answers from the keyword search.

### Changed
- Tabs now collapse into their preview cards and expand back with consistent motion, preserve reading position, and return to the selected tab with Back; preview cards fit beside the desktop sidebar.
- Keep reader context readable and gallery panels opaque across themes; document the Liquid Glass adoption review.

- Reduced repeated palette calculations and dock style updates; browser checks now cover glass budgets and large-text label containment in Chromium, WebKit and Firefox.

- Local app icons now include layered lion artwork, full-bleed light/dark squares, PWA maskable safe-zone exports and a monochrome variant.

- Search stays last in its own round dock control without rewriting saved button choices; the phone search field follows the keyboard viewport above the dock, and touch actions activate once after scrolling or dragging.
- Increased contrast now has explicit light, dark and sepia palettes, including Bible controls; secondary text, status colors and Home widgets keep readable contrast on their surfaces.
- Lists and settings use roomier grouped rows with shared rounded corners. Section headings keep normal title case, and related settings have accessible form groups.
- The Bible Timeline shows 45 more portraits (83 in all): picture rounds 2–4 (Solomon recropped, the
  Red Sea, Bethel, Christ, prophets, kings, apostles, Reformation figures and Jacob), with their
  sources in docs/AVATARS.md.
- Auto and half sheets float inside the safe edges with shared rounded corners; full sheets expand to the phone edges. On larger screens, action lists open beside their control and leave the page usable.

- Unify menu action icons and toolbar groups, add desktop tooltips and keyboard menu navigation, and animate popovers from their controls with accessible fallbacks.
- Adapt the dock into a sidebar from 900px, reserve content width, and keep navigation reachable after scrolling or resizing, including native document scrolling in WebKit.

- Unify Liquid Glass control styles, capsule sizing, nested radii and accessible large-text behavior, including lifted knobs, shared header fades, enlarged segmented labels and touch scrolling for overflowing navigation rails.
- The monthly Ask plan, its bonus and the free daily allowance for paid models are gone. Any
  credit or plan allowance left carries over to the balance at its exact worth; a plan that
  renews adds its Stars to the balance and is then cancelled.
- Ask CyberJudah: the model is chosen at the top, under the title (tap it to change), and the
  allowance moves to the line under the question box. An admin starts on Claude Opus 5.5
  (`CLAUDE_MODEL_ADMIN`) and every other reader on Claude Sonnet 5 (`CLAUDE_MODEL`); a model a
  reader picks is kept as before.
- This changelog, the incident log ([docs/INCIDENTS.md](docs/INCIDENTS.md)) and the release rules;
  a pull-request check asks every change for a changelog line or a reason it needs none ([#77]).

## Known issues

| Issue | Owner (role) | Tracking | Impact | Workaround | Next action |
|---|---|---|---|---|---|
| Search may fail during each production deploy while the search index is re-imported | Maintainer (deploy pipeline) | None yet | Search errors for the length of the import (not measured) | None | Decide whether to skip the import when the index is unchanged |
| Precept-pass fixes requested with `@codex` never arrived (Codex was not connected until 2026-10-02) | Repository owner | cyberjudah [#14](https://github.com/DevSecObie/cyberjudah/pull/14), [#15](https://github.com/DevSecObie/cyberjudah/pull/15) | Two passes cannot merge | The owner applies the listed fixes | Fixes re-requested on 2026-10-02; review the new commits, then merge |
| Native Liquid Glass rendering is unavailable inside the web app | Front end | [Design system](docs/DESIGN_SYSTEM.md#dock-material-and-interaction-correction) | The dock uses a consistent CSS material; native lensing and system morphing require a native client | Web material with accessible fallbacks | Verify the updated dock on physical iOS Telegram and macOS Safari |
| Bible Strong features not yet in the app | Product owner | [issue #47] | Listed in the issue | Not applicable | Classify each item |

## Production history (retrospective, untagged)

### 2026-10-02: production deploy `861242f`

Deployed 2026-10-02T20:49Z by [deploy run 37060784554](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/37060784554); commits [`f55751c…861242f`](https://github.com/DevSecObie/cyberjudah-telegram/compare/f55751c...861242f). Untagged. The day's first deploy, `799f696` at 03:51Z ([run 36961422040](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36961422040)), carried [#70], [#73], [#74], [#75] and [#76]; the later ones carried [#78], [#80], [#81] and [#84], with test and CI changes ([#63], [#64], [#79], [#83]).

#### Added
- **The dock is a drop of Liquid Glass** ([#74]). The current section sits on a glass lens you can
  drag between sections: it lifts, stretches and swells the icons under it, with a haptic on
  each section. On Chromium the lens refracts the page behind it, with a slight colour fringe.

#### Changed
- **Compare is now "Precepts side by side"** ([#70]), King James only, so it doesn't suggest
  other translations.
- **Galleries close from the bottom centre** ([#73]), as the Home drawer does.

#### Fixed
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
- **The verse-selection sheet was oversized from 02:51 to 03:51 UTC** ([#75]): it became a large floating card with a cyan rim and wrapped actions. [#76], in the same day's last deploy, restored Bible Strong's layout (see the first entry).
- **List rows fit their cards** ([#70]): counts and chevrons were cut off. The chapter's class
  deck says "chapter".
- **The tap after a drag** on the dock is no longer swallowed ([#74]).
- **No cyan ring round the verse-selection sheet** ([#84]). It appeared whenever the sheet opened;
  the sheet's own controls keep their focus rings, now drawn inside them instead of clipped at
  the edge. The tabs reach a 48px touch target with the same look, Home and End go to the first
  and last tab, and the dock can't be reached by Tab while the sheet covers it.
- **A deploy no longer fails when the search import is busy** ([#78]): it waits for the import
  already running instead of failing after one 15-second retry.

#### Security
- Dependency updates with no change to the app: undici 7.29.1 through wrangler 4.147.0 ([#80]),
  and 14 advisories in the Bible Strong fork's lockfile ([#81]).

### 2026-10-01: production deploy `f55751c`

Deployed 2026-10-01T21:05Z by [deploy run 36916930059](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36916930059); commits [`689de41…f55751c`](https://github.com/DevSecObie/cyberjudah-telegram/compare/689de41...f55751c). Untagged.

#### Added
- **Precepts in the reader** ([#69]): the row under a verse labels what a class lined up with it as Precepts, with a mark of two pages of Scripture joined, in Bible Strong's inline layout.
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

#### Changed
- **One theme** ([#72]): the whole app wears the Bible reader's day and night colours (Paper,
  Sepia, Nature, Sunset; Dark, Black, Mauve, Night blue).
  - Secondary text is mixed toward the page only as far as it still reads at 4.5:1.
  - Settings offers the same choice as the reader.
  - There's no flash of another theme on first paint.
- **Recordings are labelled by their show or series** ([#65]) (Patient Saints Radio, Hammer Time,
  Our Hidden History…), not all as "Sabbath class".
- **Liquid Glass: one design system across every screen** ([#66]):
  - tokens for colour, materials, radii, space, type and motion;
  - at most two frosted surfaces at rest on any route (the reader had five);
  - shared sheet behaviour: focus kept inside, Escape, focus restored, scroll locked;
  - the theme set before first paint, and pinch zoom allowed again.
- **The collapsed bottom bar is one glass circle around its icon** ([#54]).

#### Fixed
- **Link and Relation are their own verse actions again** ([#71]). The rename to Precepts was meant
  only for the label under a verse.
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
- **A typed Classes search survives a filter change** ([#56]).

### 2026-09-30: production deploy `689de41`

Deployed 2026-09-30T23:57Z by [deploy run 36792258330](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36792258330); commits [`7e568e4…689de41`](https://github.com/DevSecObie/cyberjudah-telegram/compare/7e568e4...689de41). Untagged.

#### Added
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

#### Changed
- **A floating Liquid Glass tab dock** ([#28]).
- **The tab bar stays on class pages** ([#33]): the screen's actions float above it.

#### Fixed
- **The selected-verses sheet**: its close button gets its own space beside the colour row (`0520154`).
- **Blank page at `cyberjudah.io/app`** ([#18]).
- **Blank Mini App from the bot's buttons** ([#21]).
- **Back from the first screen stays in the app** ([#38]), and a failed screen is never black.
- **Drawers stay open while a screen settles its address** ([#37]).
- **Ask:** a history opening on an answer no longer breaks the chat ([#41]).

#### Security
- **Billing and rate limits** ([#16]):
  - atomic in D1, so concurrent requests can't spend one balance twice;
  - Ask reserves before answering and settles the exact amount;
  - Stars payments are credited once;
  - /support tiers are validated at checkout;
  - spoken verses are capped at 50 new a day per person;
  - `nosniff` on every API response, and no server error text returned to the client.

#### Performance
- **Every screen except Home loads on first visit** ([#16]): the first paint fell from 697 KB to
  389 KB (120 KB gzip).

### 2026-09-29: production deploy `7e568e4`

Deployed 2026-09-29T23:01Z by [deploy run 36642791665](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36642791665); commits [`41e0863…7e568e4`](https://github.com/DevSecObie/cyberjudah-telegram/compare/41e0863...7e568e4). Untagged.

#### Added
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

#### Changed
- **Search and Ask say what went wrong** (`ed9ac6d`) and offer ways on.
- **The reader's controls**: precept chips under the verse by default (`37a4874`); the floating
  chapter arrows and play pill as they were (`5edeb77`).

#### Fixed
- **Launch data**: up to thirty days accepted, so an app left open no longer loses Search and Ask
  (`ed9ac6d`).

### 2026-09-28: production deploy `41e0863`

Deployed 2026-09-28T23:22Z by [deploy run 36497486971](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36497486971); commits [`1739a1d…41e0863`](https://github.com/DevSecObie/cyberjudah-telegram/compare/1739a1d...41e0863). Untagged.

#### Added
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

#### Changed
- **The app polished to an iOS standard** (`2cda30f`).
- **Every Bible sheet closes** with Telegram's back button, its ✕ or a swipe (`0484dcd`).

#### Fixed
- **Screens that no longer fit** (`324ac1a`): the note editor runs off the screen no more.
- **PDF markup is parsed safely**, and entities are decoded once ([#12]).
- **Also taught in**: each note is listed once, only where it cites the verse (`6204bdb`).
- **A class without a note opens on YouTube**, and breakdowns keep their paragraphs (`ef58052`).

#### Removed
- **The four-chapter daily reading reminders and Bible tracker** added in [#11] and [#13] were
  retired at the owner's request ([#14], [#15]).

#### Security
- **Production security and browser coverage hardened** ([#9]). HTML is sanitised with DOMPurify
  instead of regular expressions ([#10]).

### 2026-09-27: production deploy `1739a1d`

Deployed 2026-09-27T08:31Z by [deploy run 36306399441](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36306399441); commits [`360b7a4…1739a1d`](https://github.com/DevSecObie/cyberjudah-telegram/compare/360b7a4...1739a1d). Untagged.

#### Added
- **Watch the class live** (`a11b96b`): a Live now card on Home opens the stream in the app. A
  class is in the app the hour it is uploaded (`6e69a0d`).
- **Precepts lined up with the verse** (`1a202e0`), and **notes editable from the app** by admins:
  each save is one commit to the cyberjudah repository.
- **Frames of the recordings** (`6723474`, `b77b50a`, `1739a1d`): what was on the screen, in the notes.

#### Changed
- **A quieter interface** (`42a13bf`, `cb3401a`, `b91381f`): one type family, and the accent only
  where you tap.

#### Fixed
- **Ask keeps the assembly's terms** (IUIC, Bishop Nathanyel) and rejects junk evidence ([#8]).
- **Live**: a stream scheduled for a time already gone is not "starting soon" (`ce6c7c7`).
- **Recordings are matched to their notes** by the site's local thumbnails too (`65af0a5`), and
  thumbnails lose the play badge (`12531b7`).
- **Note edits** say why a save was refused (`a469b61`), name an expired session (`b44cf0f`), and
  save long notes (`815836a`).

### 2026-09-26: production deploy `360b7a4`

Deployed 2026-09-26T23:37Z by [deploy run 36279966157](https://github.com/DevSecObie/cyberjudah-telegram/actions/runs/36279966157); commits [up to `360b7a4`](https://github.com/DevSecObie/cyberjudah-telegram/commits/360b7a4). Untagged.

#### Added
- **The Mini App and its bot** (`7b5f48b`): the CyberJudah library inside Telegram.
- **Study tools from Bible Strong** (`892c1fb`): highlights, notes, a reading plan, listening,
  offline reading and a dictionary.
- **Study relations and unfolding cross-references** (`6c65218`).
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

#### Fixed
- **Ask's evidence** (`19e63f7`, `79b85f6`, `7e98dc0`): scraps of captions are kept out, and a
  reranker orders passages by whether they answer.

#### Removed
- **The WEB parallel text** (`80a779b`): King James only.

#### Security
- **Future-dated Telegram launch data is rejected** ([#1]).

[Unreleased]: https://github.com/DevSecObie/cyberjudah-telegram/compare/799f696...HEAD
[issue #47]: https://github.com/DevSecObie/cyberjudah-telegram/issues/47
[#1]: https://github.com/DevSecObie/cyberjudah-telegram/pull/1
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
[#21]: https://github.com/DevSecObie/cyberjudah-telegram/pull/21
[#23]: https://github.com/DevSecObie/cyberjudah-telegram/pull/23
[#24]: https://github.com/DevSecObie/cyberjudah-telegram/pull/24
[#25]: https://github.com/DevSecObie/cyberjudah-telegram/pull/25
[#26]: https://github.com/DevSecObie/cyberjudah-telegram/pull/26
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
[#56]: https://github.com/DevSecObie/cyberjudah-telegram/pull/56
[#57]: https://github.com/DevSecObie/cyberjudah-telegram/pull/57
[#58]: https://github.com/DevSecObie/cyberjudah-telegram/pull/58
[#59]: https://github.com/DevSecObie/cyberjudah-telegram/pull/59
[#60]: https://github.com/DevSecObie/cyberjudah-telegram/pull/60
[#61]: https://github.com/DevSecObie/cyberjudah-telegram/pull/61
[#62]: https://github.com/DevSecObie/cyberjudah-telegram/pull/62
[#65]: https://github.com/DevSecObie/cyberjudah-telegram/pull/65
[#66]: https://github.com/DevSecObie/cyberjudah-telegram/pull/66
[#67]: https://github.com/DevSecObie/cyberjudah-telegram/pull/67
[#69]: https://github.com/DevSecObie/cyberjudah-telegram/pull/69
[#70]: https://github.com/DevSecObie/cyberjudah-telegram/pull/70
[#71]: https://github.com/DevSecObie/cyberjudah-telegram/pull/71
[#72]: https://github.com/DevSecObie/cyberjudah-telegram/pull/72
[#73]: https://github.com/DevSecObie/cyberjudah-telegram/pull/73
[#74]: https://github.com/DevSecObie/cyberjudah-telegram/pull/74
[#75]: https://github.com/DevSecObie/cyberjudah-telegram/pull/75
[#76]: https://github.com/DevSecObie/cyberjudah-telegram/pull/76
[#77]: https://github.com/DevSecObie/cyberjudah-telegram/pull/77
[#78]: https://github.com/DevSecObie/cyberjudah-telegram/pull/78
[#83]: https://github.com/DevSecObie/cyberjudah-telegram/pull/83
[#79]: https://github.com/DevSecObie/cyberjudah-telegram/pull/79
[#64]: https://github.com/DevSecObie/cyberjudah-telegram/pull/64
[#63]: https://github.com/DevSecObie/cyberjudah-telegram/pull/63
[#80]: https://github.com/DevSecObie/cyberjudah-telegram/pull/80
[#81]: https://github.com/DevSecObie/cyberjudah-telegram/pull/81
[#84]: https://github.com/DevSecObie/cyberjudah-telegram/pull/84
