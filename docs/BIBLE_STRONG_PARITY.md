# Bible Strong parity

Bible Strong (`smontlouis/bible-strong`, `apps/expo/src/features`) is the blueprint for this
app. This is the feature-by-feature account of where CyberJudah stands against it, and the
order the rest gets built in. "Ours" names the screen or component in `app/src`.

## Home (features/home)

| Bible Strong | Ours | State |
| --- | --- | --- |
| Greeting, verse of the day (5-day carousel, share, image) | `screens/Home.tsx` hero, one day | Verse done; the 5-day carousel and the verse image are not |
| ProfileStats (highlights, bookmarks, notes, tags, studies, links) | `StudyStats` | Done (no studies or links counts yet) |
| Learn: media library, Bible Project, Timeline cards | Learn shelf: this week's class, Classes, Library, Our Hidden History, Encyclopedia, Law, Precepts, Cases, Topics | Done, on our resources |
| Study: Strong of the day (Greek, Hebrew), Nave of the day, Word of the day, shuffle | `home-widgets.tsx`: Strong Greek and Hebrew, Topic, Word (Easton's), Person, Precept | Done |
| Random verse | `useRandomVerse` | Done |
| Meditate: meditations, PlanHome, Audibible | Reading plan, 4 Chapters a Day, Sabbath | Done, on our resources |
| Go further: donate, follow, FAQ | Everything else, Share the app | FAQ page not built |

## Reader (features/bible)

| Bible Strong | Ours | State |
| --- | --- | --- |
| Verse selection, colours, notes, tags, links, bookmarks, focus | `bible/ui/SelectedVersesSheet.tsx`, `Editors.tsx`, `store.ts` | Done |
| Strong marks and word study | `bible/ui/WordStudy.tsx`, `WordSheet.tsx` | Done, 66 books; Apocrypha through the Septuagint layer |
| Compare / parallel versions | `CompareSheet.tsx` (verse beside cross-references and precepts) | Done as far as one text allows: only the KJV exists here |
| Interlinear, pericope headers | none | Not built: no Hebrew or Greek text with the KJV |
| Chapter entities (people named in the chapter) | `bible/ui/ChapterPeople.tsx`, "In this chapter" at the end of the text | Done |
| Search inside the Bible with version, canon, section and book filters | `SearchSheet.tsx` (reference, book, people, words; canon and book filters) | Done, as far as one version allows |
| Reader settings (font, size, theme, colours, alignment, verse numbers, line height) | `ParamsSheet.tsx` | Done |
| Audio (TTS) | Workers AI voices | Done |
| Tabs and workspaces ("Open in new tab", groups, tab switcher) | none | To build |
| History | `screens/History.tsx` | Done |

## Resources

| Bible Strong | Ours | State |
| --- | --- | --- |
| Lexicon (browse, search, word study, concordance) | `screens/Lexicon.tsx` | Done |
| Dictionary | `screens/Dictionary.tsx` (Easton's) | Done |
| Nave topical Bible | `screens/Library.tsx` Topics (the classes' own topics with threads) | Done, on our resources |
| Commentaries | Precept passes and class breakdowns under every verse | Done, on our resources |
| People | `screens/People.tsx`, `screens/Person.tsx` | Done |
| Timeline | none | Not built |
| Plans library, meditations | `screens/Plan.tsx` (one library plan), `Study` | A plan library from the class series still to build |

## Yours (features/settings)

| Bible Strong | Ours | State |
| --- | --- | --- |
| Highlights, notes, bookmarks screens | `screens/Bookmarks.tsx` | Done |
| Tags screen with tag detail, rename, delete | `screens/Tags.tsx` | Done |
| Studies (rich editor) | `screens/Note.tsx` editing of class notes | The reader's own studies still to build |
| Backup, import/export | `lib/backup.ts`, Settings › Backup: a file sent to your chat by the bot, a file restored | Done |
| Theme, Bible defaults, share options, downloads | `screens/Settings.tsx`, `ParamsSheet.tsx`, offline books | Done |
| FAQ, onboarding tips | none | To build |

## Build order for what is left

1. Reader tabs: a `bs_tabs` store, a tabs sheet with previews, close and new, "Open in new tab" in the reader menu.
2. Onboarding tips and an FAQ page.
3. A plan library built from the class series; the reader's own studies; the 5-day verse carousel.
