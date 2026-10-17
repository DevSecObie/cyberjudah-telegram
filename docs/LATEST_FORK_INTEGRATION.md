# The Bible is Bible Strong's reader

Owner's decision (10 Oct 2026): CyberJudah is one app, the Telegram Mini App in `app/` with the
Worker in `bot/`, and its Bible is Bible Strong's reader. Reading, selecting, highlights, notes,
tags, bookmarks, Free mode annotations, the book picker and every other reader behaviour are Bible
Strong's own, carrying CyberJudah's content: the King James Version of 1611 with the Apocrypha, the
classes' teaching on each verse, precepts and class videos.

- `strong/` is the Bible Strong fork (GPL-3.0). `strong/build-web.sh` builds it, and the Worker
  serves it at `/app/strong`.
- The app's Bible screen (`/bible`, `/read/:book/:chapter`) shows that reader in a frame above the
  app's bottom bar, opened at the chapter asked for. Inside the frame the fork leaves out its own
  bottom bar.
- CyberJudah changes to the fork are kept to content, names, links and fitting it into the app,
  and are marked `CyberJudah:` in its source.
