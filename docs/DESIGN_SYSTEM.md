# Design system: CyberJudah in glass

The app's look and feel. It follows the layering Apple describes for Liquid Glass and applies it to
a web app with CSS. Apple's Liquid Glass is a native material (lensing, adaptive tint, motion-aware
highlights) that SwiftUI, UIKit and AppKit render. Our materials approximate its hierarchy and feel
with one `backdrop-filter` per navigation surface, palette-aware tint, a rim and a press highlight. They are not Apple's rendering.

Apple references used by this design system:

- [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass)
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
- [HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Meet Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Applying Liquid Glass to custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)

## What we took from Apple, and how it maps to the web

| Apple's guidance | Here |
| --- | --- |
| Liquid Glass is the functional layer for navigation and controls, floating above content. | Only the header bar and the dock are frosted at rest (`.glass`, the `::before` of `.head`, `.srch__bar`, `.chat2__bar`, `.bs-header::before`, `.tabs`). |
| Don't use it in the content layer; use standard materials there. | Cards, lists, feeds, scripture and messages are tinted surfaces (`--surface-1`, `--surface-2`) with a fine edge, and no filter. |
| Avoid layering glass on glass; use fills and tints within one surface. | Controls inside the dock and bars use fills (`--fill-*`) and a selected pill, never a second blur. |
| Use it sparingly. | The budget: no more than two frosted surfaces visible at rest. A menu or picker may make a third while it is open. |
| Regular variant for text-heavy components; clear over rich media, with dimming when needed. | The CSS material approximates the regular variant with a legible tint. It does not implement Apple’s native regular or clear variants. |
| Scroll edge effects keep bars legible over scrolling content. | Header glass runs past the bar and fades out over 14px (a mask), with a hairline at the edge. |
| Concentric shapes. | Radii nest (`--r-*`): pill controls inside a pill dock, 22–28px sheets, 18px cards. |
| Sheets are rounder, inset, and more opaque at full height. | Content sheets are opaque (`--mat-overlay`) over a dimming scrim. They are inset and centred from 680px up. |
| Reduce transparency, increase contrast, reduce motion. | All three follow the system setting; missing backdrop support and forced colors also disable filtering. Reduce transparency also has an app switch: **Settings → Reduce transparency**. |
| Selection by more than colour. | The dock's current section has a filled pill and a bolder label; increased contrast adds an outline. Segments and chips change fill, weight and ink. |

Project choices, not Apple's numbers:

- The ~200ms dock transition.
- A restrained press/drag response (up to 6% icon growth), with the labels always above the material.
- The blur radii: 16px on phones, 22px from 900px up.
- The palette-based tint densities (80% or 92%); Apple’s native regular material instead adapts background luminosity dynamically.
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
- **Materials:** `--mat-nav`, `--mat-density`, `--mat-elevated`, `--mat-overlay`, `--mat-blur`, `--mat-blur-strong`, `--mat-highlight`, `--mat-shadow`, `--mat-selected`, `--mat-glow`.
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

The navigation tint uses 80% of the canvas in Paper and Sepia and 92% in the other reader palettes. The dock tests composite its actual computed material, selection fill and text against black and white backdrops and require at least 4.5:1 in all eight palettes. The Bible dock uses the same density and an explicit opaque base for accessibility fallbacks.

## Earlier redesign: routes and states reviewed

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

## Earlier redesign: validation record

- **Blur budget**, counted in the running app as the frosted surfaces visible in the viewport, on all 38 routes:
  - At rest: 2 at most on every route, at 390px dark, 390px light and 1280px dark. Before the redesign it reached 5 in the reader (header, two chapter buttons, the play pill, the dock). Classes added one more per post's play icon.
  - Open states: a content sheet or Home drawer adds none. The Bible ⋮ menu, book picker, More navigation drawer and action-only menu each add one while open. Reduce transparency leaves 0.
- **Horizontal overflow:** none on any route at 390, 820 or 1280px.
- **Rendered contrast** (the pixels behind the text, with a bright, striped picture scrolled under the glass):
  - Dock labels: lowest 5.61:1 dark and 14.30:1 light.
  - Header title: lowest 11.62:1 dark and 15.07:1 light.
- **Focus:** a sheet takes the focus, Tab stays inside, Escape closes it, and the focus returns to the control that opened it. The Bible tab, which used to remove the focus ring, now shows it.
- **Checks:** `npm run typecheck`, lint, unit tests (9) and the end-to-end suites `telegram.spec` and `reading.spec` (74 tests) pass. The audio specs (`ambient.spec`, `recordings.spec`) fail the same way on unmodified `main` in the development sandbox and are left to CI.
- **Browsers:** Chromium (Playwright) at phone, tablet and desktop sizes, with reduced motion emulated. Not tested: Safari or WebKit, Firefox, Telegram's own webviews, and any physical phone.


## Dock material and interaction correction

The dock now follows the single-material hierarchy above on both Chromium and WebKit. The old
Chromium-only SVG displacement filter was drawn **above the icons and labels**, bending their
shapes and adding coloured fringes. It also put a second filter on a glass surface. That filter
and its canvas map are removed. The regular material lives on the dock's `::before`; the filled
selection sits below the controls. A specular rim brightens during a press without sampling another
backdrop or changing the label pixels.

Pressing the current section gently lifts its selection. Dragging follows the pointer directly,
with bounded stretch and small icon feedback; release selects the nearest destination. The
pointer is captured only after movement crosses the drag threshold, so an ordinary tap still
reaches the selected button. Cancel/lost capture restores the current selection and clears the
pending long press. Transfer of a touch's implicit capture from a button to the dock does not
cancel that drag. Secondary touches and right clicks cannot start it. Navigation by keyboard,
the long press to edit the bar, and the collapsed bar remain available.

Reduce Motion disables selection stretch, icon scaling, moving highlights and smooth
scroll-to-top. Reduce Transparency and Increased Contrast make the dock opaque, including the
Bible reader's palette override; Increased Contrast marks the selection with an outline. Forced
colours use system colours, and missing backdrop-filter support falls back to an opaque surface.

`app/e2e/glass.spec.ts` exercises the material, all eight palettes, 44px targets, ordinary taps,
cancellation, keyboard activation, reduced motion/transparency, increased contrast and desktop
vertical dragging. The CI workflow installs WebKit as well as Chromium and runs this focused
suite in both engines. A Chromium-only device-input test covers implicit touch-capture transfer.
This does not replace checking an actual iPhone inside Telegram.

