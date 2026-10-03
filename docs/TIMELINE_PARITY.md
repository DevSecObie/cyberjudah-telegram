# Timeline parity with Bible Strong

The reference is the fork at `strong/apps/expo/src/features/timeline` (and its routes under
`strong/apps/expo/app`), run as the staged web build at `cyberjudah.io/app/strong/timeline/en`.
Ours is `app/src/screens/Timeline.tsx`, `app/src/styles/screens/timeline.css` and
`shared/timeline.mjs`. Each row names the reference file it comes from.

Status: ✅ matched · ◐ matched with a stated difference · ✖ not carried (reason given) · — not in
the reference, so not added.

## Checklist (written before the work, from the reference code)

### Chronology and layout
| # | Behaviour | Reference | Before |
|---|---|---|---|
| 1 | Periods in their order, each with its start, end and interval | `events.txt`, `TimelineScreen` | ✅ |
| 2 | Canvas width `|start−end| × 100/interval + 100vw`, height `50 + 24×40 + 200` | `timeline.hooks.ts`, `constants.ts` | ✅ |
| 3 | Event at `yearsToPx(start) + wp(40)`, row at `50 + row×40` | `TimelineEvent.tsx`, `constants.ts` | ✅ |
| 4 | Major event: 60px tall, width from its years (min 200, or 200 when fixed), 140px title block that rides along as it scrolls past, 60px picture at the right | `TimelineEvent.tsx` | ◐ no picture; title block rides over where the picture goes |
| 5 | Minor event: 25px pill, title on a grey tab, date beside it | `TimelineEvent.tsx` | ✅ |
| 6 | Event without details: 60% opacity, not tappable | `TimelineEvent.tsx`, `TimelineResourceBoundary` | ✅ |
| 7 | Date labels: `calculateLabel` (BC, ranges, "(n)" over 50 years, "Future", "After the millennium", "457 BC to 1844") | `constants.ts` | ◐ the 1844 branch missing |
| 8 | Date bar: a mark every interval, `|year|` or "Future" from 2020, stays at the bottom | `Datebar.tsx` | ✅ |
| 9 | Line at 40% of the width; the year under it ("n BC", "Future"); a progress bar | `Line.tsx`, `CurrentYear.tsx`, `timeline.hooks.ts` | ✅ |
| 10 | Line and year tab travel with the canvas when it is pulled past either end (`lineX`) | `timeline.hooks.ts` | ✖ fixed in place |
| 11 | Year bar's chevron buttons sized 30/40/60/60 by width (≤320, <768, <1024, ≥1024) | `CurrentYear.tsx`, `useMediaQueries` | ✖ always 40 |

### Scrolling and gestures
| # | Behaviour | Reference | Before |
|---|---|---|---|
| 12 | Free pan both ways with momentum | `ScrollView.tsx` | ✅ native scroll |
| 13 | Pulling past an end by more than 100px (or a fast fling) opens the neighbouring period | `ScrollView.tsx` | ✅ (100px; a fling past the end does the same with native momentum) |
| 14 | The neighbouring period's title card fades in as the canvas is pulled away | `PrevSectionImage`, `NextSectionImage` | ◐ slides in as a panel, no fade |
| 15 | Entering a period: its title card shows, then the canvas slides in from the side it was entered from (1.5s, then 1s) | `ScrollView.tsx`, `CurrentSectionImage` | ✖ |
| 16 | Entering from the next period lands at the end; otherwise at the start | `ScrollView.tsx` (`entrance`) | ✅ |
| 17 | Chevrons either side of the year open the previous and next period | `CurrentYear.tsx` | ✅ |
| 18 | Zoom | — none in the reference | — not added |
| 19 | Filters | — none in the reference (search only) | — not added |

### Screens, details and navigation
| # | Behaviour | Reference | Before |
|---|---|---|---|
| 20 | Home: header "The Bible Timeline", search, menu (Details, Open in new tab) | `TimelineHomeScreen.tsx` | ✅ |
| 21 | Home: each period as a card (age, title, dates between rules, colour bar) over its picture (card 45% ≤180px × 180, picture 55% × 250) | `TimelineItem.tsx` | ✖ card only, no picture |
| 22 | Home menu: language (fr/en) | `TimelineHomeScreen.tsx` | ✖ English only (the app has no French) |
| 23 | Home details: FAQ about their dating and sources | `TimelineHomeDetailModal.tsx` | ◐ our sources instead (theirs teaches their own reading of the dates) |
| 24 | Period header: back, title, search, menu (Details, Open in new tab) | `TimelineHeader.tsx` | ✅ |
| 25 | Period details: age, TITLE, dates between rules, square picture, colour bar, description, "go further" link | `SectionDetailsModal.tsx` | ◐ no picture; case studies in place of their description; their outside link not carried |
| 26 | Period title card (entrance and either side): age, TITLE, dates, square picture (50vw ≤ 500), colour bar, chevron | `SectionImage.tsx` | ◐ no picture |
| 27 | Event screen: header with title, back, menu (Open in new tab); picture 150×150; title; date; description; verses; images; linked events | `EventScreen`, `TimelineEventDetailView`, `EventDetails`, `EventDetailsMedia` | ◐ no picture; reign and case studies in place of their description; no images carousel |
| 28 | Verses: book name, first three verses, "…", opens the Bible there | `EventDetailVerse.tsx` | ✅ |
| 29 | Linked event opens that event | `EventDetailsMedia.tsx` | ✅ |
| 30 | Missing event: "This event is no longer available." | `TimelineEventDetailView.tsx` | ✅ |
| 31 | Search: header, field "Search for an event in the Bible", 250ms debounce, count, results with a 70×70 picture, title (dates) and two lines | `TimelineSearchScreen.tsx` | ◐ no pictures; count wording differs |
| 32 | Search empty states: "Search the Bible!" before, "No results" after, a spinner while loading | `TimelineSearchScreen.tsx` | ◐ wording differs; data is local, so no loading |
| 33 | Loading and error for the timeline data: "Loading...", unavailable view with Retry | `TimelineResourceBoundary.tsx` | — our data ships with the app; a failed lazy load uses the app's own error boundary |

