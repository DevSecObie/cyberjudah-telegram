# CyberJudah Firebase

The fork uses the owner's `cyberjudah-app` project for Bible Strong's account and personal-data sync. The web configuration in `apps/expo/.env.production` and `.env.development` is public browser configuration, not an administrator credential. Analytics stays disabled. The fork does not authenticate against the upstream project's Firebase instance.

## Project state confirmed by the owner on 8 October 2026

Email/Password and Google are enabled; `cyberjudah.io` is authorized. Apple was already enabled and was left unchanged. The default Firestore database exists in `nam5` and contains `root` and `users`. Do not create a replacement database.

The active September 8 rules supplied by the owner allow all signed-in users to read every document, allow a study update based only on its incoming owner, and omit write access to personal subcollections. The replacement rules here:

- Make `users/<uid>`, saved subcollections and `users-status/<uid>` private to their owner, including legacy data on the user document.
- Allow the latest fork's note/highlight/tab migration and sync; reject unknown subcollections and arbitrary deeper paths.
- Require both the existing and incoming study owner to match on updates. Shared studies remain readable by signed-in readers, as before.
- Preserve signed-in reads of `root/**`, and public reads of `stats/**`, `verse-commentaries/**`, `plans/**` and `changelog/*`. These shared collections stay read-only to clients, except the legacy plan download counter may increment by exactly one.
- Permit reads of announcements explicitly marked published; drafts remain inaccessible.

There is no broad signed-in read fallback. Unlisted collections are denied. The owner reported only `root` and `users`; review any additional legacy shared collection before applying these rules. This does not inspect or reclassify the existing contents of `root`, and does not grant Telegram admin rights. `ADMIN_IDS` still controls Worker administration.

## Apply the reviewed rules

The owner authorized nested note/study revision access on 8 October and the subsequent top-level revision update/delete split. The local rules include both exact amendments. The owner confirmed publishing the corrected amendment on 8 October; no other rules changes are authorized.

The owner confirmed publishing this replacement on 8 October 2026. That is owner confirmation; this environment has not independently read the deployed rules or tested live sign-in. The local emulator tests do not update production. From this directory, with the owner's Firebase CLI account authenticated:

```sh
npm ci
npx firebase deploy --project cyberjudah-app --only firestore:rules
```

Alternatively open **Firestore Database → Rules** in [cyberjudah-app](https://console.firebase.google.com/project/cyberjudah-app/firestore/rules), replace the editor with `firestore.rules`, and publish. Retain the previous published version in history for rollback. No documents are rewritten by a rules deployment.

`firestore.indexes.json` lists the fork's proposed indexes. Compare it with the existing project's indexes before deploying indexes; do not remove unrelated existing indexes. The rules command above changes neither indexes nor Functions, Hosting or Storage rules. The public web configuration does not grant permission to deploy.

## Local verification

```sh
npm ci
npm test
```

Tests use the `demo-cyberjudah` emulator project, never production data. Java 21 is required. They exercise owner isolation across every saved collection, unauthenticated refusal, shared-study takeover prevention, legacy note migration and tab queries, existing shared-content reads, restricted counters, and private connection status. CI runs the same suite.

This directory's lockfile overrides vulnerable transitive dependencies of the emulator CLI: gRPC, OpenTelemetry core, basic-ftp and gaxios's UUID dependency. The scoped Chokidar 4 override removes the unpatched `braces` dependency from Firebase Tools. This CLI installation is tested for Auth and Firestore emulators only; it is not the toolchain for Functions development or production deployment. Recheck these overrides when upgrading Firebase Tools, and remove them when its own dependency tree supplies the fixes.

Real sign-in and two-device sync must still be checked after the rules are published. Emulator and mocked adapter tests are not proof of production Firebase access.

## Browser sync verification

After installing the fork and root dependencies, run from the repository root:

```sh
sh strong/firebase/build-test-web.sh
STRONG_WEB_DIST="$PWD/strong/dist-auth" npm run test:web --prefix strong/firebase --workspaces=false
```

This separate export uses only the `demo-cyberjudah` Auth and Firestore emulators. The browser refuses emulator connections unless both the app origin and emulator host are loopback and the project starts with `demo-`. Production builds have no emulator setting. The test creates disposable emulator accounts, saves a note through the real UI, opens it in a second browser, and verifies isolation after sign-out/account switching. Nothing sends test accounts or notes to the live Firebase project.

Both export scripts clear Expo's transform cache before building and verify the inlined project ID. This prevents a preview's cached Firebase/App Check values from leaking into another export.

## Telegram identity bridge setup

`POST /api/firebase/token` accepts only verified, fresh Telegram `Authorization: tma ...` launch data. The Worker derives `tg_<Telegram ID>` and signs a one-hour Firebase custom token. The client waits for the SDK's persisted-session restoration first; restored sessions only verify the matching identity through `/api/firebase/identity`. Firebase handles ID-token renewal itself. There is no hourly mint job and no D1 copy of notes or tokens.

The owner confirmed that `FIREBASE_SERVICE_ACCOUNT` is configured on the Worker on 8 October. This environment has not read the secret or verified live minting. For setup or rotation, create a dedicated service account in **cyberjudah-app → Google Cloud → IAM & Admin → Service Accounts**, create its JSON key, and store the complete JSON as the Cloudflare Worker secret **`FIREBASE_SERVICE_ACCOUNT`**. Use the Cloudflare dashboard secret editor or, from the owner's authenticated machine:

```sh
cd bot
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT < /path/to/private-service-account.json
```

Do not paste the JSON into chat, commit it, put it in an `EXPO_PUBLIC_*` variable, or upload it as a build artifact. Local signing does not need a Firestore administrator role or an IAM signBlob grant. The account must belong to `cyberjudah-app`; the Worker rejects a key for another project. Protect and rotate this key as an authentication credential. A repository Actions secret of the same name is optional: the production workflow installs it when supplied and otherwise preserves a directly configured Worker secret. Staging needs its own explicitly configured binding.

The `FIREBASE_AUTH_LIMIT` Worker binding limits minting to ten requests per verified Telegram UID per minute. Missing signing configuration or rate-limit binding fails closed with HTTP 503. No key is available in this development environment; bridge tests generate disposable local keys and exchange tokens only with the official Auth emulator. Production signing and provider login are still unverified; owner confirmation establishes configuration, not a live sign-in test.

Migration traces, the two versioned commit points, tested retry behavior, and remaining conversion/cutover work are recorded in [FIREBASE_IDENTITY_MIGRATION.md](../../docs/FIREBASE_IDENTITY_MIGRATION.md). The migration engine is not yet invoked by normal sign-in; it must not mark legacy data migrated before all converters and UI readers are ready.