## Apple documentation review — October 3, 2026

Reviewed Apple's current [Liquid Glass overview](https://developer.apple.com/documentation/technologyoverviews/liquid-glass),
[adoption guide](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass),
[Materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials), and
[custom-view implementation guide](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)
after access to `developer.apple.com` became available.

The review supports the dock correction: keep glass in the navigation layer above content,
avoid layering glass effects, preserve label contrast, and test custom controls with reduced
motion, reduced transparency and increased contrast. Apple's regular variant is appropriate
where text needs protection from the background; its highly translucent clear variant is meant
for controls over visually rich media. This text-heavy reader uses a regular-style CSS material.

The native implementation has capabilities this web adaptation does not reproduce. Apple's
standard SwiftUI, UIKit and AppKit components adopt the material when built with current SDKs.
For custom SwiftUI controls, `glassEffect(_:in:)` renders behind the content, `.interactive()`
adds touch and pointer responses, and `GlassEffectContainer` coordinates merging and morphing
shapes. The material reflects surrounding light and color and adjusts background luminosity.
These APIs are not available to the React DOM app inside Telegram or a browser; rebuilding its
JavaScript does not enable them. Apple's advice to remove custom backgrounds is directed at
native components that already receive the system material.

Our single backdrop, palette tint, specular edge and bounded pointer feedback follow the design
principles, but remain CSS approximations. The screenshot is not Apple's native Liquid Glass
renderer, and WebKit test coverage does not establish visual parity with it. Exact native
material rendering would require native controls in an Apple client. No further production
code change was warranted by this documentation review; physical iOS Telegram and macOS Safari
verification remains outstanding.

## Section 01: material inventory

This table covers every authored CSS background and backdrop declaration in `app/src`, including control states and content fills. Related selectors share one row; entries from conditional rules are included, and the normal-material entries inherit the solid accessibility overrides described below. This deliberately includes content backgrounds so a new glass effect cannot disappear from the audit merely by being classified as content. Prefixes and repeated declarations are consolidated; this is a source inventory, not a count of rendered filters.

