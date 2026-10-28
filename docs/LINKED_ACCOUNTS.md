# Telegram and Firebase account linking

## User flow

On the web Account page, sign in with an existing Firebase Google, Apple or email account, sign in to Telegram, then select **Link this login with Telegram**. Linking requires fresh sign-ins to both (five minutes). The operation is explicit; email/name matching is never used. To add another sign-in method, connect that provider while signed into the same Firebase account. If the provider is already attached to a different Firebase account, sign into that account and resolve the conflict before proceeding; the application does not automatically combine independent accounts.

A Telegram-only reader can choose **Use this Telegram account**, then connect Google, Apple or email to its existing Firebase bridge identity. New email accounts can be created and verified, and password reset uses Firebase's standard email flow.

Once linked, the same existing Ask balance, credit usage history and encrypted chats are used regardless of sign-in method. This release connects a Firebase account to an existing Telegram wallet. A Firebase-only user must link Telegram once before paid Ask access; an independent Firebase-only billing account is not implemented.

Native **Sign in securely** opens the system browser. The reader checks a matching code and explicitly approves the new device. A separate device secret, held only in memory, redeems a Firebase custom token once within ten minutes. Google/Apple login is not run inside the native webview.

## Security and storage

- `account_links` in D1 has unique Firebase UID and Telegram-owner constraints. Telegram IDs are encrypted; wallet ownership remains the existing keyed owner ID. Linking does not change credit lots, payment records or chat keys.
- Firebase ID tokens are sent over HTTPS to Google's `accounts:lookup` for validation. Project/issuer, subject, expiry, issue/auth times, anonymous-provider rejection, returned UID, disabled state and `validSince` revocation boundary are checked. Decoding a JWT alone is never accepted as proof. Google/service outages fail closed as unavailable, distinct from an invalid login.
- Firebase bearer access is limited to Ask, answer reports, chats, personal backup and account-data controls. Personal Telegram delivery, Stars purchases and administration continue to require Telegram credentials. Answer reports use the existing per-reader limit and send only an answer reference and reason to the administrators; web/native users choose the reason inside the app.
- Telegram/Firebase linking and device approval are limited and require recent authentication. Mutating cookie requests retain the same-origin protection. Device exchange uses atomic delete-and-return; public codes cannot redeem a session.
- The Firebase SDK owns local sign-in persistence and token refresh. Google/Apple's resolver is loaded only when the provider button is selected. Account changes clear visible Ask state and invalidate the verified account query; sign-out closes account sync before signing out.
- The custom-token bridge resolves the verified linked Firebase UID. Automatic Firestore sync remains opt-in at build time. It does not merge existing Firestore documents or change previously bound local-data ownership. Export/deletion includes both linked and legacy Telegram study collections. Account-data deletion removes the link, revoking access through existing Firebase tokens, but does not delete the Firebase Auth user itself.

## Configuration and release checks

Read-only Firebase Console inspection on October 27, 2026 confirmed that project `cyberjudah-app` has Google, Apple and email/password enabled. Authorized domains include `cyberjudah.io`, `localhost`, `cyberjudah-app.firebaseapp.com` and `cyberjudah-app.web.app`; the same-email account linking setting is enabled. No console settings changed. This setting does not prove Telegram wallet ownership: the application still requires explicit proof of both accounts. Provider enablement does not establish that OAuth credentials or the complete sign-in flow work.

This workspace has no Firebase CLI credentials. Before deployment, confirm Apple service configuration and the existing Worker bindings `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_AUTH_LIMIT`, `FIREBASE_SESSION_LIMIT`, `PRIVACY_KEY` and Telegram OIDC settings. Do not put a service-account key in the app bundle.

Deploy approval is still required. Test real provider login on the deployed candidate after approval. Local tests use explicit synthetic identities and fake provider responses; they do not prove the production provider configuration works.

Native paid publication additionally requires the work in [STORE_BILLING_SETUP.md](STORE_BILLING_SETUP.md), physical-device handoff tests, account deletion/recovery, signing and store review. Native top-ups are unavailable in this candidate. The older free-reader artifacts do not satisfy the updated scope.

References: [Firebase provider linking](https://firebase.google.com/docs/auth/web/account-linking), [Firebase REST account lookup and revocation boundary](https://firebase.google.com/docs/reference/rest/auth), [Firebase token validation](https://firebase.google.com/docs/auth/admin/verify-id-tokens).
