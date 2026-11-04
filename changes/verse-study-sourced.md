# verse_study returns the full, sourced study of a verse

- `verse_study` (MCP and Ask) now reads everything the chapter file holds for the verse: the study note's points with their source (class, date, teacher and moment) or "unsourced", the precepts the note places on it, every recording found reading the verse aloud, every class note passage that holds it, every precept placed on it or citation of it as a precept, and notes and library pages that mention it.
- Every hit says why it matched ("reads Exodus 12:14 at 30:51", "cites … as a precept under …"), the words said there, a link to that second of the video, the teacher or "teacher unknown", the date or "date unknown", and its notes link or "Notes: none yet".
- Matches are at verse level: a note's chapter-level row no longer matches every verse of the chapter. Readings of the verse rank first, then class note passages, precept citations and mentions; within each, Bishops, Deacons, Captains, the rest, Zakai last.
- Cross-references are listed again (they were parsed wrongly and dropped).
- `search_classes` and `read_transcript` say "date unknown" and "Notes: none yet" instead of leaving them out. `read_transcript` lists caption corrections (a book or feast word misheard) after the captions, which stay as YouTube gave them.