| Element(s), grouped by stylesheet and component | Layer | Filter | Justification |
| --- | --- | --- | --- |
| **bible/bible.css · rel-inline**<br>`.bs .rel-inline` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · rel-tag**<br>`.bs .rel-tag` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · rel-more**<br>`.bs .rel-more` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-header**<br>`.bs-header`, `.bs-header__verses`, `.bs-header__ribbon` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-pill**<br>`.bs-pill`, `.bs-pill__bg` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-menu**<br>`.bs-menu__item`, `.bs-menu__item:active` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-context**<br>`.bs-context`, `.bs-context__main`, `.bs-context__exit`, `.bs-context__exit span` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-chapterbtn**<br>`.bs-chapterbtn`, `#root .bs-chapterbtn` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-playpill**<br>`.bs-playpill` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-audio**<br>`.bs-audio`, `.bs-audio__mode`, `.bs-audio__ctl`, `.bs-audio__play` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-chip**<br>`.bs-chip`, `.bs-chip[aria-pressed="true"]`, `#root .bs-chip--select` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-input**<br>`.bs-input` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-colors**<br>`.bs-colors__cell`, `.bs-colors__check::before` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-action**<br>`.bs-action` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-tabsfooter**<br>`.bs-tabsfooter`, `.bs-tabsfooter__indicator`, `.bs-tabsfooter__tab` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-params**<br>`.bs-params__row` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-touchicon**<br>`.bs-touchicon` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-themecircle**<br>`.bs-themecircle` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-fontrow**<br>`.bs-fontrow` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-preview**<br>`.bs-preview` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-palette**<br>`.bs-palette__row`, `.bs-palette__plus` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-coloredit**<br>`.bs-coloredit__hex input`, `.bs-coloredit__types button` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-filterbtn**<br>`.bs-filterbtn` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-filter**<br>`.bs-filter__opts button`, `.bs-filter__opts button[aria-checked="true"]` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-bookrow**<br>`.bs-bookrow` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-chaptertile**<br>`.bs-chaptertile`, `.bs-chaptertile[data-read]` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-bookshort**<br>`.bs-bookshort` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-versetile**<br>`.bs-versetile` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-versionrow**<br>`.bs-versionrow` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-bmitem**<br>`.bs-bmitem` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-search**<br>`.bs-search`, `.bs-search input`, `.bs-search__field`, `.bs-search__field input`, `.bs-search__go`, `.bs-search__hit`, `.bs-search__hit mark`, `.bs-search__hit span mark` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-tagrow**<br>`.bs-tagrow`, `.bs-tagrow:active` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-noteeditor**<br>`.bs-noteeditor__title`, `.bs-noteeditor__desc` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-resrow**<br>`.bs-resrow` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-precept**<br>`.bs-precept__kind` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-topic**<br>`.bs-topic__ref` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-link**<br>`.bs-link` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-resources**<br>`.bs-resources__xrefs .xref__chip`, `.bs-resources__xrefs .xref__text` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-resourcetabs**<br>`.bs-resourcetabs button` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-error**<br>`.bs-error__icon` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · why**<br>`.why__item`, `.why__ref`, `.why__kind` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · why-sheet**<br>`.why-sheet .why .why__src`, `.why-sheet .why .why__more` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-bookbar**<br>`.bs-bookbar`, `.bs-bookbar i` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-markread**<br>`.bs-markread`, `.bs-markread[aria-pressed="true"]`, `.bs-markread[aria-pressed="true"] .bs-markread__dot` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-comment**<br>`.bs-comment`, `.bs-comment__class`, `.bs-comment__watch` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-readin**<br>`.bs-readin__row`, `.bs-readin__ts`, `.bs-readin__more` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-words**<br>`#root .bs-words__w` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-word**<br>`.bs-word__head`, `.bs-word__chip`, `#root .bs-word__bookhead`, `.bs-word__book--open .bs-word__bookhead`, `#root .bs-word__book li button`, `#root .bs-word__book li button[data-here]`, `.bs-word__text mark`, `#root .bs-word__more` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-compare**<br>`.bs-compare__verse`, `.bs-compare__lanes`, `.bs-compare__lanes button`, `.bs-compare__lanes button[aria-selected="true"]`, `.bs-compare__item`, `.bs-compare__ref`, `.bs-compare__copy` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-greek**<br>`.bs-greek__text` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-entities**<br>`.bs-entities__title::before`, `.bs-entities__title::after`, `#root button.bs-entities__stack` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-people**<br>`#root button.bs-people__item`, `button.bs-people__item` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-deck**<br>`.bs-deck__card` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-gallery**<br>`.bs-gallery`, `#root .bs-gallery__btn`, `.bs-gallery__btn`, `.bs-gallery__pic`, `.bs-gallery__badge`, `.bs-gallery__close`, `.bs-gallery[data-open]` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **bible/bible.css · bs-player**<br>`.bs-player__box` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-dropdown**<br>`.bs-dropdown`, `#root .bs-dropdown__item`, `.bs-dropdown__item`, `.bs-dropdown__item:active` | elevated | `var(--mat-blur-strong)` | One shared material on the navigation surface; nested control fills have no filter. |
| **bible/bible.css · bs-picker**<br>`.bs-picker`, `.bs-picker .bs-versetile`, `.bs-picker .bs-versetile:active` | elevated | `var(--mat-blur-strong)` | One shared material on the navigation surface; nested control fills have no filter. |
| **bible/bible.css · bs-picker-scrim**<br>`.bs-picker-scrim` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **bible/bible.css · bs-text**<br>`.bs [data-reading] .bs-text` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-follow**<br>`.bs .bs-follow` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **bible/bible.css · bs-ambient-tabs**<br>`.bs-ambient-tabs [aria-selected="true"]` | content | None | Content, control state, or decoration; never glass. |
| **bible/bible.css · bs-scrim**<br>`.bs-scrim--clear > .bs-sheet.bs-selected` | overlay / floating navigation | `var(--mat-blur-strong)` | Only the floating selection sheet filters; modal scrims merely dim and ordinary sheets stay opaque. |
| **bible/bible.css · bs-selected**<br>`.bs-selected .bs-sheet__handle`, `.bs-selected .bs-action__box`, `.bs-selected .bs-tabsfooter`, `.bs-selected .bs-tabsfooter__indicator` | content | None | Content, control state, or decoration; never glass. |
| **bible/ui/sheet.css · bs-iconbtn**<br>`.bs-iconbtn` | content | None | Content, control state, or decoration; never glass. |
| **bible/ui/sheet.css · bs-scrim**<br>`.bs-scrim`, `.bs-scrim--clear` | overlay | None | Only the floating selection sheet filters; modal scrims merely dim and ordinary sheets stay opaque. |
| **bible/ui/sheet.css · bs-sheet**<br>`.bs-sheet`, `.bs-sheet__handle`, `.bs-sheet__close`, `.bs-sheet.chats-sheet`, `.bs-sheet.edit-sheet` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **bible/ui/sheet.css · bs-switchrow**<br>`.bs-switchrow` | content | None | Content, control state, or decoration; never glass. |
| **bible/ui/sheet.css · bs-switch**<br>`.bs-switch`, `.bs-switch span`, `.bs-switch[data-on]` | content | None | Content, control state, or decoration; never glass. |
| **bible/ui/sheet.css · bs-checkbox**<br>`.bs-checkbox[data-checked]` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · html**<br>`html` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · body**<br>`body` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · body::before**<br>`body::before` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · ::selection**<br>`::selection` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · link**<br>`.link` | content | None | Content, control state, or decoration; never glass. |
| **styles/base.css · mark**<br>`mark` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · card**<br>`.card`, `.card--btn:hover`, `a.card:hover`, `.card--glow` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · list**<br>`#root .list`, `#root .list > *` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · row**<br>`#root button.row`, `#root .row:hover`, `#root .row:active`, `.row__thumb`, `.row__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · skel**<br>`.skel` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · trouble**<br>`.trouble`, `.trouble__badge` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · tile**<br>`.tile__img` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · grid**<br>`.grid a` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · avatar**<br>`.avatar` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · scard**<br>`.scard`, `#root .scard__fail button`, `#root .scard__go:hover`, `#root button.scard__act` | content | None | Content, control state, or decoration; never glass. |
| **styles/content.css · mcard**<br>`.mcard`, `#root .mcard__row`, `.mcard__row`, `#root .mcard__row:hover`, `#root .mcard__row:active` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · btn**<br>`#root .btn`, `#root .btn--bordered`, `#root .btn--quiet`, `#root .btn--glass`, `#root .btn--plain` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · empty**<br>`#root .empty__act` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · crash**<br>`#root .crash__btn`, `#root .crash__btn:not(.crash__btn--main)` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · trouble**<br>`#root .trouble__act`, `#root .trouble__act:not(.trouble__act--primary)` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · paywall**<br>`#root .paywall__go` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · head**<br>`#root :is(.head, .bs-header, .srch__bar, .pv__bar) .btn--glass` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/controls.css · pageactions**<br>`#root .pageactions .btn--glass` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · icon-btn**<br>`.icon-btn`, `.icon-btn:hover`, `.icon-btn:active`, `.icon-btn[aria-pressed="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · more-btn**<br>`.more-btn`, `.more-btn:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bookpage**<br>`#root .bookpage__more` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · section**<br>`#root .section__more` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bs-word**<br>`#root .bs-word__more` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · chip**<br>`#root .chip`, `#root .chip:hover`, `#root .chip[aria-pressed="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · seg**<br>`#root .seg`, `html[data-theme="light"] #root .seg`, `html[data-theme="sepia"] #root .seg` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · field**<br>`.field__clear` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · hero**<br>`.hero__clear` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input**<br>`.input` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · sheet**<br>`.sheet__form textarea` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/controls.css · edit**<br>`.edit input`, `.edit__text` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · tagadd**<br>`.tagadd input` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · toggle**<br>`.toggle`, `.toggle:hover`, `.toggle[aria-checked="true"] .switch`, `.toggle:active:not(:disabled) .switch::after` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · switch**<br>`.switch`, `.switch::after` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · letters**<br>`.letters button`, `.letters button:hover`, `.letters button[aria-pressed="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · pill**<br>`.pill`, `.pill--hot`, `.pill--ok` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · soon**<br>`.soon` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · tag**<br>`.tag` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · cite**<br>`.cite` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · answer**<br>`.answer__n` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · progress**<br>`.progress`, `.progress i` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · remind-date**<br>`.remind-date input` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bs-chip**<br>`#root .bs-chip[aria-pressed="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bs-ambient-tabs**<br>`#root .bs-ambient-tabs [aria-selected="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bs-switchrow**<br>`.bs-switchrow:active:not(:disabled) .bs-switch span` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input[type="range"]**<br>`input[type="range"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input[type="range"]::-webkit-slider-runnable-track**<br>`input[type="range"]::-webkit-slider-runnable-track` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input[type="range"]::-moz-range-track**<br>`input[type="range"]::-moz-range-track` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input[type="range"]::-webkit-slider-thumb**<br>`input[type="range"]::-webkit-slider-thumb` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · input[type="range"]::-moz-range-thumb**<br>`input[type="range"]::-moz-range-thumb` | content | None | Content, control state, or decoration; never glass. |
| **styles/controls.css · bs-switch**<br>`.bs-switch span` | content | None | Content, control state, or decoration; never glass. |
| **styles/materials.css · glass**<br>`.glass`, `.glass--elevated` | navigation | `var(--mat-blur)`, `var(--mat-blur-strong)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · surface**<br>`.surface` | content | None | Content, control state, or decoration; never glass. |
| **styles/materials.css · screen**<br>`.screen > .head::before`, `.screen > .head::after` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · srch**<br>`.srch__bar::before`, `.srch__bar::after` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · chat2**<br>`.chat2__bar::before`, `.chat2__bar::after` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · reader**<br>`.reader__bar::before`, `.reader__bar::after` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · bs-header**<br>`:is(.bs-header, .tlh, .pv__bar)::before` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · tlh**<br>`.tlh.glass` | content | None | Content, control state, or decoration; never glass. |
| **styles/materials.css · pv**<br>`.pv__bar`, `html:has(.pv) :is(.tabs, .bs-header, .head, .srch__bar, .chat2__bar, .reader__bar, .tlh)::before` | overlay | None | Only the media bar filters. Its dark semantic palette preserves white controls in every app theme. |
| **styles/materials.css · tabs**<br>`.tabs`, `.tabs::before`, `.tabs::after`, `.tabs .tab`, `.tabs__pill`, `.tabs[data-lift] .tabs__pill`, `.tabs__pill::after`, `html[data-transparency="reduced"] .tabs::before`, `.tabs .tab__count[style*="--group"]` | navigation | `var(--mat-blur)` | One shared material on the navigation surface; nested control fills have no filter. |
| **styles/materials.css · bs-selected**<br>`html:has(.bs-selected) .tabs::before` | content | None | Content, control state, or decoration; never glass. |
| **styles/materials.css · switcherbar**<br>`#root .switcherbar__add`, `#root .switcherbar__ok`, `#root .switcherbar__group` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/materials.css · pageaction**<br>`#root .pageaction`, `#root .pageaction--quiet` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/materials.css · drawer**<br>`.drawer`, `.drawer__fade`, `.drawer__head`, `#root button.drawer__back`, `.drawer__back`, `#root button.drawer__x`, `.drawer__x`, `.drawer:not([data-open])` | overlay / elevated | More: one shared filter; Home: none | More is a navigation surface. Content and controls never add a nested filter. |
| **styles/materials.css · drawer-scrim**<br>`.drawer-scrim`, `.drawer-scrim[data-open]` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/materials.css · sheet**<br>`.sheet__scrim`, `.sheet`, `.sheet__grip`, `.sheet__items`, `.sheet__item`, `.sheet__item:hover`, `.sheet__item:active`, `.sheet__icon`, `.sheet__cancel` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/materials.css · nsheet**<br>`.nsheet`, `.nsheet__grip`, `.nsheet__close` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/materials.css · toast**<br>`.toast`, `#root .toast__close`, `.toast__timer` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/materials.css · lock**<br>`.lock` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **styles/screens/ask.css · chat2**<br>`.chat2__heading`, `.chat2__new`, `.chat2__new:not(:disabled):hover`, `.chat2__new:not(:disabled):active`, `.chat2__mark`, `img.chat2__mark`, `.chat2__outside` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/screens/ask.css · starter**<br>`.starter`, `.starter:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · msg**<br>`.msg__bubble`, `.msg__avatar`, `img.msg__avatar`, `.msg__text blockquote`, `.msg__text :not(pre) > code`, `.msg__text pre`, `#root .msg__text .cite`, `#root .msg__text .cite:hover`, `.msg__action`, `.msg__action:hover`, `.msg__action:active`, `.msg__error`, `.msg__text a.applink` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · answer**<br>`.answer__dots i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · srccard**<br>`#root .srccard .cite`, `.srccard`, `.srccard:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · research**<br>`.research`, `.research__head` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · followup**<br>`.followup`, `.followup:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · composer2**<br>`.composer2`, `.composer2__box`, `.composer2 textarea`, `.composer2__go`, `.composer2__go:disabled`, `.composer2__go--stop`, `.composer2__go--stop span` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · chats**<br>`.chats__row[data-current]`, `.chats__open`, `.chats__open:hover`, `.chats__del`, `.chats__del:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · plans**<br>`.plans__now`, `.plans__bar`, `.plans__bar i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · plan**<br>`.plan`, `.plan__buy`, `.plan__buy--quiet`, `.plan__on` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · paywall**<br>`.paywall` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · actioncard**<br>`.actioncard`, `.actioncard .linkish` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/ask.css · models**<br>`.models__row`, `.models__search` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/classes.css · cfeed**<br>`#root .cfeed__filters .cfeed__pick`, `#root .cfeed__filters .cfeed__pick:hover`, `#root .cfeed__filters .cfeed__pick[data-on]`, `#root .cfeed__filters .cfeed__reset`, `#root .cfeed__more .cfeed__morebtn` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/classes.css · post**<br>`.post__mark`, `#root .post .post__icon`, `#root .post .post__icon:hover`, `.post__media`, `#root .post .post__poster`, `.post__noimg`, `.post__playicon`, `.post__poster:hover .post__playicon`, `.post__poster:focus-visible .post__playicon`, `#root .post .post__act`, `#root .post .post__act:hover`, `#root .post .post__act[aria-pressed="true"]`, `#root .post .post__act[aria-expanded="true"]`, `.post__scripture`, `#root .post .post__ref`, `#root .post .post__more` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · hero**<br>`.hero` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · today-card**<br>`.today-card`, `.today-card header a:hover`, `#root .today-card footer button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · stats**<br>`.stats__cell` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · stat**<br>`.stat div` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · continue**<br>`.continue__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · resume**<br>`.resume__item`, `.resume__icon`, `.resume__bar`, `.resume__bar i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · streak**<br>`.streak`, `.streak__bar`, `.streak__bar i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · sabbath**<br>`.sabbath__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · live-card**<br>`.live-card`, `.live-card__dot`, `.live-card--soon .live-card__dot` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · shelf-card**<br>`.shelf-card`, `.shelf-card:hover`, `.shelf-card__icon`, `.shelf-card--law .shelf-card__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · widget**<br>`.widget__label`, `#root .widget__foot`, `#root .widget__shuffle` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · tools**<br>`#root .tools__btn`, `#root .tools__btn:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · whatsnew**<br>`.whatsnew__card` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · feature**<br>`.feature`, `.feature__img` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · feed**<br>`.feed__card:hover`, `.feed__card .feed__thumb`, `.feed__card--skel .feed__thumb`, `.feed__img`, `.feed__kind`, `.feed__books em` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · shero**<br>`.shero__field`, `.shero__field input`, `.shero__clear`, `.shero__go` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · live**<br>`.live`, `.live__row:hover`, `.live__row:active`, `.live__all`, `.live__spoken`, `.live__ask`, `.live mark` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/home.css · fold**<br>`.fold`, `.fold:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/law.css · laws**<br>`.laws__list` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/law.css · lawlink**<br>`#root .lawlink:hover`, `#root .lawlink:active`, `.lawlink__code` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/law.css · lawsec**<br>`#root .lawsec__top .lawsec__share`, `#root .lawsec__top .lawsec__share:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/law.css · case**<br>`#root button.case__share`, `#root button.case__share:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/law.css · lawcard**<br>`.lawcard`, `#root .lawcard__refs .lawcard__ref`, `#root .lawcard__refs .lawcard__ref:hover`, `#root .lawcard__refs .lawcard__ref[aria-selected="true"]`, `#root .lawcard__refs .lawcard__ref--more`, `#root .lawcard__foot .lawcard__all`, `#root .lawcard__foot .lawcard__go`, `#root .lawcard__foot .lawcard__go:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/library.css · book**<br>`.book__figure`, `.book__figure:hover`, `.book__figure img`, `.book__read`, `.book__readpage a` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/library.css · bookpage**<br>`.bookpage--at`, `.bookpage__read`, `#root .bookpage__readhead`, `#root .bookpage__readhead:hover`, `.bookpage__watch`, `.bookpage__img`, `#root .bookpage__fig` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/library.css · pv**<br>`.pv`, `#root .pv__btn`, `.pv__stage`, `#root .pv__nav`, `.pv__zoom`, `.pv__panel`, `#root .pv__grab`, `#root .pv__mini`, `.pv__grabbar`, `.pv__class`, `.pv .said__line[data-here]`, `#root .pv .said__line button` | overlay | None | Only the media bar filters. Its dark semantic palette preserves white controls in every app theme. |
| **styles/screens/library.css · lex**<br>`.lex .bs-word__head` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/library.css · lex-day**<br>`.lex-day` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/library.css · thread**<br>`.thread::before`, `#root .thread__head`, `.thread__dot`, `.thread__stop--open .thread__dot`, `.thread__class`, `.thread__class:hover`, `.thread__ts`, `#root .thread__more button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · backto**<br>`.backto` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · player**<br>`.player`, `.player__box`, `#root .player__expand` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · watch**<br>`.watch`, `.watch span` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · notes-open**<br>`.notes-open`, `#root .notes-open__main`, `#root .notes-open__main:hover`, `#root .notes-open__at` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · note**<br>`.note blockquote`, `.note .note-opens`, `.note a.note-opens__ref`, `.note a.note-opens__ref:hover`, `.note .moment__at`, `.note .shown__at`, `.note--seek [data-at]:hover`, `.note--seek [data-at]:active` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · frame**<br>`.frame` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · transcript**<br>`.transcript p[data-found]`, `.transcript button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · tx**<br>`.tx__chunk[data-here]`, `.tx__chunk button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · said**<br>`.said__line[data-here]`, `#root .said__line button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · spoken**<br>`.spoken__notes` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · taught**<br>`.taught__book` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · upnext**<br>`.upnext__card`, `.upnext__card:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · request-notes**<br>`#root button.request-notes`, `#root button.request-notes[data-done]` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · notes-wanted**<br>`.notes-wanted` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · nreq**<br>`.nreq`, `#root button.nreq__main` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/notes.css · edit**<br>`.edit__footer` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · entity**<br>`#root .entity__code`, `#root .entity__code:hover`, `#root button.entity__more`, `#root .entity__source button` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · fg**<br>`.fg`, `#root button.fg__node`, `.fg__back`, `.fg__chip`, `#root button.fg__page`, `#root button.fg__hist`, `#root button.fg__page:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · cases**<br>`.cases__list` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · caserow**<br>`#root .caserow:hover`, `#root .caserow:active`, `.caserow__dot`, `[data-kind="blessing"] .caserow__dot` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · ccard**<br>`.ccard__meta i`, `.ccard[data-kind="blessing"] .ccard__meta i`, `#root .ccard`, `#root .ccard:hover`, `#root .ccard:active` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/people.css · case**<br>`.case__verdict i`, `.case__verdict[data-kind="blessing"] i`, `.case__verdict`, `.case__verdict[data-kind="blessing"]`, `.case__charge`, `#root .case__person`, `#root .case__person:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · chapters**<br>`.chapters a`, `.chapters a:hover`, `.chapters a[data-last]` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · v**<br>`.v[aria-pressed="true"]`, `.v[data-reading]`, `.v--hl`, `.v[data-bm]::after`, `.v[data-hl="y"]`, `.v[data-hl="g"]`, `.v[data-hl="b"]`, `.v[data-hl="p"]`, `.v[data-hl="o"]`, `.v[data-hl="v"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · vnote**<br>`.vnote` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · steps**<br>`.steps a`, `.steps a[data-main]` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · xref**<br>`.xref__chip`, `.xref__chip[aria-expanded="true"]`, `.xref__text` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · listen**<br>`.listen`, `.listen__rate button`, `.listen__rate button[aria-pressed="true"]` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/screens/reading.css · rel-inline**<br>`.rel-inline` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-tag**<br>`.rel-tag` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-more**<br>`.rel-more` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-count**<br>`.rel-count`, `.rel-count i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-row**<br>`.rel-row__body` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-result**<br>`.rel-result`, `.rel-result:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · rel-seemore**<br>`.rel-seemore` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · plan-row**<br>`.plan-row`, `.plan-row[data-read] i` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · daystrip**<br>`.daystrip__day`, `.daystrip__day[aria-selected="true"]` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/reading.css · catchup**<br>`.catchup` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/search.css · srch**<br>`.srch__field`, `.srch__field[data-focus]`, `#root .srch__field input`, `#root button.srch__clear`, `#root button.srch__cancel`, `#root button.srch__scope`, `#root button.srch__scope:hover`, `#root button.srch__scope[aria-selected="true"]`, `.srch__count`, `.srch__list`, `#root .srch__hit:hover`, `#root .srch__hit:focus-visible`, `.srch__kind`, `.srch__kind[data-kind="verse"]`, `.srch__kind[data-kind="law"]`, `.srch__kind[data-kind="precept"]`, `.srch__kind[data-kind="case"]`, `.srch__kind[data-kind="study"]`, `.srch__kind[data-kind="encyclopedia"]`, `.srch__kind[data-kind="book"]`, `.srch__results mark`, `#root button.srch__ref`, `.srch__refIcon`, `.srch__recent`, `#root button.srch__recentbtn`, `#root button.srch__recentbtn:hover`, `#root button.srch__forget`, `#root .srch__try button:not([class*="tgui-"])`, `#root .srch__try button:not([class*="tgui-"]):hover`, `#root button.srch__all` | navigation | None | Control, selection, or edge fill; no additional glass. |
| **styles/screens/search.css · rec**<br>`.rec__thumb`, `.rec__time`, `.rec__title button`, `.rec mark` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/search.css · recs**<br>`.recs--compact`, `.recs--compact .rec:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/switcher.css · nt-search**<br>`#root .nt-search`, `#root .nt-search:hover` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/switcher.css · nt-item**<br>`.nt-item`, `.nt-item:hover`, `.nt-item__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/switcher.css · nt-hero**<br>`.nt-hero`, `.nt-hero__icon` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/switcher.css · tabcard**<br>`.tabcard`, `#root .tabcard__open`, `.tabcard__icon`, `#root .tabcard__close`, `.tabcard__close span` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/switcher.css · naved**<br>`.naved__preview`, `.naved`, `.naved__btn`, `.naved__btn:not(:disabled):hover`, `.naved__btn:not(:disabled):active`, `.naved__reset` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tlh**<br>`#root .tlh__btn` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-item**<br>`.tl-item__pic` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-pic**<br>`.tl-pic--none` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-emblem**<br>`.tl-emblem--card`, `.tl-emblem__bar`, `.tl-emblem__new` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-card**<br>`.tl-card__bar` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-period**<br>`.tl-period` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-behind**<br>`.tl-behind` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-canvas**<br>`.tl-canvas` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-panel**<br>`#root .tl-panel` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-major**<br>`.tl-major`, `.tl-major__letter` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-minor**<br>`.tl-minor`, `.tl-minor__title` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-datebar**<br>`.tl-datebar` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-line**<br>`.tl-line` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-current**<br>`.tl-current__year`, `#root .tl-current__nav`, `.tl-current__progress` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-details**<br>`.tl-details__list a` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-search**<br>`.tl-search__pic` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-event**<br>`.tl-event__period` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · tl-related**<br>`.tl-related` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-chip**<br>`.fc-chip` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-teach**<br>`.fc-teach` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-cite**<br>`.fc-cite:active` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-differ**<br>`.fc-differ` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-figure**<br>`.fc-figure img` | content | None | Content, control state, or decoration; never glass. |
| **styles/screens/timeline.css · fc-badge**<br>`.fc-badge--archival`, `.fc-badge--generated` | content | None | Content, control state, or decoration; never glass. |
| **ui/photo-edit.css · bs-sheet**<br>`.bs-sheet.photo-sheet` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |
| **ui/photo-edit.css · photo-frame**<br>`.photo-frame` | overlay | None | Content/controls use solid surfaces; scrims dim the page without filtering it. |

