# One commentary per Bishop in the Bible reader

Obie (2026-10-31): the reader's commentary must carry the teacher's name, not "CyberJudah", and
show Bishop Nathanyel's, Bishop Yawasap's and Bishop Kani's commentaries.

- `bot/src/bs/core.ts`: `TEACHER_COLLECTIONS` maps `bishop-nathanyel`, `bishop-yawasap` and
  `bishop-kani` to the teacher name in the class data; `collection()` accepts them and returns the id.
- `bot/src/bs/commentary.ts`: chapter, verse, reading-index and reading-section answer for each
  Bishop with only the entries filed under his name (section ids start with the Bishop's id).
  Coverage for a Bishop comes from the data set's `/api/concordance/teachers.json`
  (DevSecObie/cyberjudah #751), so it lists only his chapters. `cyberjudah` (every teacher) still
  answers for builds already installed.
- `bot/tests/bs/feed.test.ts`: a Bishop's commentary holds only his entries, coverage lists only
  his chapters, and an unknown id is a 404.
