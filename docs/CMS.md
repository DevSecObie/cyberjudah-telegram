# Editing content from Telegram

An admin listed in the Worker's `ADMIN_IDS` opens **Settings → Admin**. Timeline events and class notes also have an admin-only Edit action that opens the same editor. Non-admins cannot read or write any CMS endpoint.

Content saves create `cms/<kind>-<id>-<time>-<suffix>` branches and `CMS: …` pull requests. Every save needs a reason and the source file's SHA. A changed SHA returns a clear conflict; reload before applying the correction again. No endpoint accepts an arbitrary repository, path or branch.

**Checking**, **Passed** and **Failed** show the repository's current checks, including plain failure details. **Publish** asks for confirmation, checks the exact saved head and allowed files again, and requests a squash merge. Checks passing alone never merges a change. A branch changed outside the editor cannot be published there. GitHub reviews, conflicts and branch rules still apply.

The Publish click is the admin's merge action. It does not approve production deployment. Set required reviewers for the `production` environment under repository **Settings → Environments**; the environment label alone does not enforce approval. CMS pull requests skip automatic staging deployment and still run validation.

## Owner setup

Create a **fine-grained personal access token** in GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:

- Resource owner: `DevSecObie`.
- Repository access: **Only select repositories → cyberjudah-telegram**.
- Repository permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Checks: Read-only**. Metadata read is automatic.
- Choose an expiry and record its renewal date. Do not grant Actions, Workflows, Administration, organization-wide or additional repository access.

Save it as the **Worker secret** `APP_REPO_TOKEN` in Cloudflare's dashboard, or run `npx wrangler secret put APP_REPO_TOKEN` from `bot/` with your normal Cloudflare credentials. Paste the token at the secure prompt, never into chat, a file or a command argument. Add the secret separately to staging only if you intend to allow staging edits.

The existing `CYBERJUDAH_TOKEN` stays scoped to `DevSecObie/cyberjudah`; note reviews need Contents and Pull requests read/write and Checks read there too. Neither token reaches the client. Do not grant either token branch/ruleset bypass rights. Keep the app's existing required checks and add **playwright** and **cms-content** as required checks on main.

D1 `DB` stores the audit trail in `cms_changes` (created automatically): editor Telegram id/name, time, reason, content id/kind, files, PR URL and observed outcome. Status refresh records merges or closures made outside the app. Recent changes lists the latest 50 records. No token is stored there.

## First release

- Timeline: add/edit events, move drafts into the published list, unpublish into drafts; all checker fields are available. Unknown dates, references and quotes stay blank until the admin supplies them. Worker and CI use the same Zod schema and pure checker rules. KJV references use verse counts derived from the already approved pinned Bible files. CI additionally checks changed published events against the transcript corpus. Unchanged historical events retain their existing review status.
- Notes: the existing text and quick-fix editor now opens a PR. Quick fixes also require the loaded SHA. Content repository CI checks the PR.
- Outside sources: list defaults, remove/restore or add hosts with a reason. Changes open a PR and take effect after deployment. The first save preserves existing KV customizations; revision zero continues reading the legacy KV list. Subsequent deployed revisions use `bot/data/ask-sources.json`.
- Resources: list the live catalog, publish an uploaded release or roll back to a previously approved release. These are explicitly immediate after confirmation, without a PR. The existing R2 checksum validation and ETag compare-and-swap are reused. Uploads and required R2 credentials are described in [resources/README.md](../resources/README.md).
- Photos: links to the existing photo editor; its existing immediate-save behavior remains.

Dedicated class metadata, People and Precepts editors follow in separate PRs.

Only the two Timeline source JSON files are committed by its editor. `pretest` and `prebuild` regenerate the reader's `timeline.json` and `final-captivity.json` with the existing builder. Do not hand-edit or commit build outputs in CMS PRs.

## Validation

`npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e --workspace app -- --project=chromium cms.spec.ts` exercise the shared validators, real Worker authentication and D1, a fake GitHub contents/PR/check API, failed/stale/disallowed writes, audit records and explicit publication. The browser test never connects to real GitHub. The loopback stand-in requires the existing local-only `E2E_CLOCK=on` test mode.

`node scripts/check-cms.mjs` runs source checks. CI supplies `CMS_BASE` and `CJ_ROOT` to validate changed published records against transcripts; missing corpus data fails the check. To reproduce verse metadata from the approved resource source cache, run `RESOURCE_SOURCE_CACHE=/path/to/cache node scripts/build-cms-bible.mjs --check` (omit `--check` only when intentionally rebuilding metadata).