Inline backgrounds also belong to this inventory: Bible highlight swatches and theme editors (`SelectedVersesSheet`, `ParamsSheet`, and `Editors`) show the actual user-selected color; `Verse` tags and `ChapterPeople` gallery controls use the reader palette; `MediaDeck` controls use their media palette; timeline markers show category/state. These are content or control fills with **no backdrop filter**, not independent materials. The Bible root supplies the opaque reader canvas. Dynamic dock tint/selection variables are accounted for in the dock row above. None of these inline styles creates a backdrop filter.

### Recipes, fallbacks, and scope

- The header and dock are the two regular navigation materials. The Bible header material is on `::before`, so its options menu has no filtered ancestor; the menu opens below the header edge. Menus and pickers use the shared elevated recipe.
- The floating selection sheet uses the elevated recipe. Its underlying dock becomes solid while the sheet is present, preventing glass on glass and keeping the header-plus-sheet budget at two. Full-screen picture viewing disables covered app-navigation filters.
- `--mat-overlay` is now opaque. Content sheets, notification text, the composer, editor footer, and unfrosted floating controls therefore never inherit a translucent content ground. Ask/editor/photo sheets retain their explicit opaque palettes.
- `--mat-density` and `--mat-elevated-density` become 100%, both blur tokens become `none`, and the scroll-edge mask is removed for OS/app reduced transparency, increased contrast, forced colors, and missing backdrop support. Reader and media scopes inherit those density/filter decisions while supplying their own base color.
- TelegramUI 2.1.13 consumes `--tgui--surface_primary` in `Form/Chip` and `Layout/Tabbar`. This app uses the Chip wrapper and a custom dock; Cell and Section use other surface tokens. The primary fallback now maps to opaque `--surface-1`.
- Media navigation uses `--media-canvas`, `--media-surface`, `--media-ink`, `--media-muted`, `--media-edge`, and `--media-fill`. It stays dark in every reading theme. It does not claim to implement Apple’s native clear material.
- Shared type tokens use `rem`, so the root 200% text setting really enlarges shared text. Control shapes and sizes are documented in Section 02 below.
- Dock drag geometry is measured at pointer-down, then reused for feedback. Resizing cancels the gesture safely. The dock and media viewer no longer animate layout dimensions; the dock’s `will-change` exists only during a press/drag.

