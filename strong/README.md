# CyberJudah on Bible Strong

This folder is the Bible Strong app by Stéphane Montlouis
([smontlouis/bible-strong](https://github.com/smontlouis/bible-strong), upstream commit
`d7e9fb5`), licensed under the GNU General Public License v3.0 (see `LICENSE`). It is used as
the skeleton of the CyberJudah Mini App: its screens, reader, tabs and study tools, carrying
only CyberJudah content.

What differs from upstream:

- **Content**: the app reads every resource from `EXPO_PUBLIC_RESOURCE_API_URL`, set to the
  CyberJudah feed on our Worker (`/bs`, in `bot/`). No Bible Strong content ships: only the
  King James Version with the Apocrypha is offered, from our data set.
- **Services**: no Bible Strong Firebase, Sentry, analytics or AI endpoints. Firebase gets an
  inert placeholder until accounts and sync move to Telegram.
- **Language**: English.

Build the web app:

    yarn install
    EXPO_BASE_URL=/app/strong yarn web:build

## Building and staging

`bash strong/build-web.sh` builds the web app rooted at `/app/strong` into `strong/dist`.
`bot/scripts/prepare-assets.sh` copies it to `.deploy/app/strong`, and the stage and deploy
workflows run both. The Worker answers any page under `/app/strong` with the fork's own
`index.html`. The current app at `/app` is unchanged until the switch is approved.

## Class videos in the reader

Bible Strong's inline videos are CyberJudah classes. When a chapter opens, the reader fetches
`/app/strong/_media/<book>/<chapter>` from the Worker (`bot/src/passage-media.mjs`). The Worker
reads that chapter's class moments from the data set. Each moment sits after the last verse it
taught and opens the recording at that second, Bishops and Deacons first. Bible Strong's
bundled BibleProject catalog is removed. The feed address is relative (`/bs`), so production
and staging each read their own Worker.
