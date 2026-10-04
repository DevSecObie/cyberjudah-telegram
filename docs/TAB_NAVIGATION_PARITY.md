# Tab navigation and Bible Strong

Reference: [Bible Strong `dd02775`](https://github.com/smontlouis/bible-strong/tree/dd02775f82d69401d61f5e37cd63258aa1010d0a), reviewed October 4, 2026. The owner asked for the reference's tab-switcher flow with CyberJudah's styling, Liquid Glass and content. The relevant navigation files in `strong/` match this upstream revision byte for byte.

Previously, opening Tabs replaced the page with the general route fade. Opening a card faded into a newly mounted page; the reader could return to the top, and Back could leave the switcher for Home instead of the selected tab. The grid also sized cards from the entire window, ignoring space reserved for the desktop sidebar.

| Bible Strong behavior | CyberJudah implementation |
| --- | --- |
| `useTabButtonPress` / `minimizeTab`: the active page contracts into its preview | The Tabs control transitions the visible page into the selected card, bringing that card into view. The dock changes to its existing Add / Groups / OK controls with Search retained. |
| `expandTab`: a tapped preview grows into the active page | Card selection and OK use the same return transition. Add opens the existing New Tab page with the same motion. |
| `slideToIndex`: moving among tabs uses one consistent movement | Dock navigation uses a short transform/opacity entrance. Saved tab paths, groups and custom dock choices retain their existing format. |
| Separate active content from the tab grid | The reader's viewport position is retained per tab and path in bounded session memory. Returning to that tab restores its place; new input cancels restoration. |
| Keep list/view controls coherent | Escape and Telegram Back resume the selected tab. Open action sheets still close first. Closing a tab leaves its neighbors intact, settles their positions and returns keyboard focus to the current card. |
| Responsive preview geometry | A ResizeObserver measures the switcher's actual allocation, including the sidebar's reserved space, rather than sizing cards from the whole window. |

## Web motion and accessibility

The native reference uses a 500ms timing curve `(.36, .77, .44, 1)`. CyberJudah uses that curve through `--ease-tab` with its existing 380ms maximum motion token. Supported browsers use temporary View Transition snapshots; unsupported browsers use a transform/opacity entrance. Reduced motion uses a brief opacity change without scaling or translation. Only transform and opacity animate; the existing navigation material remains the only glass layer.

The browser captures only the transition itself. No screenshot, message content or user state is stored as a preview. Existing public Scripture previews and CyberJudah resource labels remain. In-memory scroll positions are bounded and disappear when the page reloads.

The switcher and New Tab module already load with their shared toolbar. Importing their screens directly avoids an unnecessary Suspense/loading-frame detour. Navigation waits for the router's committed destination before measuring the transition target. The gallery/reader contrast rules and all theme, safe-area and reduced-transparency recipes remain shared with the Liquid Glass work.

## Verification

`tab-flow.spec.ts` exercises collapse/expand, unsupported View Transitions, reduced motion, scroll restoration, Escape/Telegram Back, card closing, New Tab, and actual available width at 390/768/1280px with 200% text. The suite runs in Chromium, WebKit and Firefox. Before/after UI and motion evidence, production measurements and completed integration counts are recorded with the review PR.

This is the focused tab-flow comparison requested by the owner. It does not claim that CyberJudah implements every Bible Strong feature, resource or native framework behavior.
