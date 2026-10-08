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

Alternatively save `APP_REPO_TOKEN` as an Actions repository secret in `cyberjudah-telegram`;
the approved production deploy copies it to the Worker. A missing Actions copy never
removes a secret configured directly in Cloudflare. Staging stays separately configured.
The manual `verify-release` workflow reads the production CMS lists using a configured
admin, verifies that a non-admin is refused, and reports missing or expired repository
credentials without making edits or opening PRs.

The existing `CYBERJUDAH_TOKEN` stays scoped to `DevSecObie/cyberjudah`; note reviews need Contents and Pull requests read/write and Checks read there too. Neither token reaches the client. Do not grant either token branch/ruleset bypass rights. Keep the app's existing required checks and add **playwright** and **cms-content** as required checks on main.

D1 `DB` stores the audit trail in `cms_changes` (created automatically): editor Telegram id/name, time, reason, content id/kind, files, PR URL and observed outcome. Status refresh records merges or closures made outside the app. Recent changes pages through all records, 50 at a time; no rows are deleted. No token is stored there.

## First release

- Timeline: add/edit events, move drafts into the published list, unpublish into drafts; all checker fields are available. Unknown dates, references and quotes stay blank until the admin supplies them. Worker and CI use the same Zod schema and pure checker rules. KJV references use verse counts derived from the already approved pinned Bible files. CI additionally checks changed published events against the transcript corpus. Unchanged historical events retain their existing review status.
- Notes: the existing text and quick-fix editor now opens a PR. Quick fixes also require the loaded SHA. Content repository CI checks the PR.
- Outside sources: list defaults, remove/restore or add hosts with a reason. Changes open a PR. Publish copies the merged file’s host list and revision to KV `ask:sources` immediately; KV propagation can take up to a minute. Ask uses the newer of this revision and the bundled `bot/data/ask-sources.json`. The first save preserves legacy KV customizations. A failed activation remains Published and can be retried with Refresh status without merging again.
- Resources: list the live catalog, publish an uploaded release or roll back to a previously approved release. These are explicitly immediate after confirmation, without a PR. The existing R2 checksum validation and ETag compare-and-swap are reused. Uploads and required R2 credentials are described in [resources/README.md](../resources/README.md).
- Photos: links to the existing photo editor; its existing immediate-save behavior remains.

Classes now includes title, teacher and date forms, a filter for undated recordings and links to full notes. A save changes `data/sources/class-teachers.tsv` and the linked note's front matter in one PR. Content reader support must merge first; missing reader data returns a setup message. Existing text edits also update any existing metadata correction so a note correction cannot be masked by an older table row. Displayed transcript/search metadata uses the published corrections while the search index awaits rebuild; search ranking itself still uses that index.

The content repository's data publishing workflow must use its `production` environment with required reviewers before content publication is enabled. Configure this in **both** repositories. The Classes reader PR adds the content workflow's environment gate.

People now supports summaries, existing catalog relationships and credited HTTPS pictures. Matching relationship links are updated together; the server rejects new unknown ids, duplicate/self links and new ancestry cycles. Existing unresolved upstream links are preserved. The content picture reader must publish before photos appear on profiles and their relationship graph. The reader’s layout is unchanged.

Precepts supports passage explanations (`sense`) and precept explanations, verse positions and optional playback timestamps. References, passage order and class metadata stay fixed. Empty optional timestamps keep the passage’s playback time; no timestamp is guessed. Each save changes exactly one pass. The Worker validates real KJV references, verse bounds, dates and timestamp order; content CI additionally checks transcript existence and exact scripture quotes. Both `validate` and `check` must pass. Merge the content Precepts reader/checker PR before enabling this editor.

Only the two Timeline source JSON files are committed by its editor. `pretest` and `prebuild` regenerate the reader's `timeline.json` and `final-captivity.json` with the existing builder. Do not hand-edit or commit build outputs in CMS PRs.

## Validation

`npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e --workspace app -- --project=chromium cms.spec.ts` exercise the shared validators, real Worker authentication and D1, a fake GitHub contents/PR/check API, failed/stale/disallowed writes, audit records and explicit publication. The browser test never connects to real GitHub. The loopback stand-in requires the existing local-only `E2E_CLOCK=on` test mode.

`node scripts/check-cms.mjs` runs source checks. CI supplies `CMS_BASE` and `CJ_ROOT` to validate changed published records against transcripts; missing corpus data fails the check. To reproduce verse metadata from the approved resource source cache, run `RESOURCE_SOURCE_CACHE=/path/to/cache node scripts/build-cms-bible.mjs --check` (omit `--check` only when intentionally rebuilding metadata).

## Merge order and staging review

The owner merges [Timeline #140](https://github.com/DevSecObie/cyberjudah-telegram/pull/140) first, then [#134](https://github.com/DevSecObie/cyberjudah-telegram/pull/134) → [#135](https://github.com/DevSecObie/cyberjudah-telegram/pull/135) → [#136](https://github.com/DevSecObie/cyberjudah-telegram/pull/136) → [#137](https://github.com/DevSecObie/cyberjudah-telegram/pull/137). Rebase the CMS stack after #140, taking main's Timeline source files verbatim. Never hand-merge `events.json` or `drafts.json`. Retarget each dependent PR to main after its parent merges and wait for checks on that version.

| PR | What the owner reviews |
| --- | --- |
| #134 | Shared PR and audit flow, Timeline, notes, outside sources, resources and Photos link |
| #135 | Class title, teacher and dates, including undated recordings |
| #136 | People summaries, reciprocal relationships and credited pictures |
| #137 | Precept explanations, verse positions and timestamps |

Content-repository reader support (#48–#50) has already been owner-merged. Confirm its data publication completed before enabling the corresponding editors. Each app merge requires a separate approval of the app repository's `production` deployment. Each content-repository merge waits for that repository's `production` approval before its data publication. The CMS does not approve either environment or bypass its reviewers. “Published” confirms the merge, not reader availability; the content status message explains the pending approval/rebuild. Resources and outside-source activation explicitly report “Live”. The editor does not claim a content deploy finished without observing it.

CMS implementation branches and CMS-generated content branches skip automatic staging even after they leave draft. To test before production:

1. In GitHub Actions, select **stage → Run workflow** and explicitly choose the CMS branch to review. The owner initiates this staging deployment; checks still run before it deploys.
2. Use the separate staging bot and resources described in [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md). Configure staging `ADMIN_IDS` and the necessary Worker secrets separately (`npx wrangler secret put APP_REPO_TOKEN --env staging`, likewise `CYBERJUDAH_TOKEN`). The staging editor uses the same allowlisted repositories, so its saves create real review PRs. Use a real intended correction, inspect it, and close it if it was only a test. Do not click Publish unless you intend to merge it.
3. Open staging Telegram **Settings → Admin**. Load a Timeline event containing an answer, class teaching and tribes. Verify every existing value is present. Save one deliberate correction with a reason; inspect the PR to confirm unrelated source lines are unchanged. Follow **Checking → Passed**, or inspect the plain explanation for **Failed**. Reloading a stale edit must give a conflict.
4. Open the same screens as a non-admin: Admin and Edit must be absent and a direct Admin link must show denied access. The server must refuse its CMS requests.
5. Test whitelist or catalog changes only when you intend to change that environment's live policy/catalog. Outside sources activate in staging KV after explicit Publish; resource changes apply immediately after confirmation. Never use an arbitrary rollback or source removal as a smoke test.
6. For a complete Publish rehearsal without a real merge, run the local CMS browser test below. It uses fake GitHub and tests the confirmation, required checks and merge call. Approve production only after reviewing the staging result and the final main checks.

The audit retains every row and pages older changes in batches of 50. Refreshing a change updates its observed outcome; it never removes history. A failed save removes its orphan review branch only after confirming no PR exists. A lost GitHub response preserves the branch when that confirmation is unavailable.
