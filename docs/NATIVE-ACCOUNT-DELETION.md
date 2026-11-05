# Native account deletion contract

`DELETE /api/native-account-data` uses a recently authenticated Firebase bearer token. It accepts no body, UID, document path, or scope parameters. Google verifies the token and its current account state; authentication and per-person rate limits run before deletion. No Telegram link is required. An existing server-verified link adds the legacy Telegram UID to cleanup, and remains available if cleanup must be retried.

The response is `{ "version": 1, "uid": "<verified subject>", "firestoreDeleted": true, "removed": 0 }` only after all discoverable Firestore writes have been acknowledged. The client must validate the version, subject and acknowledgment before deleting Firebase Auth. It separately removes published studies before this call. This endpoint neither deletes Auth nor changes the publication API's meaning.

Errors return no private document paths or credentials. Unavailable configuration, failed enumeration, excessive recursion, or a failed/missing per-write status returns 503. Children at every deeper level must succeed before any parent deletion starts. Repeating the operation after a lost response or partial success is supported. The client keeps its login on timeout, missing endpoint, malformed acknowledgment or server failure; it must not fall back to listing documents itself.

## Historical ownership gate

`NATIVE_ACCOUNT_DELETION_READY` is deliberately absent from deployment configuration. Only the literal string `true` opens this endpoint after authentication. Every other value returns 503 without starting Firestore deletion. This is a release gate, not a substitute for reconciliation.

Recursive traversal can discover missing parents under `users/{uid}` and `staging_users/{uid}` because the path retains ownership. A deleted top-level study parent loses the owner field used by the query. Revision payloads alone are not universally trustworthy owner evidence: historical rules authorize through a parent and do not enforce every revision owner field.

A safe reconciliation preserves ownership evidence before it deletes anything:

1. Inventory missing top-level study parents and their descendants read-only. Match only to trusted retained parent records, backups, or a server-controlled ownership ledger. Record source evidence and conflicts per study; missing or contradictory ownership remains unresolved.
2. Keep any resolved owner ledger server-controlled and immutable to clients. Delete its entry only after every descendant is acknowledged. Do not recreate private study content or infer ownership from a caller-supplied study ID, display name, or unenforced revision field.
3. Prevent ordinary study deletion and queued replay from discarding ownership while descendants remain. Protect deletion from concurrent writes and older clients through a reviewed tombstone/ownership-ledger and rules contract. Native parent-only deletion currently remains a release limitation.
4. Reconcile historical records through a reviewed dry run, verify isolation and interruption/retry against the actual service contract, and verify deployed configuration/rules. The readiness gate stays closed while any of these conditions is unproven. Enabling it or deleting real records is a separate production action.

`inventoryOrphanedStudyParents` provides the read-only first step for an authorized administrative execution. It paginates both top-level study collections with missing-parent placeholders and a `user.id` projection, returns only orphan parent names, performs no writes, and explicitly reports `ownershipResolved: false`. It is not exposed through HTTP. Its emulator result does not establish production inventory or ownership; trusted evidence must still be supplied and reviewed.

The endpoint's unit and local Worker tests are not evidence that historical production orphans have been reconciled. A release with the gate closed cannot claim a functioning complete account-deletion flow. A release with the gate opened without reconciliation cannot claim complete erasure either.
