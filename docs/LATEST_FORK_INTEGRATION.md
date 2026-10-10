# The Bible app and the Telegram app

Owner's decision (10 Oct 2026): CyberJudah has two products.

- **The Bible app** is `strong/`, the Bible Strong fork (GPL-3.0). It is the Bible, exactly as Bible
  Strong is, carrying CyberJudah's content: the King James Version of 1611 with the Apocrypha, the
  classes' teaching on each verse, precepts, class videos and the timeline. It ships at
  `cyberjudah.io/app/strong` (built by `strong/build-web.sh`, served by the Worker), and later in the
  app stores. Its look and behaviour follow Bible Strong's; CyberJudah changes are kept to content,
  names and links, and are marked `CyberJudah:` in the source.
- **The Telegram app** is `app/` with the Worker in `bot/`. It keeps every other CyberJudah feature
  (Ask, classes and recordings, the library, People, Law, Cases, donations, reminders, the admin),
  and its own reader, until the two are linked.

Readers' saved data in the Telegram app stays where it is; the Bible app does not read it yet.