### State and back
| # | Behaviour | Reference | Before |
|---|---|---|---|
| 34 | Back from an event returns to the period exactly where it was (the period stays mounted under the pushed event) | `TimelineTabScreen.tsx`, stack | ✖ returns to the start of the period |
| 35 | Back from a verse or a case study, then back again, returns to the event, then the period, in place | stack | ✖ as above |
| 36 | Back from a period returns to the periods list where it was | `TimelineTabScreen.tsx` (hardware back) | ◐ list returns to the top |
| 37 | Back from an event returns to the search with its query and results | stack | ✖ query lost |
| 38 | Changing period with the chevrons or a pull replaces the period (back goes to the list, not through every period) | `TimelineTabScreen.tsx` | ✅ |
| 39 | Selection: the event opened is the one focused on return | — the reference has no selection state | — keyboard focus returned to it (platform guidance), nothing visible added |

### Pictures (see the asset list in the pull request)
| # | Placement | Reference | Size and crop |
|---|---|---|---|
| P1 | Period picture | `periods/period-1..13.jpg` via `TimelineItem`, `SectionImage`, `SectionDetailsModal` | 640×800 (4:5); cover in 55% × 250; square 50vw ≤ 500 |
| P2 | Event picture | `events.txt` `image` (biblehistory.com) via `TimelineEvent`, `EventDetails` | 60px × 60 strip at the right; 150×150 |
| P3 | Search result picture | detail `images[0]` via `TimelineSearchScreen` | 70×70 |
| P4 | Event images carousel | detail `images` (biblehistory.com originals) | 80% width square |

## Completed (after the work)

Checked by running both through the same journey (the periods, United Kingdom, Solomon, his verse, back,
back; search "solomon", the event, back): ours in Chromium at iPhone 13 size (390×844), and the
reference build at the same size. Emulation only: no physical iPhone or Android device and no Telegram
client were available in this environment.

| # | Result | Notes |
|---|---|---|
| 1-3, 5, 6, 8, 9 | ✅ | Unchanged; their constants |
| 4 | ✅ | The 60px picture at the right: the person's approved portrait (28 events), else a lettered tile in the period's colour. The title rides up to it |
| 7 | ✅ | "457 BC to 1844" added |
| 10 | ✅ | Line and year tab move with the canvas past either end |
| 11 | ✅ | 30/40/60/60 by the same breakpoints |
| 12, 13 | ◐ | Native scrolling, with the 100px threshold to open a neighbour (scrollend). Native scrolling has no rubber-band past the end on desktop browsers; the room either side stands in for it |
| 14 | ✅ | The neighbour's title card fades in behind as the canvas is pulled away |
| 15 | ✅ | Title card for 1.5s, then the canvas slides in for 1s from the side it was entered from; at once with reduced motion, and never on coming back |
| 16, 17, 20, 24, 28-30 | ✅ | |
| 18, 19 | — | No zoom and no filters in the reference: none added |
| 21 | ✅ | Card over picture, their proportions; two periods (Patriarchs, Israel in Egypt) show the period's colour until their pictures are settled (docs/AVATARS.md 9.4) |
| 22 | ✖ | English only |
| 23 | ◐ | Our sources, not their FAQ |
| 25, 26 | ◐ | With the picture now; case studies in place of their description; their outside link not carried |
| 27 | ◐ | With the 150px portrait; reign and case studies in place of their description; no images carousel (their pictures are licensed stock) |
| 31, 32 | ◐ | In the main search's field and list (owner's direction: every search matches the main search): words kept in the address, recent searches, matched words lit, the keyboard throughout; the 70px portrait where there is one |
| 33 | — | Data ships with the app |
| 34, 35 | ✅ | Back from an event, and from a verse then the event, puts the canvas exactly where it was (same scroll, same year) and focuses the event opened. Before: back to the start of the period |
| 36 | ✅ | The periods list keeps its scroll |
| 37 | ✅ | The search keeps its words and results. Before: lost |
| 38, 39 | ✅ | |
| P1 | ◐ | 10 of 12 periods with Higgsfield pictures (docs/AVATARS.md 9.5) |
| P2, P3 | ◐ | Approved People portraits only (28 events) |
| P4 | ✖ | Not carried (licensed stock) |
