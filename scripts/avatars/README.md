# People portraits: generation tools and state

How to pick up where we left off (see docs/AVATARS.md for every rule and its scripture):

- `prompt.py` builds each person's prompt from the record (nation, role, period, KJV details, distinct
  features). `queue.py` and `nations2.py` decide who qualifies and their nation; `mk.py <slice> <n>`
  writes a batch of 12 requests; `items.py <slice> <n>` downloads results and builds a review sheet;
  `ingest.py items/<batch>.json add` adds passing portraits to the app.
- `REVIEW.md` holds the review rules every image must pass.
- `state/` holds the queue, slices, pending redos, and the request, result and item files per batch.

Where things stood:
- Batch `m-00` (first 12 major characters: Levi, Joseph, Paul, Peter, Jeremiah, Hezekiah, Pharaoh,
  Elijah, Jonathan, Jeroboam, Ahab, Daniel) is generated and reviewed, and waits for approval.
  Its image URLs are in `state/waits/m-00.json`.
- `state/slice-m.json` lists the 91 major characters; batches m-01 onward are next.
- Open questions: Lot's daughters; Mordecai's crown (Esther 8:15); whether Hamite women are covered;
  Timothy, Balaam, Job, Nebuchadnezzar, Ahasuerus, Cyrus.
