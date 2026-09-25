import { useEffect, useMemo, useState } from "react";

import { parseHl, tagBookmark, useBookmarks, useHighlights, COLORS } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { store } from "@/tg/store";
import { useSheet } from "@/ui/sheet";
import { Chip, Chips, Empty, List, Row, Screen, Section, Segmented } from "@/ui/ui";

type Tab = "marks" | "hl" | "notes";
const bookName = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Everything the reader kept: bookmarks with tags, highlights by colour, and verse notes. */
export function Bookmarks() {
  useBackButton(false);
  const sheet = useSheet();
  const [tab, setTab] = useState<Tab>("marks");
  const [marks, setMarks] = useBookmarks();
  const [hl, setHl] = useHighlights();
  const [tag, setTag] = useState("");
  const [notes, setNotes] = useState<{ key: string; verse: string; text: string }[]>([]);
  // Notes live one CloudStorage key per chapter (nt_<book>_<ch>); list them all.
  useEffect(() => {
    void store.keys().then(async (keys) => {
      const out: { key: string; verse: string; text: string }[] = [];
      for (const k of keys.filter((x) => x.startsWith("nt_"))) { try { const v = JSON.parse((await store.get(k)) ?? "{}") as Record<string, string>; for (const [verse, text] of Object.entries(v)) out.push({ key: k, verse, text }); } catch { /* ignore */ } }
      setNotes(out);
    });
  }, []);
  const tags = useMemo(() => [...new Set(marks.flatMap((m) => m.tags ?? []))].sort(), [marks]);
  const shown = tag ? marks.filter((m) => m.tags?.includes(tag)) : marks;
  const highlighted = Object.entries(hl).filter(([, v]) => v);

  const edit = async (id: string) => {
    const m = marks.find((x) => x.id === id); if (!m) return;
    const a = await sheet.open({ title: m.title, items: [{ id: "tags", text: "Tags", hint: m.tags?.length ? m.tags.join(", ") : "Group bookmarks by a word: sermon, family, promises…" }, { id: "rm", text: "Remove bookmark", destructive: true }] });
    if (a?.id === "rm" && (await confirm("Remove this bookmark?"))) { haptic("warning"); setMarks(marks.filter((x) => x.id !== id)); }
    if (a?.id === "tags") { const t = await sheet.open({ title: "Tags", text: { label: "Tags, separated by commas", value: (m.tags ?? []).join(", "), placeholder: "promises, sabbath", submit: "Save" } }); if (t?.id === "text") setMarks(tagBookmark(marks, id, t.value?.split(",") ?? [])); }
  };
  return (
    <Screen title="Bookmarks" kicker="Synced with your Telegram account">
      <Segmented label="Kind" value={tab} onChange={setTab} options={[["marks", `Bookmarks ${marks.length}`], ["hl", `Highlights ${highlighted.length}`], ["notes", `Notes ${notes.length}`]]} />
      {tab === "marks" ? (
        !marks.length ? <Empty title="Nothing kept yet">Tap a verse and choose More, or the bookmark on a class, to keep it here.</Empty> : (
          <>
            {tags.length ? <Chips><Chip on={!tag} onClick={() => setTag("")}>All</Chip>{tags.map((t) => <Chip key={t} on={tag === t} onClick={() => setTag(tag === t ? "" : t)}>#{t}</Chip>)}</Chips> : null}
            <List>{shown.map((m) => <Row key={m.id} href={m.href} meta={m.kind === "verse" ? m.title : "Class"} title={m.kind === "verse" ? m.text : m.title} sub={<>{m.kind === "verse" ? null : m.text}{m.tags?.length ? <span className="tags">{m.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</span> : null}</>} trailing={<button type="button" className="icon-btn" aria-label="Options" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void edit(m.id); }}>···</button>} />)}</List>
          </>
        )
      ) : tab === "hl" ? (
        !highlighted.length ? <Empty title="No highlights yet">Tap a verse, More…, then a colour.</Empty> : (
          <Section action={<button type="button" className="link" onClick={async () => { if (await confirm("Clear every highlight?")) setHl({}); }}>Clear all</button>}>
            <List>{highlighted.map(([k, v]) => { const [slug, ch] = k.split("/"); const m = parseHl(v); const byColor = COLORS.filter((c) => [...m.values()].includes(c.id)); return <Row key={k} href={`/bible/${slug}/${ch}?v=${[...m.keys()][0]}`} title={`${bookName(slug)} ${ch}`} sub={`Verses ${[...m.keys()].join(", ")}`} trailing={<span style={{ display: "flex", gap: 4 }}>{byColor.map((c) => <i key={c.id} style={{ width: 12, height: 12, borderRadius: 6, background: c.css }} />)}</span>} />; })}</List>
          </Section>
        )
      ) : (
        !notes.length ? <Empty title="No notes yet">Tap a verse, More…, then Add a note.</Empty> : (
          <List>{notes.map((n) => { const [, slug, ch] = n.key.split("_"); return <Row key={n.key + n.verse} href={`/bible/${slug}/${ch}?v=${n.verse}`} meta={`${bookName(slug)} ${ch}:${n.verse}`} title={n.text} />; })}</List>
        )
      )}
    </Screen>
  );
}
