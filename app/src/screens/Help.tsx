import { Link } from "react-router";
import { useBackButton } from "@/tg/hooks";
import { Card, Screen, Section } from "@/ui/ui";

export function Help() {
  useBackButton(true);
  return <Screen title="Help & reading guide">
    <Section title="Getting around"><Card>
      <p>Open the Bible from the bottom bar. Tap its book name to choose a book and chapter. Swipe across the text or use the arrows to move between chapters.</p>
      <p>The numbered Tabs button keeps several passages or tools open. Tap a card to resume it, or use + to add another. Tap the group name to organize tabs into groups. If the bar shrinks while reading, tap it once to expand it.</p>
      <p>New Tab’s search finds your open tabs, tools and references such as John 3:16–18.</p>
    </Card></Section>
    <Section title="Study a passage"><Card>
      <p>Tap verses to select them. Annotate has highlights, notes, tags, links, personal precepts, bookmarks and focus. Study opens word tools, commentary and related scripture; it also adds scripture to your own study. Share offers copy, sharing and passage export.</p>
      <p>A long press opens the verse’s resources. You can swap short and long press in Scripture options → Font and settings. Focus shows just your passage; Read whole chapter expands its context.</p>
      <p><Link to="/studies">My studies</Link> keeps your own writing, scripture and Strong’s entries. Preview shows formatting; export keeps a file you can take elsewhere.</p>
    </Card></Section>
    <Section title="Search and translations"><Card>
      <p>Scripture options → Search the Scriptures accepts a reference, a name or words from the text. Put a phrase in quotes to keep it together. Filter by testament or book, change the result order, and use More verses to continue.</p>
      <p>The reader uses the King James Version with the Apocrypha. Precepts side by side compares related scripture; it does not substitute another translation. Word-aligned Strong’s entries are available where the source provides them. A Greek parallel is labeled separately from word alignment.</p>
    </Card></Section>
    <Section title="Audio and offline reading"><Card>
      <p>Use the speaker to start or pause reading. <Link to="/settings/audio">Audio settings</Link> selects a voice, speed, supported pitch and ambient sound. Device voices depend on your phone or browser; generated voices need a connection before they can be cached.</p>
      <p>In <Link to="/settings">Settings</Link>, download books and available narration before going offline. <Link to="/resources">Study resources</Link> has approved dictionaries and reference works. A downloaded book lets you read it offline; searching the complete Bible still needs a connection.</p>
      <p>If sound stops with the screen locked, reopen the app. Background playback depends on Telegram, your browser and your device. Downloaded data can be removed by the device when storage runs low.</p>
    </Card></Section>
    <Section title="Save and restore your work"><Card>
      <p>Settings → Backup exports reader notes, highlights, tags, bookmarks, links, reading plans and preferences. Keep that file before changing devices or clearing storage.</p>
      <p>Personal studies and phrase marks have a separate backup in <Link to="/settings/account">Account & personal studies</Link>. Cloud backup is manual: save it after your changes, and restore it on the other device. Local autosave is not automatic synchronization between devices.</p>
      <p><Link to="/privacy">Privacy</Link> explains data export and deletion.</p>
    </Card></Section>
    <Section title="Keyboard controls"><Card>
      <p>Mac: ⌘K finds tabs, tools and scripture; ⌘⌥N adds a tab; ⌘⌥W closes the current tab. Hold Control and press Q to choose a recent tab, then release Control to open it.</p>
      <p>Windows/Linux: Ctrl+K finds tabs and tools; Ctrl+Alt+N/W adds or closes a tab. Hold Alt and press Q for recent tabs. On either platform, Alt+↑/↓ moves between tabs, Enter opens a choice, and Escape closes a sheet.</p>
      <p>Workspace shortcuts leave text fields and modal editors alone so they do not interrupt your writing.</p>
    </Card></Section>
  </Screen>;
}
