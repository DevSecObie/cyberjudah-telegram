# Native account deletion contract

`DELETE /api/native-account-data` uses a recently authenticated Firebase bearer token. It accepts no body, UID, document path, or scope parameters. Google verifies the token and its current account state; authentication and per-person rate limits run before deletion. No Telegram link is required. An existing server-verified link adds the legacy Telegram UID to cleanup, and remains available if cleanup must be retried.

The response is `{ "version": 1, "uid": "<verified subject>", "firestoreDeleted": true, "removed": 0 }` only after all discoverable Firestore writes have been acknowledged. The client must validate the version, subject and acknowledgment before deleting Firebase Auth. It separately removes published studies before this call. This endpoint neither deletes Auth nor changes the publication API's meaning.

Errors return no private document paths or credentials. Unavailable configuration, failed enumeration, excessive recursion, or a failed/missing per-write status returns 503. Children at every deeper level must succeed before any parent deletion starts. Repeating the operation after a lost response or partial success is supported. The client keeps its login on timeout, missing endpoint, malformed acknowledgment or server failure; it must not fall back to listing documents itself.

## Historical ownership gate

`ACCOUNT_DATA_DELETION_READY` is deliberately absent from deployment configuration. Only the literal string `true`, with Firestore configured, opens account-data deletion. The same assertion guards native deletion and `deleteData`, which is used by Telegram and browser deletion. Every other value rejects before removing any account data, browser session or account link. Native and browser endpoints return 503; Telegram reports unavailability instead of a success summary. The old native-only flag is no longer used. This is a release gate, not a substitute for reconciliation.

Recursive traversal can discover missing parents under `users/{uid}` and `staging_users/{uid}` because the path retains ownership. A deleted top-level study parent loses the owner field used by the query. Revision payloads alone are not universally trustworthy owner evidence: historical rules authorize through a parent and do not enforce every revision owner field.

A safe reconciliation preserves ownership evidence before it deletes anything:

1. Inventory missing top-level study parents and their descendants read-only. Match only to trusted retained parent records, backups, or a server-controlled ownership ledger. Record source evidence and conflicts per study; missing or contradictory ownership remains unresolved.
2. Keep any resolved owner ledger server-controlled and immutable to clients. Delete its entry only after every descendant is acknowledged. Do not recreate private study content or infer ownership from a caller-supplied study ID, display name, or unenforced revision field.
3. Ordinary study deletion and queued replay now use `DELETE /api/native-studies/:scope/:id`. The server verifies the parent owner, deletes descendants, and atomically creates a server-only `study_deletion_owners/{root}:{id}` record while deleting the parent with an update-time precondition. A concurrent parent edit aborts that commit. A second traversal removes late revisions; failures remain retryable through the ledger. Account erasure discovers these ledger-owned histories and removes the ownership records last. Already-existing clients that bypass this route and simultaneous account-wide writes still require a reviewed rollout/rules contract.
4. Reconcile historical records through a reviewed dry run, verify isolation and interruption/retry against the actual service contract, and verify deployed configuration/rules. The readiness gate stays closed while any of these conditions is unproven. Enabling it or deleting real records is a separate production action.

`inventoryOrphanedStudyParents` provides the read-only first step for an authorized administrative execution. It paginates both top-level study collections with missing-parent placeholders and a `user.id` projection, returns only orphan parent names, performs no writes, and explicitly reports `ownershipResolved: false`. It is not exposed through HTTP. Its emulator result does not establish production inventory or ownership; trusted evidence must still be supplied and reviewed.

`bot/scripts/inventory-study-orphans.mjs` runs that inventory using an existing `FIREBASE_SERVICE_ACCOUNT` environment binding or `--credential-file`, and requires `--output` to create a new private report (0600). It refuses every Firestore request except projected GET listings of the two study collections, never prints credentials or orphan paths, and does not overwrite reports. `--emulator` accepts only loopback and records the demo project in its output.

The ordinary-study route defaults closed unless `NATIVE_STUDY_DELETION_READY=true`. Before enabling it, verify historical ownership and deployed rules that deny client reads/writes to `study_deletion_owners`, deny client parent-only deletes and block writes and revision reads for ledger/quarantined IDs; both clients and queued replay must use the reviewed route. A stale or unavailable endpoint leaves the deletion queued rather than falling back to a parent-only delete. The new ledger records only ownership proven from a live parent; it is never used to guess ownership of older unrecorded orphans.

The endpoint's unit and local Worker tests are not evidence that historical production orphans have been reconciled. A release with the gate closed cannot claim a functioning complete account-deletion flow. A release with the gate opened without reconciliation cannot claim complete erasure either.

## Historical ID reuse and unresolved ownership

A missing top-level parent with surviving revisions can be recreated under another account under the earlier create rules. Revision access in the mobile rule file then follows the replacement parent. A live parent today is therefore not sufficient evidence of ownership of all historical revisions. The inventory lists missing parents; it cannot detect IDs already reclaimed before inventory. No production exploitation or absence of orphans has been established.

The proposed rules deny recreation when a server-controlled ledger entry exists and deny revision reads for that ID, including when a replacement parent already exists. An approved reconciliation may quarantine a known uncertain ID with `version: 1`, `state: "ownership-unresolved"`, `studyRoot`, and `studyId`, without a `user.id`. This blocks access without falsely assigning the history to a claimant. Neither inventory nor tests create production quarantine records. Unknown or contradictory owners must stay unresolved until a trusted retained parent, backup, or audit evidence proves ownership; arbitrary revision fields do not do so. Do not erase or assign those records based on the current parent alone.

Both rule candidates still differ in other policies: the Telegram repository permits broader study reads. Select and review the actual deployed rules before any release; running the candidates in an emulator does not establish production policy. Historical reconciliation, prevention of old-client bypass and account-wide concurrent writes remain prerequisites for both readiness flags. Account-wide write exclusion and all-channel publication retention still require acceptance review; these patches do not certify them.

## Read-only inventory with an existing Google identity

In an environment already signed in to Google with authorized Firestore read access, from this repository with its dependencies installed:

```sh
node bot/scripts/inventory-study-orphans.mjs --gcloud --output /private/path/orphan-inventory.json
```

The runner captures `gcloud auth print-access-token --quiet` in memory, never prints it, and never calls login, creates credentials, changes IAM or writes Firestore. An existing `FIREBASE_SERVICE_ACCOUNT` environment binding or `--credential-file /existing/private/key.json` is also supported; never put a key or token in chat. Output is a new mode-0600 file; choose an existing private directory. If no authorized session exists, stop and have an authorized operator run this command in their existing environment. The runner does not acquire access on its own.

The only Firestore requests allowed are paginated GET `projects/cyberjudah-app/databases/(default)/documents/studies` and `.../staging_studies`, using `showMissing=true` and `mask.fieldPaths=user.id`. OAuth token exchange is allowed only for the existing service-account mode. Google documents the [existing-session token command](https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token) and [projected document listing with missing parents](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/list). An inventory result is confidential evidence, not authorization to delete or reassign records.
