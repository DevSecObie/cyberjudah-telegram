# CyberJudah on Bible Strong

This folder is the Bible Strong app by Stéphane Montlouis
([smontlouis/bible-strong](https://github.com/smontlouis/bible-strong), upstream commit
`eed343dcb6a119f048068cf16a4de31fd7bb160c` (8 October 2026)), licensed under the GNU General Public License v3.0 (see `LICENSE`). It is used as
a staged reference for reader, tab and study-tool behavior. The product remains the existing
CyberJudah app in `app/`; improvements are integrated there while retaining its content,
features and Apple Liquid Glass. The owner corrected this scope on 8 October 2026.
See [the current integration scope](../docs/LATEST_FORK_INTEGRATION.md). This prototype is
not planned to replace `/app`.

What differs from upstream:

- **Reader content**: resource requests use `EXPO_PUBLIC_RESOURCE_API_URL`, set to the
  CyberJudah feed on our Worker (`/bs`, in `bot/`). The King James Version with the Apocrypha
  is offered from our data set. Timeline and class content also come from CyberJudah.
  This staged build is not yet the main app.
- **Services**: accounts and personal-data sync use the owner’s `cyberjudah-app` Firebase
  project. Analytics is disabled. See [Firebase setup and rules](firebase/README.md).
  Telegram administration continues to use verified Worker identity, not Firebase UIDs.
- **Language**: English.

Build the web app:

    yarn install
    EXPO_BASE_URL=/app/strong yarn web:build

## Building and staging

`bash strong/build-web.sh` builds the web app rooted at `/app/strong` into `strong/dist`.
`bot/scripts/prepare-assets.sh` copies it to `.deploy/app/strong`, and the stage and deploy
workflows run both. The Worker answers any page under `/app/strong` with the fork's own
`index.html`. The current app at `/app` remains the product; no replacement switch is planned.

## Class videos in the reader

The staged Home and Classes library also read `/app/strong/_content/teachings`. Latest Teachings
keeps the owner's existing row layout and broadcast order, including uploads awaiting notes.
Classes open the current CyberJudah note or recording screen. See
[`docs/LATEST_FORK_INTEGRATION.md`](../docs/LATEST_FORK_INTEGRATION.md) for the prototype's
limitations and the plan to improve the existing app.

Bible Strong's inline videos are CyberJudah classes. When a chapter opens, the reader fetches
`/app/strong/_media/<book>/<chapter>` from the Worker (`bot/src/passage-media.mjs`). The Worker
reads that chapter's class moments from the data set. Each moment sits after the last verse it
taught and opens the recording at that second, Bishops and Deacons first. Bible Strong's
bundled BibleProject catalog is removed. The feed address is relative (`/bs`), so production
and staging each read their own Worker.
