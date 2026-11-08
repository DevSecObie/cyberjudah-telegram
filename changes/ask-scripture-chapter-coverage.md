# Ask: a chapter is never taken as read when only part of it was

- `read_scripture` with a chapter and no range still returns 40 verses at a time. Each reading now says where the chapter ends and which verses to read next ("Verses 1-40 of Psalms 119, which ends at verse 176. The chapter is not finished: read "Psalms 119:41-80" next …"). A chapter that fits says "All of …, verses 1-N".
- A range in the middle of a chapter says where the chapter ends and what to read next. A range at or past the end is labelled with the verses actually read and says where the chapter ends. A verse past the end says where the chapter ends. The bounds come from the chapter's own first and last verse numbers.
- Each part of a chapter is its own source. Before, every reading of a chapter shared one key (kind, chapter link), so "Psalms 119:41-80" was cited as the source holding verses 1-40. Scripture readings are now keyed by what they read.
- A reading's source holds every verse its title names. It was cut at 1,400 characters.
- The tool description tells the model that a long chapter is read in full only when every part has been read.
- New test `ask-scripture-chapter.test.mjs` (placeholder verses, not Scripture).
