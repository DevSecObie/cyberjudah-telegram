# Design system: CyberJudah in glass

The app's look and feel. It follows the layering Apple describes for Liquid Glass and applies it to
a web app with CSS. Apple's Liquid Glass is a native material (lensing, adaptive tint, motion-aware
highlights) that SwiftUI, UIKit and AppKit render. Our materials approximate its hierarchy and feel
with `backdrop-filter`, tint, a rim and a highlight. They are not Apple's rendering.

Sources read:

- [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Meet Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)

## What we took from Apple, and how it maps to the web

| Apple's guidance | Here |
| --- | --- |
| Liquid Glass is the functional layer for navigation and controls, floating above content. | Only the header bar and the dock are frosted at rest (`.glass`, the `::before` of `.head`, `.srch__bar`, `.chat2__bar`, `.bs-header`, `.tabs`). |
| Don't use it in the content layer; use standard materials there. | Cards, lists, feeds, scripture and messages are tinted surfaces (`--surface-1`, `--surface-2`) with a fine edge, and no filter. |
| Never glass on glass; use fills and tints on top of glass. | Controls inside the dock and bars use fills (`--fill-*`) and a selected pill, never a second blur. |
| Use it sparingly. | The budget: no more than two frosted surfaces visible at rest. A menu or picker may make a third while it is open. |
| Regular variant for text-heavy components; clear only over rich media with dimming. | Every glass here is the "regular" kind, with a dense tint. Nothing uses a clear variant. |
| Scroll edge effects keep bars legible over scrolling content. | Header glass runs past the bar and fades out over 14px (a mask), with a hairline at the edge. |
| Concentric shapes. | Radii nest (`--r-*`): pill controls inside a pill dock, 22–28px sheets, 18px cards. |
| Sheets are rounder, inset, and more opaque at full height. | Sheets are near-opaque (`--mat-overlay`) over a 60% scrim. They are inset and centred from 680px up. |
| Reduce transparency, increase contrast, reduce motion. | All three follow the system setting. Reduce transparency also has an app switch: **Settings → Reduce transparency**. |
| Selection by more than colour. | The dock's current section has a brighter pill, a glow along its foot and a bolder label. Segments and chips change fill, weight and ink. |

Project choices, not Apple's numbers:

- The ~200ms dock transition.
- The glow under the selected tab.
- The blur radii: 16px on phones, 22px from 900px up.
- The two-surface budget.
- The notification timing: 3.5s, with a visible progress line; errors stay until dismissed.

## Files

`app/src/styles.css` imports, in order:

1. `styles/tokens.css`: every colour, material, radius, space, type size, motion and layer. Dark is the default; `html[data-theme]` holds light and sepia. It also holds the system and app overrides for reduced transparency, increased contrast and missing `backdrop-filter`.
2. `styles/base.css`: the page and canvas, type helpers, focus ring, motion keyframes, reduced motion, forced colours.
3. `styles/materials.css`: the glass recipes and the shell (screen, header bar, dock and desktop rail, page actions, drawers, sheets, notes sheet, notifications, lock screen).
4. `styles/controls.css`: buttons, icon buttons, chips, segmented control, fields, switches, swatches, badges.
5. `styles/content.css`: sections, cards, grouped lists, loading/empty/failed states, avatars, scripture cards, menu cards.
6. `styles/screens/*.css`: one file per area (home, reading, notes, library, search, classes, law, ask, people, switcher).

