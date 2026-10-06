# Changelog entries waiting for a release

Each pull request that a reader, an admin or the bot's users would notice adds **one new file** here
instead of editing `CHANGELOG.md`:

- name it after the branch, with `/` turned into `-`, e.g. `changes/claude-portraits-m03.md`;
- write one or more lines in plain words, each starting with `- `, exactly as they should read
  under Unreleased.

Because every pull request adds its own file, two pull requests never conflict over the changelog.
When a release is cut, `node scripts/changelog-fold.mjs` moves every entry here into Unreleased in
`CHANGELOG.md` and deletes the files (see [CONTRIBUTING.md](../CONTRIBUTING.md#releases)).
