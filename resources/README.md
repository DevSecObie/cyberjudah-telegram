# Approved resource bundles

Phase 2 packages four separate resources: Strong’s, Josephus/Whiston (Scranton
1905), all twelve Jewish Encyclopedia volumes (1901–1906), and Smith’s (Houghton
Mifflin 1889). [Owner decisions and licence evidence](../docs/resources.md) and
[OCR inspection/limitations](../docs/BIBLE_RESOURCES_OCR.md) accompany the build.
Easton’s and other existing datasets are unchanged. No other bundle is approved.

## Reproduce and verify (Node 24)

```sh
npm ci --no-audit --no-fund
node --test resources/*.test.mjs
node resources/build-bundles.mjs --out /tmp/resource-bundles-01 --cache /tmp/resource-sources
node resources/ocr-report.mjs /tmp/resource-sources /tmp/resource-bundles-01/ocr-report.json
node resources/publish.mjs --bundle /tmp/resource-bundles-01
```

Choose a new output directory on every run. `--offline` on the builder requires
all source bytes to be in the cache. Every read checks the lockfile SHA-256,
including cached files. Inputs are pinned to immutable repository commits; source
file URLs, revisions and hashes also travel in the manifests. Scanned-page hashes
and checked transcription excerpts are included as provenance, not resource text.
No timestamps, machine paths or random data enter the bundle identity.

CI builds the real bundles and uploads `approved-resource-bundles-<commit>`.
The artifact contains `objects/`, a candidate `catalog.json`, `inventory.json`,
conversion/OCR reports, the source lockfile and checked scan excerpts. Rebuilding
from the same pins produces identical object bytes. Strong’s retains its exact
reader attribution and upstream header notices; `CC-BY-SA-unversioned` is allowed
only for that separate lexicon. No licence version is inferred.

## Lookup contract

Data shards are bounded NDJSON. Each key hashes to one of sixteen SHA-256 first-hex
buckets (`sha256-nibble-v1`). The manifest checksums each index bucket and data
shard. Index rows map record keys to listed data shard paths. Publication verifies
complete one-to-one coverage; lookups read one bucket and one data shard. Existing
non-indexed manifests retain their legacy behavior. This resolves Phase 1’s Ask
migration blocker.

Strong’s records are `entry/H430`, `index`, and
`occurrences/H430/<occurrence-revision>/1` onwards; there is no page zero. Existing
entry fields and occurrence ordering are preserved. Optional `scripture` contains
link annotations for definition/derivation/KJV fields, without rewriting text.
Book records are `book`, `pages`, `page/<volume>/<scan-image>` and `search/<word>`.
Search postings expose up to the first 40 matching pages plus the actual match
count. They are a bounded candidate search, not exhaustive phrase search. Page
records retain exact source text, scan links and scripture annotation offsets.

`GET /api/resources/:id/:release/record?key=...` returns `{release,data}` from the
approved pinned release. Installers download checksummed data shards to IndexedDB;
they do not need a second local copy of the server index.

## Admin publication — manual only

The default `publish.mjs` command above only verifies local files. An admin with
their own normal Wrangler/Cloudflare credentials and current Telegram admin init
data in `RESOURCE_ADMIN_INIT_DATA` can run one command after reviewing the reports:

```sh
node resources/publish.mjs --bundle /path/to/artifact --execute --bucket cyberjudah-audio --api https://cyberjudah.io
```

Download the artifact from the repository's [Resource bundles workflow](https://github.com/DevSecObie/cyberjudah-telegram/actions/workflows/resource-bundles.yml):
open the successful run for the reviewed commit, then download
`approved-resource-bundles-<commit>` under **Artifacts**. Unzip it and use the
directory containing `inventory.json` as `/path/to/artifact`. Sign in to GitHub
to download; artifacts expire after 30 days. Use Node 24 and the matching checkout.

