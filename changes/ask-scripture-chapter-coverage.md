# Ask: a chapter is never taken as read when only part of it was

- `read_scripture` with a chapter and no range still returns 40 verses at a time. Each reading now says how many verses the chapter has and which verses to read next ("Verses 1-40 of the 176 in Psalms 119. The chapter is not finished: read "Psalms 119:41-80" next …"). A chapter that fits says "All N verses of …".
- A range that runs past the end of a chapter is labelled with the verses actually read and says where the chapter ends. A verse past the end says how many verses the chapter has.
- The tool description tells the model that a long chapter is read in full only when every part has been read.
- New test `ask-scripture-chapter.test.mjs` (placeholder verses, not Scripture).
