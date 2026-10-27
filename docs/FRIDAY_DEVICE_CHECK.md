# Friday 30 October 2026 candidate checks

Paid Ask must use the same balance through every linked sign-in. The earlier free-reader APK is superseded. Use a successful PR #415 build containing linked accounts, together with the matching approved backend. A draft PR is not a production deployment. Store products and native purchases are not implemented or configured; do not use real transactions.

Record the build commit, device model, OS, Telegram version/browser, time, exact steps and result. Never include credentials, tokens or private chats in evidence. Back up personal studies before storage or import tests.

## Linked accounts and Ask

1. On the web Account page, sign in with an existing Firebase Google, Apple or email login. Connect Telegram, then explicitly select **Link this login with Telegram**. Both sign-ins must be recent. Verify the original Telegram balance, usage history and chats. Connect additional providers to this same Firebase account; independently established Firebase accounts are not automatically merged.
2. Repeat sign-in through each connected provider. The balance and chats must remain the same. Verify an unrelated account cannot see them. Sign out and back in on a shared device; private content must disappear on sign-out. Attempting to link an already-owned account must leave both accounts and balances intact.
3. In Telegram, verify the original wallet and chats still work after linking. An existing balance must not be duplicated or transferred. On the web, verify browser Telegram sign-in/out as well as Firebase sign-in/out.
4. On a physical iPhone and Android, select **Sign in securely**, match the six-character code in the system browser, approve, then return to the app. Verify the linked account and existing balance. Expired, unapproved and already redeemed sign-in links must fail. Cancelled/interrupted sign-in must allow a fresh attempt.
5. Native Ask must be available after linking, while Stars top-ups and donation controls remain unavailable. Start with balance/history inspection. A paid Ask request requires explicit owner approval. Use only the designated free model for an approved free-answer check; inspect its provider-consent prompt, Scripture citations and return navigation. No purchase or refund is authorized by this checklist.
6. Firebase Console inspection confirmed Google/Apple/email enablement and the `cyberjudah.io` authorized domain on October 27. Verify real sign-in with each provider, plus Telegram OIDC and the Worker bindings listed in [LINKED_ACCOUNTS.md](LINKED_ACCOUNTS.md). Enabled settings and simulated provider tests do not establish a working production sign-in flow.

## Reading, search and navigation

1. Open `https://cyberjudah.io/app/` in Safari/Chrome and the bot mini app in Telegram. Navigate Home → Bible → People → Search → Ask → back. Repeat in the native candidate. Rotate the phone and increase system text size; controls must remain reachable.
2. In People, open Mattathias and follow priestly course Joarib → linked identity Jehoiarib using the candidate that includes PR #414. Read evidence/source labels. Priestly membership must not be shown as a biological parent.
3. Open class notes, drag up then immediately down, and interrupt a drag with a system gesture. The sheet stays reachable. Check Android Back during fast navigation and a slow page load; it must dismiss the visible sheet or return to the intended screen.
4. Save a small Bible book in Downloads while online. Turn on airplane mode, close/reopen the app and read a saved chapter. Search words and quoted phrases from it. The Offline coverage label must count only saved chapters; an unsaved-book filter must not imply that book was searched. Reconnect and confirm live search resumes.
5. Check English Nave list/search, an article, nested Scripture previews and New Tab cards after the Bible Strong update. Follow a Strong's entry, Bible chapter and person result and return without losing the prior screen.
6. Native keyword search must work without sign-in through the candidate public reader API. AI search answers remain excluded from native keyword search. Check an approved library PDF and the missing/unavailable-content state.

## Studies, privacy and audio

1. Create a disposable personal study, export it and restore it as a new copy. Confirm the original survives. Restart the app and phone to check persistence. Local export/restore must remain usable without an account.
2. Test explicit cloud backup/restore and revision conflicts only on a disposable linked test account. Automatic Firestore sync remains disabled in production unless separately configured and approved; do not advertise automatic sync from this candidate alone.
3. Test privacy export with the disposable account. Account-data deletion is destructive and requires that account owner's choice. It currently removes data and revokes the link, but does not delete the Firebase Auth user; complete Auth deletion/recovery before store submission. Never use an account with a real balance for destructive testing.
4. Check licensed recordings and device voices in native Audio settings. Generated audio is excluded. A missing recording should use an available device voice or explain that no English voice is installed. Check foreground, locked-screen and background playback and record host limitations.

## Packages and store gates

Download `cyberjudah-android-debug` from the successful linked-account candidate's `native-build` run for Android testing. The iOS simulator artifact runs in Simulator; the unsigned device archive needs owner signing before iPhone installation. Test safe areas, keyboard layouts, file sharing, process restart, large text and Android Back on physical devices. Browser viewport tests are not physical-device evidence.

Native paid release remains **NO-GO** until store billing, receipt verification, account deletion/recovery, signing, disclosures and physical-device acceptance are complete. Use [STORE_BILLING_SETUP.md](STORE_BILLING_SETUP.md) for the proposed product worksheet and sandbox purchase matrix. Older free-reader artifacts are not evidence for the updated scope.

| Build/commit | Device/OS/host | Check | Result | Screenshot or exact failure steps |
| --- | --- | --- | --- | --- |
| | | | | |

Paid transactions, merge, deployment and store publication each need explicit owner approval. This checklist does not authorize them.
