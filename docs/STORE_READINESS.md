# Web release and native preparation

The current app is `app/`. Personal studies, phrase marks and reading plans use the same reader in Telegram and on the website. Native projects bundle this app; they do not replace it with the separate Bible Strong Expo fork or the discarded workspace prototype.

## Desktop Telegram login

Based on [Telegram Login's official OIDC documentation](https://core.telegram.org/bots/telegram-login):

1. Open the existing bot in BotFather's Login Widget settings. Register `https://cyberjudah.io` and the exact redirect `https://cyberjudah.io/api/auth/callback`. Keep the default RS256 signing algorithm.
2. Save the issued values as Actions secrets `TELEGRAM_LOGIN_CLIENT_ID` and `TELEGRAM_LOGIN_CLIENT_SECRET`. Never put them in source files or chat. Both must be set together. Production deploy installs them on the Worker; credentials configured directly on the Worker are retained when Actions secrets are absent.
3. Deploy and test a real desktop sign-in, logout, account backup download/restore, stale-revision conflict, and account deletion using an intended test account. Unit tests simulate Telegram's signed tokens; they do not prove real BotFather configuration.

The backend verifies state, PKCE, signature, issuer, audience, expiry and nonce before creating an encrypted, one-day session. Mutations using session cookies require the same origin. Invalid Telegram launch data cannot fall back to browser cookies. Cloud study backups require explicit user action, use revision checks, and are included in privacy export/deletion. Existing `PRIVACY_KEY` must never be rotated casually.

Without configuration, sign-in remains unavailable; local reading and studies remain usable. The app does not manufacture a Telegram identity from a display name or OIDC subject.

## Timeline editor

Public Timeline reading does not need GitHub credentials. Its administrative editor needs `APP_REPO_TOKEN` scoped to this app repo, as documented in [CMS.md](CMS.md). Add the secret through GitHub settings (or the Worker secret store), then run production deployment and the `verify-release` workflow. A green deploy alone does not establish that all CMS kinds are configured.

## Native build evidence and remaining release gates

Run `npm run native:sync --workspace app` after web changes. CI compiles Android debug/lint plus an unsigned release AAB, and an unsigned iOS simulator app plus a device archive. The debug APK can be used for Android testing; the release AAB/device archive still require owner signing and store validation. No CI step submits them. Android uses API 36 and Java 21; iOS uses Swift Package Manager. The provisional application identifier is `io.cyberjudah.app`; register/confirm ownership before signing. No signing keys or store account credentials are committed.

The owner chose **free reading and study for the first public store release** on October 27, 2026. Paid Ask belongs in a later update after store billing is implemented and verified. This supersedes the earlier same-day paid-from-day-one decision. The production native target is now `profile: free-study` with `paidAsk: false`; its Home, Menu, New Tab and command palette omit Ask, and a saved or direct Ask route returns to the Bible. Account entry no longer advertises an Ask balance. This build configuration does not publish an app.

The internal staging native target remains `profile: linked-ask-test` with `paidAsk: true` so the owner can test shared identities, balance and chats. Its separate app ID, API origin and study scope remain unchanged. Google, Apple and email use Firebase; linking requires fresh Telegram and Firebase proof. The stable Telegram wallet remains the Ask owner, so no credit transfer or duplicate grant occurs. Native sign-in opens the system browser and redeems an explicitly approved, short-lived, one-use handoff with a separate device secret.

Native top-ups remain disabled in both profiles. Store products are not configured. [STORE_BILLING_SETUP.md](STORE_BILLING_SETUP.md) is preparation for the paid update, not a first-release billing gate. The free first release is still **NO-GO** until the actual Bible Strong sign-in/profile UI is integrated, Firebase-only account deletion/recovery works, signing and physical-device checks pass, and store disclosures/listings are complete. The existing browser device-approval page still shows the shared-account UI; it must be brought into the free release's upstream sign-in flow before submission. Production automatic study sync also remains disabled pending its configuration and lifecycle acceptance; do not advertise it as tested or enabled.

Reading, downloaded-chapter search and reference tools remain available without an account. Native content uses the public read-only `/api/reader/*` routes and a separate `READER_LIMIT` binding. AI search answers, generated audio, Telegram delivery, donations and admin controls remain excluded from the native profile. These exclusions are independent of paid Ask access. Cloud study backup shares the linked owner; automatic Firestore sync remains controlled by `VITE_ACCOUNT_SYNC`. Linking does not silently merge existing Firestore documents or reassign previously bound local study data.


These builds are development artifacts. Before store submission:

- Enroll the owner in Apple Developer and Google Play Console, register the app IDs, and configure protected signing credentials.
- For the later paid update and internal staging, verify native Ask on physical iPhone and Android: sign in in the system browser, match the device code, link Telegram once, verify the same balance/chats from each connected provider, sign out, and confirm no private history leaks. Confirm purchase controls remain unavailable until verified store billing is configured.
- For internal staging and the later paid update, verify Report this answer with each linked sign-in and confirm administrator delivery using an intended test report. The native/web reason chooser stays inside the app and does not send the question, answer text or reporter identity. Review the [Google Play AI-generated content requirements](https://support.google.com/googleplay/android-developer/answer/13985936?hl=en) against the final candidate.
- Verify reader, saved studies after process/device restarts, import/export, offline downloads, audio, accessibility and back navigation on physical iPhone and Android devices. Browser viewport/engine tests are not physical-device tests.
- Complete listing assets, privacy/data-safety disclosures, age/content ratings, support details and account deletion review. Audit bundled SDKs and iOS privacy declarations against the actual final app.

Official implementation references: [Capacitor iOS deployment](https://capacitorjs.com/docs/ios/deploying-to-app-store), [Android deployment](https://capacitorjs.com/docs/android/deploying-to-google-play), [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play policy center](https://play.google.com/about/developer-content-policy/). Recheck these at submission. CI compilation alone is not store approval or full Bible Strong feature parity.


## Bible Strong reference

The current upstream reviewed for the Friday fixes is [`39d8780`](https://github.com/smontlouis/bible-strong/tree/39d878091d12c0f8074464f5ff79fa4bb94f737f), including `apps/expo/app.config.ts`, `eas.json`, `src/helpers/FireAuth.ts`, `authSessionRecovery.ts`, and `features/search/usePassageSearch.ts`. Its separated development/staging/production profiles and native authentication inform this checklist. CyberJudah keeps its own application ID, reader, Telegram identity model and content. Never copy upstream signing identifiers, Firebase accounts or store submission IDs into CyberJudah.

Physical-device checks and evidence fields are in [FRIDAY_DEVICE_CHECK.md](FRIDAY_DEVICE_CHECK.md). A green archive build demonstrates packaging, not authenticated native account support, payment approval, or successful store review.
