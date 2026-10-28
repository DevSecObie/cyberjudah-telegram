# Store billing setup for paid Ask

**Release scope, October 27, 2026:** the owner approved a free first public store release. This worksheet applies to the later paid Ask update. Internal staging continues to test linked accounts and the shared balance; neither profile authorizes real purchases.


Owner decision, October 27, 2026: paid Ask must follow a linked CyberJudah account across Telegram, Google, Apple and email sign-in. Apple and Google purchase products have not been created. Prepare their setup; do not perform transactions, submit builds, deploy or publish.

## Current implementation and release gate

The account-link implementation preserves the existing Telegram wallet, ledger and encrypted conversations. Each Firebase login must be linked once to the Telegram owner; additional providers should be connected to that same Firebase account. It does not merge two independently established Firebase accounts or create a second wallet. An account-link conflict leaves both accounts intact.

Native candidates expose Ask and linked sign-in, but **cannot buy credits inside the app**. No Apple/Google receipt verifier, purchase SDK, store notification handler, store product or signing credential is claimed to exist. Native paid release remains NO-GO until the items below are configured and tested. The earlier free-reader decision and artifacts are superseded.

## Product worksheet for owner review

The provisional package/bundle ID in this repository is `io.cyberjudah.app`. Confirm ownership and register it separately in each store; never use Bible Strong's identifiers. Use consumable, non-subscription credit packs. The following identifiers and credit amounts are proposals to create, not existing products:

| Proposed product ID in both stores | Display name | Ask balance granted | Store retail price |
| --- | --- | --- | --- |
| `cyberjudah.ask.credits.1` | Ask credit — $1 balance | 1,000,000 mc | Owner to choose after fees/tax review |
| `cyberjudah.ask.credits.5` | Ask credit — $5 balance | 5,000,000 mc | Owner to choose after fees/tax review |
| `cyberjudah.ask.credits.20` | Ask credit — $20 balance | 20,000,000 mc | Owner to choose after fees/tax review |

`mc` is the existing ledger unit: one million units equals one US dollar of Ask balance. Store-localized retail prices are distinct from that balance. Do not assume a $1 retail price nets $1 after commission and tax. The existing Telegram conversion depends on Stars payout; it must not be reused for store receipts.

## Apple setup

1. Confirm the bundle ID and Apple Developer team; create the App Store Connect app record and complete paid-app agreements, tax and banking setup.
2. Add the approved consumable products, localized names/descriptions and review screenshots; choose retail prices explicitly. Enable the In-App Purchase capability for the owned application.
3. Create sandbox testers and a local StoreKit configuration. Do not use real purchases for acceptance testing.
4. Provision an App Store Connect/App Store Server API key, issuer ID and key ID as server secrets. Keep the private `.p8` out of repositories, builds and reports.
5. Register App Store Server Notifications V2 URLs separately for sandbox and production when the backend is ready. This document does not authorize deploying an endpoint.

## Google setup

1. Confirm package ownership in Play Console, complete the payments profile and create the application record.
2. Add the approved one-time consumable products and purchase options required by the current console, with matching product IDs and owner-approved regional prices.
3. Configure a license-testing account and internal testing track; account for Play App Signing when registering Firebase signing certificates.
4. Grant a dedicated service account only the Play permissions needed to verify purchases and process voids. Store its credential server-side.
5. Configure Real-time Developer Notifications through the project's Pub/Sub topic and the Voided Purchases reconciliation process when backend endpoints are ready.

## Implementation contract

- Authenticate the current CyberJudah owner before starting a purchase. Generate an opaque stable account association: Apple `appAccountToken` (UUID) and Google `obfuscatedAccountId`. Never send raw Telegram IDs, email addresses or Firebase tokens as purchase metadata.
- Keep the owner fixed across purchase completion. If a user changes accounts mid-purchase, defer fulfillment and verify the original owner; never credit the currently displayed account by accident.
- Apple: verify StoreKit 2 signed transactions and their certificate chain/environment using Apple's supported server library/API. Check the owned bundle ID, allowlisted product ID, transaction ID, revocation status and account token. Treat pending, cancelled and failed transactions as zero credit.
- Google: verify the purchase token with the Android Publisher API for the owned package and allowlisted product. Check purchase state and account association. Acknowledge/consume only after durable credit fulfillment, with retryable server-side recovery.
- Extend the existing ledger with a unique `(store, environment, transaction-or-purchase-token)` key. The verified purchase record and credit grant must commit atomically. Client retries, restored purchases and duplicate notifications must never grant twice.
- Keep sandbox/test grants separate from production balances. Never accept prices, granted amounts, Firebase UID or Telegram owner IDs from a client receipt payload as authoritative.
- Route refunds, Apple revocations and Google voids through idempotent ledger reversals. Preserve required transaction records independently of deletable personal data; describe the retention accurately. Reconcile delayed notifications.
- Use StoreKit/Play product pricing in the purchase sheet. Include confirmation, pending purchase state, retry/recovery, support and purchase history. Consumables already consumed are recovered from the CyberJudah ledger, not by blindly granting every restored transaction.
- Finish Firebase account deletion and linked-account recovery UX, then test fresh-login requirements and failures before store submission. Current account-data deletion revokes the account link; it does not delete the Firebase Auth identity itself.

## Required sandbox evidence

For each store, capture build commit, product ID, sandbox transaction reference (redacted), owner association and before/after balance:

- Successful test purchase grants exactly one approved pack.
- Cancellation, pending approval, failed verification and wrong bundle/package/product grant nothing.
- Duplicate client requests/notifications and interrupted network recovery grant once.
- Two devices signed in through different linked providers see the same balance and usage history.
- Account switch during purchase cannot transfer the grant; an unrelated account cannot claim the receipt.
- Refund/void handling is idempotent; spent and unspent credit handling matches the published terms.
- Store-managed account, privacy and deletion controls work on physical iPhone and Android devices.

## References checked October 27, 2026

- [Apple App Review Guidelines, section 3.1](https://developer.apple.com/app-store/review/guidelines/): native digital purchases and multiplatform access requirements, with market-specific exceptions.
- [Google Play payments policy](https://support.google.com/googleplay/android-developer/answer/9858738): digital features and applicable billing/alternative-program rules.
- [Firebase account linking](https://firebase.google.com/docs/auth/web/account-linking): connect providers to the same Firebase user; do not merge by matching emails.
- [Bible Strong source reviewed](https://github.com/smontlouis/bible-strong/tree/39d878091d12c0f8074464f5ff79fa4bb94f737f): reference for provider and account-recovery behavior, not a source of CyberJudah store ownership or billing configuration.

- [Apple consumable product setup](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-consumable-or-non-consumable-in-app-purchases).
- [Google one-time purchase lifecycle](https://developer.android.com/google/play/billing/lifecycle/one-time): server verification, account association, acknowledgment and consumption.