For this Wrangler-based command, create a Cloudflare API token with **Account →
Workers R2 Storage → Edit**, restricted to the account containing
`cyberjudah-audio`. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` securely
in your local shell. This token does not need Workers deployment, D1, KV or DNS
permissions. Cloudflare's account API permission is account-scoped, so it can
write other R2 buckets in that account; it is not bucket-scoped. R2's separate
S3 **Object Read & Write** credentials can be bucket-scoped, but are not accepted
by this Wrangler command. Do not grant R2 admin access merely to upload objects.

`RESOURCE_ADMIN_INIT_DATA` is fresh Telegram Mini App init data from an account
listed in the Worker's `ADMIN_IDS`. Supply it securely as an environment variable;
it authorizes the catalog API separately from the Cloudflare upload token. Run the
command promptly while that Telegram session is valid. Review the default dry
verification output before adding `--execute`.

Do not put credential values in arguments, files committed to Git, or logs. The
script verifies every artifact hash, mapping and content-derived release identity,
reads the current catalog/ETag, uploads release objects (manifests last), then
calls authenticated `PUT /api/resources/catalog` with `If-Match`. It preserves
unrelated entries and advances the current revision. A failed upload never makes
a catalog PUT; a conflicting publication leaves the prior catalog authoritative.
Retry against the new current ETag. Never write approval markers or the current
catalog pointer directly. Uploading a new release does not delete installed older
releases, which remain available for rollback and pinned citations.

No remote upload, merge or deployment is performed by the build or CI workflow.
R2 is the sole app resource CDN. The upload script is for the admin’s later use.

---

# Local resource fixtures

This directory contains a deterministic **local test fixture builder**, not Bible,
lexicon, dictionary or historical source datasets. The small dictionary and
reference records are visibly synthetic and contain no scripture, quotations or
historical dates. They exercise the exact contract in
[`shared/resources.ts`](../shared/resources.ts).

The fixture source, license and approval links use the reserved
`https://example.invalid/local-fixture` address. The approval string explicitly
says **LOCAL TEST FIXTURE ONLY; NOT PRODUCTION APPROVAL**. These fields exist to
test the manifest shape and do not establish production rights or approvals.
Production datasets still require the source and permission checks in
[`docs/resources.md`](../docs/resources.md).

## Generate and verify

Use the repository's installed dependencies and Node 24. The script imports the
shared TypeScript schemas through a file URL, using Node's built-in type stripping;
it does not install packages, download datasets, fetch URLs or invoke Wrangler.

```sh
node --test resources/build-fixtures.test.mjs
node resources/build-fixtures.mjs --out /tmp/cyberjudah-resource-fixtures-01
```

Pass a **new output directory outside the checkout**. Existing output and symlinks
into the checkout are rejected; no files are overwritten or deleted. Choose a new
path for another run. Generated bytes do not contain timestamps, machine-specific
paths or randomness, so the same builder produces the same hashes everywhere.
Tests leave their temporary fixtures in place and print their paths.

The builder emits 15 files:

| Path | Purpose |
| --- | --- |
| `objects/resources/local-fixture-dictionary/fixture-v1/` | Initial dictionary manifest and two NDJSON shards |
| `objects/resources/local-fixture-dictionary/fixture-v2/` | Updated definition at the same lookup key, with its own manifest and two shards |
| `objects/resources/local-fixture-dictionary/fixture-corrupt/` | Valid manifest plus an intentionally altered shard for rejection tests |
| `objects/resources/local-fixture-reference/fixture-v1/` | Stable reference manifest and one shard |
| `catalogs/v1.json` | Revision 1: dictionary v1 and reference v1 |
| `catalogs/v2.json` | Revision 2: dictionary v2 and unchanged reference v1 |
| `catalogs/corrupt.json` | Revision 3: intentionally corrupt dictionary and reference v1; publication must fail |
| `inventory.json` | Every object key, relative file, byte length, hash, content type and integrity expectation; catalog files and expected publication results |

Both good manifests and every good shard are checked using `ManifestSchema`,
`CatalogSchema` and `parseShard` before output. The corrupt release starts valid,
then changes one ASCII letter in the first shard without changing its byte length
or JSON syntax. The builder verifies that `parseShard` rejects its checksum.
Inventory hashes describe the **actual emitted bytes**, including the deliberate
corruption; the corrupt manifest retains the original expected shard checksum.

## Use with local R2

The `objects` array in `inventory.json` is the seed inventory. Each entry's `file`
is relative to the chosen output directory and its `key` is the exact R2 key.
Seed these objects only into the existing **local** `AUDIO` binding, using the same
local persistence directory as Wrangler. Never use these fixtures with `--remote`
or a production bucket. The builder itself performs no R2 writes.

The catalogs are deliberately separate from the seed objects. Do not directly
seed `resources/catalog/current.json` or manufacture approval marker objects.
Use the existing authenticated resource catalog publication route to exercise the
real validation and compare-and-swap path:

1. With an empty local catalog, publish `catalogs/v1.json` as a local test admin
   using `If-Match: *`, then install both resources in a test client.
2. Publish `catalogs/v2.json` using the ETag from the current catalog. The Alpha
   lookup (`local-fixture/alpha`) should change from revision 1 to revision 2 after
   the client installs the update. The reference release remains unchanged.
3. Attempt to publish `catalogs/corrupt.json` using the new current ETag. The
   damaged shard must be rejected and the installed good release must remain
   readable. To test corruption during a client download, serve the corrupt
   catalog through a test-only mock; the production publication route correctly
   prevents this catalog becoming current.

Use test-only Telegram credentials for local authentication. Production resource
publication remains a separate, permission-checked operation.
