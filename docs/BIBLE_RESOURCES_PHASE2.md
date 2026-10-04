# Phase 2: installing and reading the approved resources

The [bundle build](../resources/README.md) and [source register](resources.md)
cover Strong’s, Josephus/Whiston (Scranton 1905), the twelve Jewish Encyclopedia
volumes (1901–1906) and Smith’s (Houghton Mifflin 1889). Easton’s and other
link-only sources retain their existing paths. KJV with the Apocrypha remains
the only Bible text. Nothing here authorizes a remote upload, merge or deployment.

## Reader flow

Study resources is accessible from Settings, the Library and the Bible’s existing
Font and settings sheet. It lists only approved IDs that are published in the
catalog or already installed. Cards show the download size and licence; the
existing full-height Liquid Glass sheet shows the original notices and source
links. Install, Remove, Roll back, progress, cancellation and retry remain in
this flow. The Bible reader has not been restyled.

Each install stages checksummed data shards privately. A transaction activates
the complete release and keeps the previous release for rollback. A failed,
interrupted or superseded install cannot replace it. Failed attempts delete only
their own staging records. Remove deletes all versions of that resource and
increments its generation in the same transaction, so a concurrent tab/download
cannot restore removed data. Other resources and saved Bible chapters are untouched.
Rollback exchanges the two complete versions. Browser quota errors leave the prior
version readable; download size does not include IndexedDB’s storage overhead or
the retained previous version.

Strong’s entry/index/continuation reads use the installed release first, otherwise
the session catalog. Query keys include the resource release, and continuation
pages also retain the existing concordance revision. The first 600 results,
continuation order and attribution remain unchanged. No page zero is requested.
Before publication the legacy API remains available. Once a release is pinned,
a failed reader request never substitutes another release or the legacy API.
Ask's word lookup may fall back to the existing Strong’s API when its pinned
lexicon cannot be read; the answer explicitly names that source. Book editions
retain their pinned-release behavior.

Book pages are readable at `/resources/:id/:release?key=page/volume/image`, with
page navigation, printed-page lookup, bounded word search, original scan links
and KJV scripture annotations. Scan links open the source for comparison; scans
are not downloaded as part of an offline text install. See the [OCR report](BIBLE_RESOURCES_OCR.md)
before relying on quotations, names or dates. Unclear reference candidates stay
plain text. Search exposes the first 40 postings for one word; Ask examines up to
five candidate pages. It intersects the available bounded postings for all query
terms first, and uses the rarest available term only if their intersection is empty.
Neither claims exhaustive phrase or whole-book coverage.

## Ask release contract

The app snapshots its installed/session-catalog release IDs in the `resources`
request field. Only the four approved IDs and validated release identifiers are
accepted. Explicit `null` retains a legacy path before publication; absent fields
on older clients resolve from one server catalog snapshot for the entire answer.
Release IDs are selected by the app/server, never by a tool argument.

`look_up_word` reads Strong’s through the shared indexed adapter. Easton’s remains
unchanged. `outside_source` accepts an approved `resource` and a query or page key;
its citations point back to that exact release. URLs for the exact approved Archive
printings also select the bundle when available. Other approved website URLs and
Wikipedia retain their existing paths. Historical resource approval does not
broaden the outside-site whitelist or license modern editions.

Both tools and the HTTP reader use the same approved manifest/hash and records.
Older approved releases remain resolvable after catalog publication or rollback.
The server does not accept arbitrary R2 keys, resource URLs, or non-approved
release bytes. A missing pinned edition returns an error without substitution.

## Validation

The converter PR’s workflow builds and verifies the real bundles and exercises
Worker publication/indexed lookup in process. Separate browser tests exercise
actual IndexedDB installation, failed updates, rollback, removal, source sheets,
Strong’s continuation and reference links. Server tests compare both Ask tools
and HTTP records against the same old release after the catalog advances, plus
invalid-release/ID cases. The preexisting offline shell and legacy Strong’s tests
remain in the cross-browser suite.

Publication order: merge/deploy the reviewed resource contracts and installer
only after the owner’s separate approval; an admin then reviews the CI artifacts
and invokes the manual upload/publication command with their own credentials.
Until that publication the installer reports that no resources are published.
