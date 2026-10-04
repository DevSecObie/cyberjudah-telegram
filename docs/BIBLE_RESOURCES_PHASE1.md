# Bible resources Phase 1

## Reader changes

The installed app shell can relaunch without a network and read previously saved
KJV books, including the Apocrypha. The existing reminder handlers remain in the
same service worker. Strong's word spans expose every supplied number; concordance
entries can load later pages without discarding earlier results after an error.
The reader layout and Liquid Glass materials are unchanged.

There is no installer UI in this phase. No additional Bible translation,
interlinear alignment or third-party resource has been imported. Real resources
still require the owner's approval of [resources.md](resources.md).

## Version 1 wire contract

`shared/resources.ts` is the common runtime schema for the Worker, browser and
local fixture builder. JSON is UTF-8. A catalog has `schemaVersion: 1`, a
monotonically increasing `revision`, and unique `{id, release, manifestSha256}`
entries. A manifest has:

- `schemaVersion`, `id`, `release`, `kind`, `title`, `language`;
- `source[]`: HTTPS URL, immutable revision and source SHA-256;
- `license[]`: license identifier, evidence URL, attribution and modifications;
- `approval`: owner review URL and approver identity;
- `parts[]`: relative NDJSON filename, SHA-256, uncompressed bytes and record count.

Kinds are `bible`, `lexicon`, `dictionary`, `reference` and `timeline`. Bible
manifests must identify `text: KJV` and `canon: kjv-1611-apocrypha`. Only
`public-domain`, `CC-BY-4.0` and timeline-only `owner-content` licenses are accepted.
Metadata assertions do not establish a license or substitute for owner review.

Shards are LF-terminated NDJSON `{key, data}` records. Keys must be unique across
all parts of a release. SHA-256 covers exact UTF-8 bytes after HTTP decoding,
including the final newline. Shards are limited to 2 MiB / 20,000 records;
manifest and catalog responses are bounded to 256 and 512 KiB respectively.
`data` retains the source payload: kind-specific consumer formats must be
versioned before a real resource migrates. Timeline payloads are validated now.
No fetch location is taken from source/attribution URLs: downloads use our API.

Immutable objects live at `resources/<id>/<release>/manifest.json` and the named
shards beneath that prefix in the existing R2 `AUDIO` binding. IDs and paths reject
slashes, traversal and caller-selected URLs. Once approved, a release's manifest
hash cannot change. Out-of-band corruption fails checksum validation.

## One catalog authority and publication

`resources/catalog/current.json` is the sole current catalog. Content-addressed
snapshots live at `resources/catalog/<sha256>.json`. Immutable approval markers at
`resources/approved/<id>/<release>.json` allow pinned readers to continue using a
prior release after a catalog update.

- `GET /api/resources/catalog`: public, revalidated with ETag.
- `GET /api/resources/<id>/<release>/<file>`: only approved manifests/listed
  shards, checked before serving, with immutable caching.
- `PUT /api/resources/catalog`: signed Telegram initData plus existing
  `ADMIN_IDS`; requires the previous ETag in `If-Match` (`*` only when empty),
  exactly the next catalog revision, and complete valid uploaded releases.

Publication validates manifests, hashes, shard counts and cross-shard keys before
conditionally replacing the current pointer with R2's ETag compare-and-swap.
Racing publishers receive 409 and must reload. No GitHub credential is involved.
A failed race may leave validated approval markers and a snapshot; these never
change the current pointer. The future editor uses this same publication route.
Uploads and dataset review are separate operations. Nothing here writes remote R2.

`readResourceRecord(env, id, key, release)` is the shared server adapter. A migrated
HTTP endpoint and its Ask tool must both use it with the installed client's pinned
release. Omitting a release resolves the current catalog. This phase migrates no
real dataset, so existing Ask tools and their current source adapters remain
unchanged; there is no second production copy. A future resource migration must
include both consumers and a test comparing returned release and record bytes.

## IndexedDB activation

`cj-resources-v1`, version 1, has three stores:

| Store | Key | Purpose |
| --- | --- | --- |
| `releases` | private release namespace | Manifest, manifest hash, resource ID/release and readiness |
| `records` | `[releaseKey, key]` | Source payload; index by `releaseKey` |
| `active` | resource ID | Current namespace, previous namespace and operation generation |

Each installation reserves a generation, validates bounded downloads and writes
shards into a private staging namespace. No network await occurs inside a storage
transaction. Activation marks the completed release ready and swaps the active
pointer in one transaction, only if its generation still owns the operation.
A failed/cancelled/quota-exceeded install leaves the prior active resource intact.
Concurrent deactivation/rollback prevents a late download from reactivating it.
Reads pin the active release within one read transaction. Rollback swaps to the
prior ready release; deactivation retains bytes and is independently reversible.
Old/staging releases are retained in Phase 1; storage reclamation, quota display
and install/remove controls belong to the later installer work.

## Offline shell and legacy downloads

Vite emits `offline-shell.json` and embeds its revision in `sw.js`; all local HTML,
CSS and lazy JavaScript chunks are installed with `Cache.addAll`. Failed installs
do not activate a partial shell. No `skipWaiting` forces an update into an open
reader. Navigation is network-first with cached HTML fallback; assets are
cache-first. Cached redirected HTML is replayed as a fresh response so Chromium
can navigate offline on hosts that redirect `index.html`.

Telegram's SDK keeps its own network lifecycle. Offline reading uses the app's
existing web fallback. The service worker does not cache personal API responses.
Push, click and subscription-renewal handlers remain present.

`cj-offline-v1` is retained, including saved chapters, book markers and audio.
The next online launch adds the missing book index; new book saves include it.
Legacy bytes are never relabelled as checksummed resource bundles. A first launch
before the new shell has successfully installed still needs a network connection.
Shell and resource caches are not purged in this phase.

## Timeline compatibility

The original Between the Testaments proposal loads unchanged, including null
absolute dates, source-calendar text and narrative ordering. Existing Timeline
sections, period documents and Final Captivity maps preserve every field;
`tribes`, `answer[]`, optional `teaching`, pictures and sources are supported.
The imported legacy chronology has reversed/zero end years: transport preserves
those values rather than guessing corrections. New event records validate ranges.
Generated pictures require labelled captions; archival pictures require their
source, credit and license.

These transport schemas do not replace `app/scripts/final-captivity/check.mjs`.
Before publishing a real Timeline bundle, run that existing gate with `CJ_ROOT`
so scripture ranges, recording references and quoted text are checked against
the source corpus. No new historical assertion is introduced here.

## Local verification

The [fixture builder](../resources/README.md) creates synthetic local manifests,
shards and successive/corrupt catalogs. Test metadata is explicitly not production
approval. Worker tests exercise real authentication, role checks, publication,
ETags, corruption rejection and pinned historical reads. Browser tests exercise
real IndexedDB across reloads, rollback, deactivation, interrupted installation,
and a production offline relaunch after removing network stand-ins.

The companion engine change keeps legacy first-page responses and emits every
remaining Strong's occurrence in revision-pinned pages. The app works with the
old engine response until that separately reviewed source change is published.
No merge or deployment is part of this phase.
