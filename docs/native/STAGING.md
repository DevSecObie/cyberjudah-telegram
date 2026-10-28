# Device staging builds

Staging uses `io.cyberjudah.app.staging`, display name `CyberJudah Staging`, API and device-login origin `https://cyberjudah-telegram-staging.oisrae1.workers.dev`, and study scope `staging`. Production retains `io.cyberjudah.app` and is the free-first-store profile (`free-study`, paid Ask disabled). Internal staging uses `linked-ask-test` with paid Ask available for shared-account acceptance; purchases remain disabled. The public first release and internal test build must not be interchanged. The environments are a fixed whitelist; a URL or deep link cannot change the API target. Firebase project `cyberjudah-app` is shared, but staging links/wallets and study documents are separate. Production credits are not copied.

Run `npm ci`, then `npm run native:sync:staging --workspace app`. `native-build` produces Android debug APKs, unsigned release bundles, iOS simulator apps and unsigned device archives for both targets. The workflow checks the identifiers in the built APK and iOS bundles. Unsigned iPhone archives cannot be installed on a physical iPhone. Native authentication opens the default browser with a one-time public code; its redemption secret stays in app memory. Do not begin Google login inside a different embedded browser and resume it in Brave/Safari.

## Android

Download the `cyberjudah-staging-android-debug` artifact, unzip it, and install the APK on the test device. Allow installation from the chosen download source when Android asks. It can coexist with production. CI debug signatures can differ between runs, so uninstall an older staging build if Android rejects an update; export test study data before uninstalling.

## iPhone: TestFlight preparation

TestFlight internal testing is the recommended device distribution path. The inspected Mac has command-line developer tools, no full Xcode installation at the usual application locations, and zero valid code-signing identities. Those facts do not establish whether the owner has an Apple Developer membership.

The manual `ios-staging-signed` workflow prepares an App Store-signed IPA but never uploads it or distributes it. Before running it, an Apple Developer account owner must register `io.cyberjudah.app.staging`, create the corresponding App Store Connect app, and prepare an Apple Distribution certificate and App Store provisioning profile. Set the following in GitHub's `ios-staging` environment, using its private secret fields (never a PR, source file or chat):

- Variable `APPLE_TEAM_ID`.
- Secrets `IOS_STAGING_CERTIFICATE_P12_BASE64`, `IOS_STAGING_CERTIFICATE_PASSWORD`, `IOS_STAGING_PROFILE_BASE64`.

Require an owner reviewer on that environment. Review the chosen commit and its CI before allowing signing. The workflow is manual and becomes discoverable once its definition exists on the default branch; this change does not authorize merging it. A certificate/profile for a different app, team, expired profile, development or ad-hoc profile is rejected. Signing files are removed after the job. Upload to App Store Connect and enabling TestFlight distribution require the owner's explicit approval. No App Store or Google Play publication is part of these workflows.

See Apple's [internal testing instructions](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/) and [beta distribution documentation](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases).

## Acceptance on devices

Verify app name; Google/Apple/email sign-in in the same external browser; matching one-time approval code; shared Ask identity after explicit Telegram linking; identical staging balance/history across linked sign-ins; sign-out isolation; offline Bible and downloaded resources; phone rotation, keyboard, safe areas and navigation. Do not buy credits during these checks. Store purchasing products and receipt verification are separate unfinished work.
