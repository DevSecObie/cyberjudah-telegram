---
tags: [status, prs]
---
# Status and PRs

Repository: `DevSecObie/cyberjudah-telegram`. Nothing is merged or deployed without the owner's go-ahead.

| PR | Branch | What | State |
|---|---|---|---|
| #92 | `claude/ask-credits` | [[Ask Credits]] | Draft. Waiting on the pricing config |
| #94 | (sheet fix) | [[Ask Sheet Fix]] | Merged by the owner |
| #95 | `claude/final-captivity-preview` | [[Final Captivity]] preview (first events, the three Bishops' portraits) | Merged into main. The production deploy passed its checks and is **waiting for approval** of the protected `deploy` job (run 37110847693) |
| #96 | `claude/photo-editor` | [[Photo Editor]] | Open. Waiting for the owner's approval to merge |
| none yet | `claude/final-captivity` | Work-in-progress research: 161 events and 20 drafts | Pushed. Not a PR |

## App state
- `main` builds and its checks pass. The app works as it stands.
- The live site gets the Final Captivity preview once the deploy job is approved in GitHub (Actions, then the run, then "Review deployments").

## Next steps, in order
1. Approve the deploy of #95.
2. Review and merge #96, then set the cover photo for "Israel United in Christ" from the app.
3. Open a PR that brings the 161-event WIP data from `claude/final-captivity` to main.
4. Rerun the research rounds that were stopped (see [[Final Captivity - Research Tools]]).
5. Decide the [[Open Questions]].
