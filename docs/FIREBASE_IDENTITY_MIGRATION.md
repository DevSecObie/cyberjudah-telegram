# Telegram identity and personal-data migration

Owner direction recorded 8 October 2026. Firestore is the system of record for personal notes and revisions; its SDK owns offline persistence, the write queue and token refresh. Workers validate identity, mint custom tokens and handle edge/API services. No new D1 note tables or note mirrors.

The owner confirmed publishing `strong/firebase/firestore.rules` at 9:17 AM on 8 October. The September 8 versions remain in console history. **Do not change or deploy different rules without owner approval.**

## Existing identity trace, before implementation

1. `app/src/tg/sdk.ts` obtains `window.Telegram.WebApp.initData` and sends it as `Authorization: tma <initData>`. `initDataUnsafe` is presentation data, never proof of identity.
2. `bot/src/index.ts` verifies signed launch data through `bot/src/initdata.mjs`. The validator derives HMAC-SHA256 using `WebAppData` and the bot token, sorts the launch fields, compares the hash, and checks `auth_date`. General routes currently accept 30 days; sensitive routes accept one day.
3. Outside Telegram, `bot/src/browser-auth.ts` has a separate verified Telegram OIDC flow. Its opaque OIDC `sub` is not treated as a Telegram ID; it requires the signed numeric profile ID. Its D1 table contains sealed browser sessions, not reader notes. That existing feature remains separate.
4. There is currently **no Firebase mint endpoint, signing credential binding, deterministic Telegram UID function, or automatic Mini App Firebase bridge** in this checkout. The fork does not currently load the Telegram SDK.
5. `strong/apps/expo/src/helpers/FireAuth.web.ts` initializes `onAuthStateChanged(getAuth(firebaseApp), ...)`. It supports email/password, provider login and `signInWithCustomToken`; the custom-token caller is currently a development input. The Firebase SDK persists its session. `TokenManager.web.ts` uses SDK `getIdToken(true)` only for recovery, with a cooldown; it does not call a Worker mint endpoint.
6. `firebase.web.ts` currently calls `getFirestore`, which uses the default in-memory Firestore cache. Redux/localStorage currently also persists personal data and a separate outbox. This is not yet the owner's requested SDK-persistent single-record architecture.

## Existing data inventory

| Source | Keys / shape | Migration requirement |
| --- | --- | --- |
| Telegram CloudStorage | `bs_n_<slug>_<chapter>` maps verse-number sets (`16/17`) to `{id,title,description,date,tags}` | Deterministic note ID; preserve text, original ID/date, tags and every verse relation; initial revision in same batch |
| Telegram CloudStorage | `nt_<slug>_<chapter>` maps verse numbers to plain note strings | Preserve this older generation too; do not silently replace a newer note with matching verses |
| Telegram CloudStorage | `bs_h_<slug>_<chapter>` highlight maps; older `hl` has compressed ranges and letter colours | Expand to canonical numeric verse keys; preserve legacy colour mapping |
| Telegram CloudStorage | `bs_l_<slug>_<chapter>`, `bs_bm`, `bs_tags` | Preserve links, bookmark locations, colours and tag IDs |
| Telegram CloudStorage | `rel_<slug>_<chapter>` relation arrays | Deduplicate the same relation ID repeated in multiple chapter keys; preserve endpoints and direction |
| Telegram CloudStorage | `bm`, `bs`, `read`, `plan`, `last`, `lastnote`, `hist`, `recent`, other preferences | Preserve legacy bookmarks, reader settings and reading progress separately from notes; explicitly map supported settings |
| Device localStorage | `cj:tabgroups`; older `cj:tabs` | Preserve groups, active tab and destinations; these are not reliably in CloudStorage |
| IndexedDB | `cyberjudah-personal-study`, stores `studies` and `annotations` | Separate per-device import: study blocks/revision/timestamps and exact annotation ranges/quotes |
| Existing optional backup | `/api/study-backup`, sealed `study_backups` row in D1 | Existing legacy backup only; never add a new note mirror or continue backup dual-writes after migration. Keep existing data intact until an explicit retention/cutover decision |

`app/src/tg/store.ts` returns a device value first and resolves the cloud value later; it treats cloud callback errors as missing values. Its `set` does not await CloudStorage success. **Do not use this convenience store for migration.** Use direct `getKeys`/`getItems` callbacks, reject every callback error, and await the full source snapshot. A missing SDK or read failure is not an empty account and must not set the migration flag.

`app/src/studies/storage.ts` accepts studies up to 2 MB, larger than Firestore's per-document limit. The current free-note importer creates new UUIDs, so it must not be reused for retry-safe migration. IndexedDB and localStorage are not inherently account-scoped: never silently attach another browser account's local material to a Telegram UID. Keep their source and owner binding explicit.

## Planned bridge

Implementation status: the Worker routes and stable UID derivation now exist in `bot/src/firebase-auth.ts`; the web client restores SDK auth before invoking the bridge. Unit tests and browser tests against the real Auth emulator pass for tampering, two-device identity and mint counts. Production signing still requires the Worker-only credential described in `strong/firebase/README.md`. The trace above records the state before these changes.

