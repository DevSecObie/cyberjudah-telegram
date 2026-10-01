# Human KJV narration

The app reads `/api/recordings/<slug>/<chapter>` and plays a single, seekable audio
file using verified verse time boundaries. Its saved narrator choice survives
chapters without that narrator; those chapters fall back to the separately saved
AI voice (Asteria until one is chosen). Device voices remain available. Pitch is
not applied to human recordings. Stop cancels pending playback as well as active
playback. Repeat restarts only after natural completion.

The data companion PR in `DevSecObie/cyberjudah`, branch `codex/kjv-recordings`, owns
the recording sources, rights evidence, source checksums, quality/review flags and
alignment against our Bible text. It encodes trimmed chapter files with:

```sh
python3 scripts/audio/recordings.py check
python3 scripts/audio/recordings.py export --output /path/to/recording-export
```

In this repository, preview the upload plan first:

```sh
cd bot
RECORDINGS_EXPORT_DIR=/path/to/recording-export node scripts/deploy-recordings.mjs --dry-run
```

On an authorized deployment, `npm run deploy --workspace bot` runs this script
before deploying the Worker. Set `RECORDINGS_EXPORT_DIR` to that export and
`AUDIO_BUCKET` if targeting a bucket other than `cyberjudah-audio`. Without an
export the existing audio is untouched. The script verifies audio checksums,
uploads media and indexes, and publishes `recordings/catalog.json` last. No audio
or source download is tracked in Git. Deploying the Worker alone does not make
new narration available. The `publish-audio` workflow (Actions → publish-audio → Run
workflow) exports, checks and uploads the narration and the ambient loops; it has a
dry-run option.

`/api/audio/recordings/<reader>/<slug>/<chapter>.m4a` supports GET, HEAD, single
byte ranges, suffix ranges, ETags and If-Range. It deliberately cannot expose
cached AI speech. Audio is public, has a one-year cache, and catalog URLs carry
its content hash. The catalog refreshes every five minutes. The app credits every
published reader/source/license and caches the catalog, available chapter choices
when narration is explicitly added to an offline book. Text saves independently;
a prompt shows the catalog byte total before downloading narration. A failed or
declined audio download does not undo a complete text download.

Review flags from alignment must remain available in the data index. Automated
ASR disagreement is not proof of a reader mistake; consult the data PR's COVERAGE.
Licensing must be confirmed before export/publication. No deployment was performed
as part of implementation.
