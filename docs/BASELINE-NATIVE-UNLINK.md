# Native unlink companion — not deployed

This narrow companion supports the upstream-based app deletion candidate. It
does not replace Telegram account deletion or erase any Telegram-owned data.

`DELETE /api/firebase/link` requires a recent Firebase identity verified by
Google for `cyberjudah-app`. It rejects `tg_` identities, caller-selected UIDs,
missing proof and stale authentication. In one D1 batch it removes only that
Firebase UID's association and approved device-signin rows. Repeating an old UID's
cleanup cannot delete a newer association with another UID. Telegram wallets,
sealed chats, publications, and other users' links and grants remain intact.

Session restoration no longer calls linkAccounts for a cached native UID. It
rechecks the current association after signing and drops the token if unlinking
finished in the meantime. Device exchange also rechecks after signing. This does
not revoke tokens that were already returned to a client.

The app candidate first invokes the existing publication deletion endpoint on
both production and staging, then invokes native unlink on both. Failure stops
Auth deletion; the user can retry. No Worker service bindings, D1 bindings,
reference services, retention records, credentials, or live data were changed.

Validation: sixteen identity/unlink tests and six real Workers/D1 publication
tests pass, including two independent stores with different privacy keys. Bot
TypeScript check passes. Tests use synthetic identities and local databases.

Remaining gates: post-deletion profile writes, already-issued credentials and
already-authorized publication/link requests need the user's cleanup-timing policy
and implementation verification. Neither delayed cleanup nor temporary or
permanent deletion records are implemented. This branch has not been merged or
deployed. Deploy neither this companion nor the app until those gates pass.
