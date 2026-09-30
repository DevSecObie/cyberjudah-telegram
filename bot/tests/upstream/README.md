# Upstream interface oracle

Source: https://github.com/smontlouis/bible-strong/tree/61cf39c8c4a65220212dbac9536794e43ae8207e/packages/resource-domain/src

Only interface schemas, pagination/section/concordance helpers and the HTTP route
inventory are copied here. No Bible Strong resource content, databases, catalogs,
translations, dictionary entries, commentary or media is included or requested by
the Worker. These files are test-only and never enter its bundle.

License: GPL-3.0; the upstream LICENSE is retained. `source.json` records each original
file's SHA-256. Changes are limited to resolving internal imports locally and adding
`.ts` extensions. `api.ts.txt` records the service's 47 HTTP routes and their response
schemas; the test suite checks that every route is exercised.

The source schemas are unmodified. An explicit test records their 77-book limit,
checks their rejection of book 81, and validates the requested 81-book verse response
against an extension of the same Effect schema with only that bound changed.
