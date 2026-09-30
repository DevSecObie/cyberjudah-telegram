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
