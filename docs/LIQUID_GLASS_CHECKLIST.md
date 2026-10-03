# Liquid Glass adoption review

This is the web adaptation of Apple's [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), reviewed on October 3, 2026, for the React/Vite Telegram Mini App. Native framework APIs are mapped to browser behavior; this does not claim that a web backdrop filter reproduces Apple's system renderer. The Worker API, teaching content, routes, deep links and saved choices remain outside the visual redesign.

**Status key:** Done means the web requirement is implemented and covered by the linked evidence. Adapted means the stated browser equivalent is implemented, with platform limits named. Not applicable means the app has no corresponding native surface. Platform follow-ups remain explicit below.

## Recommendation-by-recommendation mapping

| Apple recommendation | Status | Implementation and evidence |
| --- | --- | --- |
| Build with the latest SDKs and see standard components adopt the material | Adapted | This app has no SwiftUI/UIKit/AppKit target. Shared React controls, CSS recipes and browser projects provide the equivalent review surface. [Design system](DESIGN_SYSTEM.md). |
| Use system frameworks and reduce custom backgrounds on navigation | Adapted | Shared navigation/elevated material recipes; TelegramUI content maps to an opaque surface. Removed nested selection blur and the photo bar's hard-coded translucent fill. [#111](https://github.com/DevSecObie/cyberjudah-telegram/pull/111). |
| Test display and accessibility settings | Done | Light/dark/sepia and eight reader palettes; reduced transparency in the app and Chromium OS emulation; reduced motion, increased contrast, forced colors, 200% text and Telegram safe insets. Firefox's live media emulation limitation and WebKit OS-transparency limitation are documented, not counted as device verification. |
| Avoid overusing Liquid Glass | Done | Content cards, rows, prose and images stay opaque. At most two visible backdrop filters at rest, three with a menu. No SVG refraction, glass on glass or animated blur. Computed-style route budget tests count real and pseudo-element surfaces. |
| Optically balance and simplify the icon | Adapted | The existing blue cybernetic/gold natural lion becomes editable filled vector paths with small-size previews. [#117](https://github.com/DevSecObie/cyberjudah-telegram/pull/117). |
| Let the system apply icon masking and effects | Done | Opaque full-bleed squares have no baked corner mask, shadow or gloss; pixel checks verify opaque corners and the PWA safe circle. |
| Design foreground, middle and background icon layers | Done | [Editable SVG, three PNG layers and export instructions](../design/icon/README.md). |
| Provide default, dark, clear and tinted icon appearances | Adapted | Local light/dark PNGs, clear SVG and single-ink monochrome artwork. Browser media queries select the favicon where supported; the web manifest cannot select native dynamic layer appearances. |
| Compose and preview in Icon Composer | Adapted | Layers and import instructions are ready. Native preview requires macOS/Icon Composer and remains a follow-up; this Linux environment cannot run it. |
| Preview against updated icon grids | Adapted | Small-size previews, illustrative masks and measured PWA safe zone are included. Apple's template CDN returned 403; official-grid validation remains a follow-up. Illustrative masks are labeled accordingly. |
| Review control shape and dimensions, including larger controls | Done | Capsule buttons/chips/segmented controls, shared size tokens and an extra-large CTA style. [#102](https://github.com/DevSecObie/cyberjudah-telegram/pull/102). |
| Lift slider/toggle knobs into glass during interaction | Adapted | Solid resting knobs gain a light fill, rim and shadow while pressed. Reduced motion removes scale; reduced transparency uses solid fills. No extra backdrop filter is added. |
| Morph buttons into menus/popovers | Adapted | Named View Transitions with transform/opacity animation, source anchoring and an animated fallback; keyboard/focus behavior is tested. [#110](https://github.com/DevSecObie/cyberjudah-telegram/pull/110). |
| Use color judiciously, with light/dark and increased-contrast variants | Done | Separate light/dark/sepia increased-contrast tokens and computed semantic inks across all eight saved palette grounds. [#115](https://github.com/DevSecObie/cyberjudah-telegram/pull/115). |
| Avoid crowding or overlapping controls | Done | Shared spacing/touch targets, overflow handling and 200% layout checks. Controls share a single bar material rather than stacking filters. |
| Keep controls legible above scrolling content | Adapted | One shared scroll-edge fade follows each navigation bar's material. Solid/reduced/forced-color fallbacks remove the fade; the reader header has scroll regression coverage. |
| Use concentric rounded shapes | Done | Inner radius derives from outer radius minus inset, with a minimum radius. Applied to sheets/cards, bar controls, selection pill, fields, segments and menu items. |
| Use standard button styles | Adapted | Closed shared set: glass for navigation, prominent, bordered and plain. Accent fills use `--on-accent`. |
| Separate navigation hierarchy from content | Done | Floating dock/sidebar/header/menu layers, opaque content below; material inventory documents every justified filtered surface. |
| Adapt tab bars into sidebars | Adapted | A 900px breakpoint reserves sidebar width, accounts for safe areas and preserves controls at short heights/large text. [#102](https://github.com/DevSecObie/cyberjudah-telegram/pull/102). |
| Use split views for sidebar/inspector layouts | Adapted | CSS layout reserves space for the existing sidebar and reflows the content at arbitrary widths. There is no separate inspector feature to add. |
| Check sidebar/inspector safe areas | Done | Tests cover arbitrary window widths, safe-left/right/top/bottom and 200% text; Telegram's own header/back button remain SDK-managed. |
| Extend content beneath sidebars | Adapted | Existing approved Timeline period art and class-note posters have a decorative mirrored extension under the sidebar, using its single material. Library lists have no hero image to extend. No additional filtered layer or new artwork is introduced. |
| Choose tab-bar minimization behavior | Adapted | The dock recedes on deliberate downward reading, returns on upward input/tap, and stays expanded on desktop. Search remains independently available when minimized. |
| Use standard menu icons | Adapted | One shared icon vocabulary for common actions, with matching labels and destructive actions grouped last. |
| Match contextual-menu and swipe actions | Not applicable | Saved chats and bookmarks have visible delete controls; Tabs swipes change groups. None has a row swipe-action menu to reorder. No new gesture or feature is introduced solely for this redesign. |
| Group related toolbar actions with appropriate spacing | Done | Related controls share one tinted group on the bar's single backdrop; unrelated groups use shared spacing. |
| Prefer common icons and consistent presentation within groups | Done | Common toolbar commands use the shared SVG vocabulary and consistent group presentation. |
| Give every icon an accessibility label | Done | Icon-only buttons have accessible names/tooltips; decorative SVGs remain hidden from the accessibility tree. |
| Audit toolbar customizations and hide whole toolbar items | Done | Removed competing fills and avoid invisible interactive slots. Existing reachability/action-count checks remain. |
| Support arbitrary window sizes and fluid columns | Done | Responsive CSS and sheet tests at phone/tablet/desktop/intermediate widths; no native window-management API exists in a Mini App. |
| Use layout guides and safe areas | Adapted | CSS safe-area tokens combine browser and Telegram content insets. Native window controls remain outside the page. |
| Increase sheet corner radius, inset half sheets and make full sheets opaque | Done | Shared auto/half/full recipes, safe gaps, concentric inner controls and opaque full forms. [#112](https://github.com/DevSecObie/cyberjudah-telegram/pull/112). |
| Check content around sheet edges | Done | Insets, 200% text, arbitrary sizes, selection action reachability and photo-frame resizing are covered. |
| Audit backgrounds inside sheets/popovers | Done | Shared recipes supply the only effect; body rows/cards stay opaque and do not add nested blur. |
| Anchor action sheets to their source and leave surrounding content usable | Adapted | Desktop action menus anchor to the invoking control and allow the first outside interaction; phone/full forms retain appropriate modal behavior. |
| Increase list/form row heights, padding and section corners | Done | Shared grouped rows/forms, 56px minimum row recipe, generous inset and section radii. [#114](https://github.com/DevSecObie/cyberjudah-telegram/pull/114). |
| Use title-style capitalization for section headings | Done | Removed all-caps transforms and excess tracking; a source check prevents new uppercase transforms without an explicit reviewed exception. Data/acronyms keep their meaning. |
| Adopt grouped forms | Adapted | Shared `FormSection` uses semantic fieldsets/legends and the grouped layout tokens. |
| Move the Search field with the keyboard | Adapted | Visual Viewport and Telegram viewport events position the phone field above the keyboard, reserve result space and restore the dock. iOS/Android viewport models are emulated; physical Telegram testing remains a follow-up. [#116](https://github.com/DevSecObie/cyberjudah-telegram/pull/116). |
| Use a semantic trailing Search tab | Adapted | One always-present round Search control follows custom navigation and Menu. Saved arrays are not migrated; chosen other controls remain editable. |
| Test across platforms, devices and input methods | Adapted | Chromium, WebKit and Firefox browser coverage; pointer, keyboard and Chromium real-touch protocol checks. Browser emulation is not certification of physical devices. |
| Adopt watchOS toolbar/button APIs | Not applicable | No watchOS app target exists. |
| Adopt tvOS focus APIs and supported-device fallback | Not applicable | No tvOS app target exists. Web keyboard focus and solid material fallbacks are covered independently. |
| Combine custom glass using `GlassEffectContainer` | Adapted | Shared bar/group pseudo-elements provide one backdrop rather than one per button. The material-budget suite covers 18 routes and menu states. |
| Profile and improve performance across platforms | Adapted | Production 4× CPU profiles include dock drag, first sheet, menu morph and reader scroll. Palette calculations are cached, pill variables stay on the pill, static icons are reused, and only named popover snapshots animate. See the [measurement record](../app/e2e/review/glass-10/README.md) and [#118](https://github.com/DevSecObie/cyberjudah-telegram/pull/118); the 16ms target remains unmet. |
| Use `UIDesignRequiresCompatibility` to retain legacy native appearance | Not applicable | No native Info.plist/Xcode target exists; CSS support queries and accessibility preferences select the web fallback. |

## Evidence and practical limits

### Bible Strong reference

The reader reference is [smontlouis/bible-strong at `dd02775`](https://github.com/smontlouis/bible-strong/tree/dd02775f82d69401d61f5e37cd63258aa1010d0a), checked against upstream on October 3, 2026. Of 65 relevant files in this repository's `strong/` snapshot, 62 match the upstream Git blobs; the three differing verse/media/action files were read directly from that pinned upstream revision for this review.

| Reference behavior | CyberJudah adaptation |
| --- | --- |
| `SelectedVersesModal`: native tabbed action groups and highlight strip | Preserve the compact selection sheet and its Annotate/Study/Share controls. Upstream's separate web implementation expands all groups to a 900px row; that is not the existing Telegram phone interaction. |
| `BibleOptionsMenu` and `ContextualPanel`: actions anchored to the invoking control, separate presentation from feature state | Shared menu/popover hosts retain existing Scripture actions, keyboard focus and dismissal. Routes and reader state remain owned by their current features. |
| Web panels forward the active palette onto body portals | People/gallery portals use CyberJudah's root theme tokens, including increased contrast. |
| `Verse` fades unselected context to 30%; gallery captions also use opacity | Semantic ink preserves readable context and captions at AA contrast. The selected verse still has its underline. This intentional adaptation follows the accessibility requirement in the Liquid Glass brief. |
| Media/people overlays animate an extra backdrop blur | Content galleries are opaque; shared navigation materials carry glass. Blur is never animated or added to content. |

The reference's home navigation and controls are being compared separately following the owner's request. That interaction review will retain CyberJudah's content and visual system; these reader/material checks do not claim complete application feature parity.

Each section's PR maps the relevant Apple guidance to its implementation and records visual assertion changes, browser checks and performance samples. Actual before/after review images are under [`app/e2e/review/`](../app/e2e/review/), grouped as `glass-01` through `glass-10`. Section 09 images are explicitly labeled artwork previews, not installed-native-app screenshots. The [design system](DESIGN_SYSTEM.md) records the material inventory, tokens, button/control states, concentric radii, sheet sizes, title case, contrast rules and sidebar breakpoint.

The contrast audit checks rendered text and semantic foreground/background pairs at unchanged AA thresholds, including black/white behind glass. Final interaction review also covers selected-verse context, the version picker, chapter people and class-gallery captions; it waits for opening animations before sampling. Opacity dimming is replaced by readable semantic text colors, and gallery content is opaque. Selection underlines and authored highlights retain their meaning. Image-backed content and reader-authored annotation colors need contextual review; the automated result does not certify arbitrary imagery or user colors.

Full local suite and CI results are recorded in the PRs and the [running work log](https://github.com/DevSecObie/cyberjudah-telegram/blob/codex/log/docs/vault/Codex%20log.md). Existing environment-dependent skips remain identified. The lists run recorded one upstream transcript DNS failure; the unchanged case subsequently passed both isolated retries. The original failed run is retained rather than relabeled as entirely passing.

## Follow-ups

- On the Silicon MacBook, import the three icon layers into Icon Composer and review Apple's official current grids and native default/dark/clear/tinted appearances. The web exports are ready; native verification is pending.
- Test Search/keyboard movement, safe areas, touch cancellation and accessibility preferences on physical Telegram iOS and Android devices. These were unavailable to the cloud environment.
- Review remaining cold-open/first-layout timing on representative devices. A 60Hz display naturally reports about 16.7ms between refreshes; this does not establish that every main-thread work interval meets the requested 16ms target. Keep any observed slow frames and raw measurements visible in performance review.
- Recheck image-backed text and custom annotation colors when content or user palette choices change.