The Bible tab keeps its own palette (the reader's chosen theme, `--bs-*` in `bible/bible.css`). Inside the tab, the material tokens are redefined on that palette, so its header, menus and sheets are the same materials in the reader's colours. While the Bible is open the dock takes the reader's palette too.

## Tokens (the ones to reach for)

- **Colour:**
  - `--canvas`, `--surface-1`, `--surface-2`, `--fill-1..3`
  - `--text-1` primary, `--text-2` body, `--text-3` secondary, `--text-4` placeholder
  - `--accent`, `--on-accent`
  - `--danger`, `--success`, `--warning`, `--gold`, `--violet`, `--sky`
- **Lines:** `--hairline` (decorative separators), `--control-edge` (a required control boundary, at least 3:1), `--mat-edge` (glass rim).
- **Materials:** `--mat-nav`, `--mat-elevated`, `--mat-overlay`, `--mat-blur`, `--mat-blur-strong`, `--mat-highlight`, `--mat-shadow`, `--mat-selected`, `--mat-glow`.
- **State:** `--state-hover`, `--state-press`, `--state-selected`, `--disabled-opacity`, `--focus-ring`.
- **Shape and space:**
  - `--r-xs..--r-2xl`, `--r-pill`
  - `--sp-1..8`, `--gutter`, `--touch` (44px)
  - `--h-sm/md/lg`
  - `--w-read`, `--w-wide`
- **Type:**
  - `--font-ui`, `--font-read`, `--font-mono`
  - `--fs-caption … --fs-large`
  - `--lh-*`
- **Motion:** `--dur-1..4` (120–380ms), `--ease`, `--ease-spring`, `--ease-exit`.
- **Layers:** `--z-sticky`, `--z-actions`, `--z-dock`, `--z-drawer`, `--z-pip`, `--z-sheet`, `--z-toast`, `--z-lock`.
- **Safe areas and the dock:** `--safe-top`, `--safe-bottom`, `--dock-h`, `--dock-space` (room content keeps clear), `--rail-space` (desktop).

## Contrast (measured on the token values)

All pairs are WCAG AA (4.5:1 text, 3:1 large text and control boundaries):

- `--text-1/2/3` on canvas and both surfaces, in every theme. The lowest is light-theme `--text-3` on `--surface-2`, at 5.86:1.
- `--accent` on both surfaces: 4.93:1 or more in light, 10.9:1 or more in dark.
- `--on-accent` on `--accent`.
- `--control-edge` on the surfaces: 3:1 or more.

The dock and header tints are dense (76–80% of the canvas) so their labels keep at least 4.5:1 even over a bright picture scrolling beneath.

## Routes and states reviewed

Each route was reviewed in the running app at 390px (dark and light) and at 1280px (dark). The checks:

- the blur budget (frosted surfaces counted per viewport);
- horizontal overflow;
- the dock clearing the last card;
- focus visibility;
- reduced motion and reduced transparency.

| Route | Reviewed | Notes |
| --- | --- | --- |
| `/` Home drawer | ✓ | Day's verse card, counts, doors, feed |
| `/classes` | ✓ | Media-first posts; play mark has no filter (was one per post) |
| `/law`, `/law/:part/:section` | ✓ | Grouped lists, law cards, scripture quote in the reading face |
| `/ask` | ✓ | Bar glass, prose answer, composer surface (no third blur), chats and plans sheets |
| `/bible`, `/read/:book/:chapter` | ✓ | Reader header glass; chapter and listen controls unfrosted; menu and picker elevated |
| `/search` | ✓ | Field in the bar, scopes, grouped results, recordings |
| `/people`, `/person/:id` | ✓ | Summary, family graph, sections under a hairline |
| `/cases`, `/cases/:era/:slug` | ✓ | Era lists, charge card, related cards |
| `/note/*`, `/watch/:video` | ✓ | Player, notes sheet, moments, transcript |
| `/more`, `/settings`, `/settings/bar`, `/settings/requests`, `/settings/credits` | ✓ | Grouped rows, switches, segmented theme; new Reduce transparency switch |
| `/plan`, `/history`, `/bookmarks`, `/tags`, `/relations` | ✓ | |
| `/books`, `/books/:slug`, `/books/:slug/:k` | ✓ | Figures, reads, page-by-page |
| `/dictionary`, `/lexicon`, `/topics`, `/topics/:slug`, `/precepts`, `/precepts/:slug`, `/study`, `/encyclopedia`, `/sabbath` | ✓ | |
| `/tabs`, `/new` | ✓ | Switcher cards are surfaces (they had a filter each) |
| Not found (`/person/nobody-here`) | ✓ | Empty state |

| State | Reviewed | Notes |
| --- | --- | --- |
| Sheet open (app sheet, Bible sheet, add relation, verse image) | ✓ | Shared `useModal`: focus in, trapped, Escape, focus restored, page scroll locked |
| Drawers (Home, More) | ✓ | Surface with scrim; no filter while closed |
| Menu / picker (Bible ⋮, book and chapter pickers) | ✓ | Elevated glass, at most a third blur while open |
| Notifications | ✓ | Shared `ToastProvider`: slide and fade, progress line, pause on hover or focus, errors stay, announced |
| Loading, empty, failed, crashed | ✓ | Skeletons keep geometry; failed states carry a danger rule and actions |
| Disabled, pressed, hover, focus | ✓ | Tokens for each; focus ring is the accent at 2px with an offset |
| Reduced motion | ✓ | All movement off; the notification timer still runs |
| Reduced transparency (system or app) | ✓ | Every material opaque, zero filters |
| No `backdrop-filter` | ✓ | Materials fall back to near-opaque tints |
| Increased contrast, forced colours | ✓ | Stronger text and edges; opaque materials; system colours draw edges |

## Validation (this redesign)

- **Blur budget**, counted in the running app as the frosted surfaces visible in the viewport, on all 38 routes:
  - At rest: 2 at most on every route, at 390px dark, 390px light and 1280px dark. Before the redesign it reached 5 in the reader (header, two chapter buttons, the play pill, the dock). Classes added one more per post's play icon.
  - Open states: a sheet or drawer adds none. The Bible ⋮ menu and the book picker add one while open. Reduce transparency leaves 0.
- **Horizontal overflow:** none on any route at 390, 820 or 1280px.
- **Rendered contrast** (the pixels behind the text, with a bright, striped picture scrolled under the glass):
  - Dock labels: lowest 5.61:1 dark and 14.30:1 light.
  - Header title: lowest 11.62:1 dark and 15.07:1 light.
- **Focus:** a sheet takes the focus, Tab stays inside, Escape closes it, and the focus returns to the control that opened it. The Bible tab, which used to remove the focus ring, now shows it.
- **Checks:** `npm run typecheck`, lint, unit tests (9) and the end-to-end suites `telegram.spec` and `reading.spec` (74 tests) pass. The audio specs (`ambient.spec`, `recordings.spec`) fail the same way on unmodified `main` in the development sandbox and are left to CI.
- **Browsers:** Chromium (Playwright) at phone, tablet and desktop sizes, with reduced motion emulated. Not tested: Safari or WebKit, Firefox, Telegram's own webviews, and any physical phone.