### Documentation mapping and browser limits

Section 01 addresses the adoption guide’s reduction of custom backgrounds, sparing material use, and display/accessibility review. The accompanying HIG [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Menus](https://developer.apple.com/design/human-interface-guidelines/menus), [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Search fields](https://developer.apple.com/design/human-interface-guidelines/search-fields), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables), and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility) guidance preserves readable surfaces, existing destinations, semantic controls, and accessible alternatives. No route or stored setting changes are part of this section.

The OS reduced-transparency E2E uses Chromium CDP media emulation and verifies the actual media query plus computed CSS. Playwright does not expose that OS preference for WebKit; the in-app setting is exercised there instead. The unsupported-filter test activates the app’s real CSS fallback blocks in their original cascade positions; it verifies the fallback recipe, not an old browser. Native optical adaptation and connected glass morphing remain unavailable in this CSS implementation. No SVG backdrop distortion is used.

## Section 02: shared controls

`ui/Button.tsx` exposes a closed `appearance` union: `glass`, `prominent`, `bordered`, `plain`. The `.btn` classes expose the same recipes to links and existing controls; `.btn--quiet` remains a compatibility alias for bordered. Bible sheet buttons use this component too. Their definitions live in `bible/ui/sheet.css` and `styles/controls.css`, rather than being duplicated in the lazy-loaded Bible stylesheet.

| Style | Purpose and color |
| --- | --- |
| prominent | Main action, `--accent` fill and `--on-accent` ink. |
| bordered | Secondary action, shared fill and control edge. |
| plain | Text action without a resting background. |
| glass | A selection tint **within an existing navigation material**, never another backdrop filter. Outside the approved navigation containers it falls back to bordered. Detached page actions keep a solid overlay ground to preserve readability and the blur budget. |

Home actions, library page links/scan buttons, the picture-viewer reading action, note requests, photo editing, recovery actions, pagination and “show more” actions share these recipes. Tappable content cards, highlight swatches, media transport and category badges retain their semantic presentation. The media viewer scopes `--accent`/`--on-accent` to its dark media palette. Ordinary page actions remain capsules, and the main paywall CTA uses the extra-large size.

Sizes are `--h-sm`, `--h-md`, `--h-lg`, `--h-xl`, with a 44px minimum target and rem-based growth. Buttons and chips use `--r-pill`. Labels wrap instead of clipping; dock labels and selection action labels grow with the root text size. TelegramUI's nested segmented captions inherit the button font so the visible text grows too. The mobile dock's height grows with text; the desktop rail uses native vertical touch scrolling if it outgrows the safe viewport. In that state touch pans scroll instead of moving the pill; mouse dragging, taps and long presses remain available. The shared material spans the scrollable controls, and resizing to fit restores touch dragging.

### Nested shapes

Each enclosing component declares `--r-outer` and its real `--inset`, then computes locally:

```css
--r-inner: max(var(--r-min), calc(var(--r-outer) - var(--inset)));
```

`--r-min` is 4px. Recompute on the enclosing component so CSS variable inheritance cannot retain another component's resolved radius. Sheet content cards, bar/card icon controls, bar search fields, the dock selection pill, segmented-control items and menu items use this inset contour. Fully rounded primary/secondary action capsules remain capsules: Apple's advice is to **consider** concentric shapes when close-fitting, not make every nested action a rectangle. This preserves the brief's explicit capsule requirement.

| Context | Outer / inset | Inner consumer |
| --- | --- | --- |
| Sheet | `--r-2xl` / `--sp-4` | Card, item group, preview, photo frame |
| Card or bar | `--r-xl` / `--sp-2` | Icon control or search field |
| Dock | Half dock height (30px desktop) / 6px | Selection pill and targets |
| Segment | Half control height + control inset / control inset | Selected item |
| Options menu | `--r-lg` / 6px | Menu item |
| Picker | `--r-lg` / `--sp-3` | Search well |

### Interaction, accessibility and limits

The dock moves and stretches through a single transform transition, with cached drag geometry and no forced reflow to restart a keyframe. A brief opacity-only release highlight lets the selection settle before a separate gesture. Menu/popover expansion originates at the trigger edge using transform/opacity. Pressed switch and native range thumbs lift to about 1.2× with a light fill, opposite rim highlights and a soft shadow; the dock selection uses the same rim and spring. At rest knobs stay solid. This uses paint and transform, with no additional backdrop filter or native optical refraction. Native connected button-to-menu morphing is unavailable here; the existing accessible button/menu and sheet behavior remains intact.

Authored transitions animate transform/opacity only. The drawer's zero-duration delayed visibility switch is retained to finish its exit before hiding it. Persistent gallery `will-change` was removed; the dock and notes sheet use it only during a gesture. The notes sheet now follows a drag using transform rather than changing its layout on every move. Color, edge and layout changes take effect without animation. Reduced motion disables knob scaling and the dock spring. Reduced transparency and increased contrast keep the pressed fill opaque; forced colors use opaque system colors (`CanvasText` for the switch thumb; WebKit’s `ButtonText` can have alpha). No control adds a backdrop filter, so the Section 01 filter budget and opaque fallbacks still apply.

The SDK combines device and Telegram content safe insets on every edge. Reader controls, menus, sheets and the dock respect those values without changing Telegram's native chrome. New E2E coverage exercises actual 200% text, both viewport sizes, all three palettes, OS/app reduced transparency, reduced motion, increased contrast and forced colors. It checks keyboard activation, visible action labels, safe bounds and solid fallback materials. The nested color-editor action is also checked for at least 4.5:1 contrast.

Apple mapping: [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) — rounder controls, intentional color, concentric shapes where appropriate, no crowding, and modern button styles. The native switch and connected morph descriptions are approximated with the web feedback described above; no SwiftUI/UIKit or SVG distortion is used.


### Shared scroll edges and native range controls

One mask recipe in `materials.css` fades only the bar’s material, leaving text and hit targets unmasked. Ordinary headers, Search, Ask, the Bible header, the Timeline header and the picture viewer fade toward content below. The dock’s existing material fades upward. Their small fade extensions collapse to zero and masks disappear under reduced transparency, increased contrast, forced colors and the no-filter fallback. No additional filter is allocated. The legacy `.reader__bar` selector shares the recipe but has no mounted component in the current app.

Native `input[type=range]` controls keep their value, keyboard arrows, focus and pointer behavior. Shared track and thumb rules cover photo zoom and ambient volume; the reader’s text size uses its existing step buttons. No slider or stored preference was added. Switches retain their checked state and disabled semantics. Active fills and shadows switch immediately; only transform animates with the spring token.

Apple mapping: [Adopting Liquid Glass — Controls](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass) and [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars). Transient knob lift is a web visual approximation of the native control material. The scroll-edge mask is the web equivalent of `scrollEdgeEffectStyle`.

## Section 03: navigation and the sidebar

The same navigation component becomes a leading sidebar at **900 CSS pixels**. Item order, names, selection and the Tabs badge come from the existing preferences and state. Document-flow pages reserve the sidebar’s width; fixed Bible/composer/notes layouts use the same inset. Header materials span the remaining content area. The device and Telegram content safe areas remain additive, including the rail’s top and bottom bounds.

Below 900px, scrolling down minimizes the dock to its current section (at least 44×44px), scrolling up or reaching an edge expands it, and tapping the minimized control expands it. Document, Bible and Timeline vertical scrolls share the observer; horizontal canvas movement, drawers, sheets and the rail itself do not minimize it. Accumulated travel resets when the active scrolling container changes. Route restoration records a baseline without minimizing the dock; only actual input starts a reading gesture. The document keeps native vertical overscroll behavior: blocking it at both `html` and `body` prevented document-wheel scrolling in the pinned WebKit engine. Horizontal overscroll remains blocked, nested scrollers keep containment, and Telegram’s existing SDK swipe guard remains responsible for the host gesture. In the sidebar, every item remains directly clickable and keyboard reachable; crossing the breakpoint clears a stale minimized state.

Timeline period artwork and a note’s existing recording poster also provide a decorative, mirrored, blurred image behind the reserved sidebar area. This paints only existing image pixels: no new artwork, backdrop filter, distorted text or animated blur. The poster extension disappears during playback or picture-in-picture. Unapproved Timeline periods retain their existing color fallback with no image extension. Reduced transparency, increased contrast and forced colors hide this decoration. Library pages currently have figure lists rather than cover heroes, so there is no Library hero to extend.

No inspector was added. A verse’s desktop study panel could become an inspector in a later proposal; that would need a separate information-architecture decision.

Apple mapping: [Adopting Liquid Glass — Navigation](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), and [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars). CSS layout and the shared scroll observer adapt the native tab/sidebar behavior. The image-only decoration is a web approximation of background extension, with content constrained to the remaining width.


## Section 04: menus and toolbar groups

[Menus](https://developer.apple.com/design/human-interface-guidelines/menus) and [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) use the same common-action glyphs from `ui/icons.tsx`. Bible icon aliases delegate to that set; Copy, Share, Bookmark, Edit, Delete, Open and Search keep their meaning across screens. Highlight remains an explicitly named color swatch rather than an ambiguous standalone icon. Destructive menu items are last and use `--danger`; the photo editor similarly puts removal last. Saved chats and bookmarks have visible delete controls, and Tabs swipes change groups: none has a row swipe-action menu to reorder.

The Bible text controls and icon actions form separate capsule groups, with `--toolbar-gap` between them and one tint per group over the existing bar material. Note actions are an icon group; Ask's title and its two independent icon actions stay separated by the same gap. The photo editor uses text actions together. The legacy reader bar has no mounted component. A collapsed Bible header renders its short reference instead of invisible focusable controls; conditional actions are removed completely. Explicitly named buttons also expose desktop titles.

Header menus, pickers and shared action menus animate from the activating control. Where supported, the View Transitions API captures the control and menu; fixed snapshot geometry animates only scale and opacity. Other browsers use Web Animations with a measured trigger-relative transform origin, including the reverse exit. Reduced motion uses opacity only. Focus moves into the menu, arrow/Home/End keys move between commands, Escape closes it, and focus returns to its trigger. Animation state is cleaned up when a transition is interrupted or the component unmounts. This is a web adaptation, not native optical material morphing.

The More drawer and action-only shared menus use `--mat-elevated` and one `--mat-blur-strong`; their rows and header add no filter. The More drawer retains its established navigation slide and grouping. Saved-chat/model lists remain opaque content sheets; verse actions retain the shared elevated selection material. Reduced transparency, contrast, forced colors and unsupported filtering resolve the shared tokens to solid colors and no blur. The three-filter open-menu budget still applies.

Additional inventory: `styles/popovers.css` / `.drawer--more` and `.sheet[data-actions]` — elevated navigation, one shared strong filter each, no nested material. `ui/popover.ts` snapshot layers are transient browser animation surfaces, with no authored backdrop filter. Apple mapping: [Adopting Liquid Glass — Menus and toolbars](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass).

Section 04 interaction sample (production Chrome 153, 4× CPU, 390×844): dock median/p95/max **16.7/16.8/66.7 ms**, first sheet **16.7/33.3/83.3 ms**. The committed `glass-04/profile-production.json` records layout cost and provenance. These are measured web frame intervals; remaining cold-mount/navigation spikes are tracked for section 10.

### Sheets, arbitrary windows and action anchors (section 05)

Following [Adopting Liquid Glass — Layout and organization](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), auto/40%/half sheets have an 8px gap beyond each device/Telegram safe inset, a shared 36px `--r-sheet`, and inset-derived inner corners. Safe-area space is counted once, outside the floating sheet; asymmetric left/right insets remain asymmetric. Full sheets reach the phone's side and bottom edges, keep only the top corners, and put bottom safe space inside. Wider content sheets retain the 640px reading/form bound; extending forms across a desktop window would impair readability.

Expanding a half sheet applies full geometry once, then translates and fades the layer for 220ms. Height, width and blur are never animated. Reduced motion fades only. The 44px grabber button supports click, Enter/Space and accessible expanded state as well as dragging. Focus outlines preserve the component radius instead of replacing it with a small rectangle. Shared clipping and header/footer padding protect the larger corners; Timeline's details panel uses the same inset geometry. This checkout has no Timeline event-creation form; its existing details and photo-editing flows are the applicable surfaces. Photo crops remeasure their frame on resize so the preview and saved crop keep the same geometry.

`sheet.css` supplies the default app palette outside the Bible; the Bible's own palette overrides those inherited defaults. The selection toolbar, chats, note editor and photo editor no longer supply competing background/blur recipes. Command sheets opt into the same elevated material as menus; full sheets and text-heavy forms use the opaque `--mat-overlay`. Keeping forms opaque is the web adaptation of the native appearance transition: overlapping reading/conversation text must not show through, and the navigation-only glass rule still applies. All accessibility fallbacks come from the shared material tokens.

Action-only shared sheets attach to their initiating control at 768px and above, opening above or below it within the safe viewport. They do not lock scrolling or trap focus; a click outside dismisses the menu and activates the underlying control. At narrower widths they become inset modal sheets. Resize changes the modality and releases/acquires the shared scroll lock; Escape and focus return work in both presentations. Forms and color pickers remain modal.

Inventory changes: `.bs-sheet` and `.sheet` share bounded geometry and opaque content material; `.bs-sheet[data-actions]` shares the existing elevated command recipe, one filter. Removed selection-specific filter/geometry and chat/note/photo background overrides. No extra backdrop layers are added.
