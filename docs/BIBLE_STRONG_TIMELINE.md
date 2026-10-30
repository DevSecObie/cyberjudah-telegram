# CyberJudah timeline in Bible Strong

The owner requested the timeline from the current CyberJudah app on 2026-10-28. This publication keeps Bible Strong's existing period cards, horizontal timeline, event sheets, scripture previews, search and related-event controls. It imports CyberJudah content; it does not restore Bible Strong's original editorial articles or pictures.

The source is `app/src/data/timeline.json`, regrouped by the current app's `shared/captivities.mjs`. All 991 distinct events remain in 21 periods. The 517 readable events have published case studies, a reign, or a Final Captivity account. Events without details remain visible, disabled as in the original UI. All 434 published Final Captivity accounts retain their history, teaching attribution, references, sources, uncertainty and disagreements. `between-testaments.json` is empty; drafts are not imported.

`bot/data/bs-timeline-cases.json` is a snapshot of the 92 case documents referenced by these events, read from the public `https://data.cyberjudah.io/api/cases/{slug}.json` feed. No account or private data is included. Refresh only those referenced public documents when publishing a new revision.

Run `node bot/scripts/build-bs-timeline.mjs` to build `bot/data/bs-timeline.json`. Its content hash covers both geometry and readable details. The resource endpoints return the same revision, with an untruncated index and bounded search. English content is retained for both interface languages and declared with `Content-Language: en`. Scripture links use CyberJudah's 81-book numbering, including Sirach/Ecclesiasticus and Esdras.

In the app checkout, run `node apps/expo/scripts/import-cyberjudah-timeline.mjs /absolute/path/to/bs-timeline.json`. This updates the bundled geometry and packages the same details in Bible Strong's existing JSON Offline-copy ZIP format. The app's existing download manager installs it; pictures are online resources and are not guaranteed offline. The import preserves other catalog resources. After changing Bible archives, rerun the timeline importer if the timeline itself also changed.

The pictures use the current app's approved CyberJudah image routes. No replacement illustrations or upstream stock images are generated. Missing period pictures remain empty, as in the current app.

Validation: resource-contract tests verify complete geometry, all Final Captivity accounts, sources, related targets, reference bounds, full indexes, bounded search and errors. The app's offline verifier compares archive hashes and the combined geometry/content revision before CI builds. Deploy only the backend publication paired with the app revision imported from it.
