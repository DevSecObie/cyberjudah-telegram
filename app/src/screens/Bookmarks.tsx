import { useBookmarks, useHighlights } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { Empty, List, Row, Screen, Section } from "@/ui/ui";

export function Bookmarks() {
  useBackButton(false);
  const [marks, setMarks] = useBookmarks();
  const [hl, setHl] = useHighlights();
  const highlighted = Object.entries(hl).filter(([, v]) => v);
  const remove = async (id: string) => { if (await confirm("Remove this bookmark?")) { haptic("warning"); setMarks(marks.filter((m) => m.id !== id)); } };
  return (
    <Screen title="Bookmarks" kicker="Synced with your Telegram account">
      {!marks.length && !highlighted.length ? <Empty title="Nothing kept yet">Tap a verse and choose More, or the bookmark on a class, to keep it here.</Empty> : null}
      {marks.length ? (
        <Section title="Bookmarks">
          <List>{marks.map((m) => <Row key={m.id} href={m.href} meta={m.kind === "verse" ? m.title : "Class"} title={m.kind === "verse" ? m.text : m.title} sub={m.kind === "verse" ? undefined : m.text} trailing={<button type="button" className="icon-btn" aria-label="Remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void remove(m.id); }}>×</button>} />)}</List>
        </Section>
      ) : null}
      {highlighted.length ? (
        <Section title="Highlights" action={<button type="button" className="link" onClick={async () => { if (await confirm("Clear every highlight?")) setHl({}); }}>Clear all</button>}>
          <List>{highlighted.map(([k, v]) => { const [slug, ch] = k.split("/"); return <Row key={k} href={`/bible/${slug}/${ch}?v=${v.split(",")[0]}`} title={`${slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} ${ch}`} sub={`Verses ${v}`} />; })}</List>
        </Section>
      ) : null}
    </Screen>
  );
}
