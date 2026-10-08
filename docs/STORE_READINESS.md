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

Run `npm run native:sync --workspace app` after web changes. CI compiles Android debug/lint and an unsigned iOS simulator app. Android uses API 36 and Java 21; iOS uses Swift Package Manager. The provisional application identifier is `io.cyberjudah.app`; register/confirm ownership before signing. No signing keys or store account credentials are committed.

These builds are development artifacts. Before store submission:

- Enroll the owner in Apple Developer and Google Play Console, register the app IDs, and configure protected signing credentials.
- Implement and verify native Telegram authentication with a secure app return flow. Browser cookies and Telegram Mini App launch data are not native app authentication.
- Decide the native Ask/payment offering and implement the required store billing path if paid digital features ship. The Telegram Stars payment flow is not proof of native billing support.
- Verify reader, saved studies after process/device restarts, import/export, offline downloads, audio, accessibility and back navigation on physical iPhone and Android devices. Browser viewport/engine tests are not physical-device tests.
- Complete listing assets, privacy/data-safety disclosures, age/content ratings, support details and account deletion review. Audit bundled SDKs and iOS privacy declarations against the actual final app.

Official implementation references: [Capacitor iOS deployment](https://capacitorjs.com/docs/ios/deploying-to-app-store), [Android deployment](https://capacitorjs.com/docs/android/deploying-to-google-play), [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google Play policy center](https://play.google.com/about/developer-content-policy/). Recheck these at submission. CI compilation alone is not store approval or full Bible Strong feature parity.
