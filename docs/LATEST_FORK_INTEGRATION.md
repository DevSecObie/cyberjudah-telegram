# Approved fork integration

The owner approved the latest-source Home, Tabs and New Tab previews with CyberJudah styling and content. The upstream reference is `smontlouis/bible-strong` master at `eed343dcb6a119f048068cf16a4de31fd7bb160c` (8 October 2026), verified against the remote again during integration. The newer commits since the approved preview change the resource publication tooling and catalog; the Expo navigation and reader source are unchanged. The vendored catalog includes those latest updates.

The owner's Latest Teachings screenshot is an explicit requirement within that layout: thumbnail-and-text rows, collection badges, date and teacher, and the All classes link. For the classes of 3 October, the order is Haiti, You Are Hated And In Hell, The Slave Mentality, then Blood Toucheth Blood. This is broadcast order, not a fixed list of titles. Newer classes remain visible above them: the 5 October Day of Atonement class is first in the current published feed. The fork's generic Classes card does not replace a featured class, so the newest teaching must not be removed from its Home list.

## Implemented in the staged fork

- Update the Expo app and the four resource packages from the prior upstream pin, preserving CyberJudah's KJV/Apocrypha, public resource feed, English default, service configuration and security fixes.
- Preserve the approved navigation geometry, CyberJudah palette and navigation glass, including reduced-transparency behavior.
- Add a public, read-only class feed at `/app/strong/_content/teachings`. It uses the same broadcast sorting and series labels as the main app, the existing RSS/channel-page/last-good fallback, and the reader's time zone. Origin failures produce an error rather than a successful empty list.
- Use real CyberJudah thumbnails in the Classes card. Show the existing Latest Teachings rows on Home and populate the upstream Classes library. Noted classes open the existing CyberJudah notes; pending classes open the existing recording screen. Account and note editing rights remain enforced by their existing routes.

- Connect Timeline geometry and details to CyberJudah sources and approved photos, retaining all events and the final Redemption card. Show original source quotations and scripture separately.
- Use the actual Easton dictionary identity and CyberJudah's Strong's publication identity. Browser resource queries use browser connectivity instead of a third-party reachability probe.
- Generate five CyberJudah reading plans from the pinned book/chapter metadata, including the Apocrypha. Keep the upstream plan screens and progress model.
- Configure the owner's Firebase project, keep analytics disabled, and reconcile the owner-supplied rules with private saved-data sync. The base rules were owner-confirmed published on 8 October; the owner also confirmed publishing the revision amendment and delete correction, mirrored locally. Ten rules tests and seven migration-engine tests pass against Firestore emulators. See `strong/firebase/README.md`.
- Add verified Telegram-to-Firebase sign-in with stable `tg_<id>` UIDs, SDK session restoration before minting, and SDK persistent offline caching. Browser bridge tests prove fresh mint counts, cold-start restoration and two-device identity. The owner confirmed configuring the Worker-only service-account secret; live sign-in still needs verification after deployment.

## Remaining before promoting the fork to `/app`

- Independently verify real sign-in and account switching against the owner-published rules, and migrate existing main-app marks/studies without overwriting another account. Firebase identities do not replace the Telegram/browser Worker credentials.
- Connect existing CMS entry points and preserve class, audio, donation and administration destinations during the main-app switch.
- Finish the remaining content/help/share-link adapters. The upstream interlinear coverage requests have no corresponding published CyberJudah resource yet.
- Verify offline installation, free notes, annotations and all reader gestures against the latest reference; successful screenshots alone do not establish feature parity.
- Exercise the fully integrated reader, tabs, content, sign-in, account switching and saved-data migration in the browser before changing the entry point.

The fork remains at `/app/strong`. This work does not change the main entry point or claim that the remaining integrations are complete.

## Verification

The current development checks include the main app/Worker typecheck, unit suites and production build; the fork typecheck and Expo web export; focused upstream identity, passage-media and navigation tests; class ordering, pending-note and outage route tests; and browser captures exercising Home, Tabs, New Tab and All classes. Production-shaped class data was also checked against the owner's reference order.
