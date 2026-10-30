# Staging serves the Jewish Encyclopedia download

- The staging deploy copies `offline/dictionaries/dictionary-jewish-encyclopedia-en.sqlite.zip`
  and the offline `catalog.json` that lists it from cyberjudah-app at cb9b48d (that repo's branch
  `claude/project-thread-9mfnk0`), beside the People module and the player page.
- The app downloads the encyclopedia from there; nothing else in the worker changes. Bible
  Strong's dictionary routes are still proxied as before, and the encyclopedia is never asked of them.