- Add a POST mint route with fresh signed Telegram initData verification and a safe positive integer Telegram ID. Reject missing, stale, tampered and duplicate identity fields. UID is exactly `tg_<verified numeric ID>`; never accept a UID from the request and never allocate one randomly.
- Sign Firebase custom tokens on the Worker using a Firebase service account configured as Worker secrets. Public browser config cannot sign. No signing key, custom token, ID token or refresh token is logged or persisted in D1.
- Client waits for Firebase `authStateReady()` before deciding there is no session. With a valid persisted session it makes **zero** mint requests. Deduplicate concurrent fresh-sign-in attempts; request once, then use `signInWithCustomToken`. The SDK handles refresh; no hourly mint timer.
- A persisted account inconsistent with the current Telegram identity must never receive that user's CloudStorage migration. Block migration until the verified identities match. Email/Google/Apple linking needs an explicit authenticated linking flow; do not merge or discard those accounts silently.
- Worker admin APIs continue to require their existing verified Telegram identity and `ADMIN_IDS`, independently of Firebase UID.

## Planned migration and cutover

Implementation status: `telegramMigration.web.ts` now implements the two independent versioned commit points, deterministic IDs, source fingerprints, owner checks and conflict-safe atomic note/revision transactions. Seven real Firestore emulator tests cover interruption/resume, edits, deletions, conflicting source text, concurrent devices and device-local completion. `telegramSources.web.ts` reads direct CloudStorage callbacks and a read-only IndexedDB snapshot. **These helpers are not yet wired to sign-in:** full source conversion, exact character-to-word annotation mapping, large-study handling, and replacement of the fork's duplicate outbox remain promotion blockers. No existing data source has been switched or deleted.

1. Authenticate the stable Telegram Firebase identity. Read the versioned migration state from that user's Firestore document. With no verified identity or no authoritative CloudStorage snapshot, leave migration pending.
2. Read all required CloudStorage keys successfully, validate and convert the complete snapshot before writing. Deterministic IDs derive from source key and stable record identity, scoped under the authenticated UID. Do not use random IDs or current time as record identity. Preserve unconvertible records and stop with a recoverable error instead of skipping them.
3. Commit each note and its initial immutable revision snapshot atomically in one SDK transaction. The transaction supplies a read precondition as well as the atomic write batch: an unchecked writeBatch could overwrite a concurrent edit. Re-runs recognize the deterministic initial revision and source fingerprint, preserve later edits/deletions, and stop on changed source text rather than discard a different version.
4. Write highlights, bookmarks, links, tags, relations, studies and tabs to the private `users/<uid>/...` paths. Private studies include `user.id = uid`; never put a private migrated study in the globally readable `/studies` collection. Chunk any oversized study without losing blocks, order or source metadata.
5. Confirm every required server write, then write **`migrationVersion: 1` last**. That is the commit point. If interrupted or offline before this point, resume deterministic writes on the next run. Keep local source data untouched; do not delete source keys as part of migration.
6. Treat device-only study/annotation/tab imports separately from the per-user CloudStorage flag, so one device finishing cannot cause another device's unique material to be skipped. Bind a device import explicitly to the verified owner; preserve originals while any conflict or ownership ambiguity remains.
7. Only after a source migration is committed switch that source's UI reads/writes to Firestore. Use SDK IndexedDB persistence and snapshot listeners for local rendering, pending writes and reconnect sync. Redux is a derived view, not a second authoritative store; remove duplicate write/outbox paths for migrated content. Account switching must not expose the prior user's cached data.

## Owner-authorized revision amendment

After the trace, the owner authorized exact nested revision paths under private notes/private studies and under legacy public studies. `strong/firebase/firestore.rules` now mirrors that supplied amendment; publication of the amendment itself is not yet independently confirmed. No other rule change is authorized.

The owner subsequently approved splitting top-level revision update and delete: updates require both existing and incoming ownership, while deletes check the existing document. The local rules contain that exact correction. Emulator tests cover owner create/read/delete for private note and study revisions, cross-account refusal, atomic note-plus-initial-revision writes, and top-level revision update/delete ownership. Publication of the corrected amendment still requires owner confirmation.

The amendment does not add nested study-block documents. Oversized existing IndexedDB studies still require a reviewed representation; never silently skip them or set their import flag prematurely.

## Two migration commit points (owner-confirmed)

- CloudStorage: synced `users/<uid>` migration metadata with `migrationVersion: N`, committed only after every required CloudStorage write is acknowledged.
- IndexedDB and device-only data: a **device-local, UID-scoped** `migrationVersion: N`, committed only after every required write for that device succeeds. It must not be a global/synced completion flag. A second device imports its own data independently.

Deterministic document IDs make overlapping source records idempotent. The original source identity must be retained so a retry cannot replace a newer edit. Both passes remain client-side; neither can be bulk-migrated from the Worker.

## Required end-to-end evidence

- Tampered/stale/malformed initData cannot mint; client-supplied UID cannot change the result; the same Telegram ID on separate devices yields the same Firebase UID.
- Fresh sign-in invokes mint exactly once; concurrent callers share the attempt; reload with persisted auth invokes it zero times; SDK token refresh invokes it zero times.
- Interrupt migration after a committed note batch and before the final flag. Resume and prove exact source counts, one initial revision per note, no duplicate records, no overwritten subsequent edits, and final flag only after every write.
- Published rules accept every intended personal-data shape and reject cross-user access. Rejected note/revision batches leave no partial note.
- Offline edits queue through the Firestore SDK and appear on a second device after reconnect. Account switching, sign-out, export and deletion cover the new data paths.
- Exercise reader selection, both long-press settings, word annotation, free notes, tab/group navigation and reload end to end. Screenshots are review aids, not interaction-parity evidence.
