# Research kit for the twelve-tribes Timeline

How the Timeline's tribe batches are researched, so another agent can continue.

- `BRIEF.md`, then `TRIBES-BRIEF.md` (it wins where they differ): the rules and the batch shape.
- `batches/`: every batch merged so far (gad-reuben, spoken-against, zebulon-issachar,
  naphtali-asher, ephraim-manasseh). Use them as models.
- `checkbatch.mjs <batch.json>`: checks one batch against `check.mjs` and against the slugs
  already in `events.json`. Runs from any directory. Set `CJ_ROOT` to a checkout of
  DevSecObie/cyberjudah to also check against the transcript corpus; without it, it checks
  shape only and says so. It must print 0 problem(s):
  `CJ_ROOT=<path to DevSecObie/cyberjudah> node app/scripts/final-captivity/research/checkbatch.mjs <batch.json>`.
- `tmerge.py <batch.json>`: adds a batch to `events.json`, `drafts.json` and `ledger.json`
  (additive; keeps each period in time order). Then run `node build.mjs` and
  `CJ_ROOT=<path to DevSecObie/cyberjudah> node check.mjs` (0 problems).
- `tsearch.py`: searches the class transcripts in the content repo (`blog/transcripts/`).
  Its index (`tindex.pkl`) is not committed; it is rebuilt on first use. Set `CJ_ROOT`
  (or `ROOT`) to your checkout of DevSecObie/cyberjudah.

Paths inside the briefs that start with `<scratch>` were a working folder; use your own.
