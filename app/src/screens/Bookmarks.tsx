import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { data } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { confirm } from "@/tg/sdk";
import { json, store } from "@/tg/store";
import { Ion } from "@/bible/icons";
import { useAllNotes, useBookmarks, useTags, type Highlight } from "@/bible/store";
import { paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { Chip, Chips, Empty, List, Row, Screen, Segmented } from "@/ui/ui";

type Tab = "bookmarks" | "highlights" | "notes";
type ChapterHl = { slug: string; chapter: number; verses: Record<string, Highlight> };

/** Bible Strong's lists: Bookmarks (with their colour), Highlights (by chapter, with the tags) and Notes. */
export function Bookmarks() {
  useBackButton(false);
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || (params.get("tag") ? "highlights" : "bookmarks"));
  const [bookmarks, setBookmarks] = useBookmarks();
  const [tags] = useTags();
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug;
  const tagFilter = params.get("tag") ?? "";
  const { rows: allNotes } = useAllNotes();
  const notes = useMemo(() => (tagFilter ? allNotes.filter((n) => n.note.tags?.[tagFilter]) : allNotes), [allNotes, tagFilter]);
  const [hl, setHl] = useState<ChapterHl[]>([]);
  useEffect(() => {
    void store.keys().then(async (keys) => {
      const out: ChapterHl[] = [];
      for (const k of keys.filter((x) => x.startsWith("bs_h_"))) { const m = /^bs_h_(.+)_(\d+)$/.exec(k); if (!m) continue; const verses = await json.get<Record<string, Highlight>>(k, {}); if (Object.keys(verses).length) out.push({ slug: m[1], chapter: +m[2], verses }); }
      setHl(out.sort((a, b) => Math.max(...Object.values(b.verses).map((v) => v.date)) - Math.max(...Object.values(a.verses).map((v) => v.date))));
    });
  }, []);
  const shownHl = useMemo(() => hl.map((c) => ({ ...c, verses: Object.fromEntries(Object.entries(c.verses).filter(([, v]) => !tagFilter || v.tags?.[tagFilter])) })).filter((c) => Object.keys(c.verses).length), [hl, tagFilter]);
  const swatch = (h: Highlight) => (h.color.startsWith("color") ? (palette as unknown as Record<string, string>)[h.color] : settings.customHighlightColors.find((c) => c.id === h.color)?.hex) ?? "transparent";
  return (
    <Screen title={tab === "bookmarks" ? "Bookmarks" : tab === "highlights" ? "Highlights" : "Notes"} kicker="Synced with your Telegram account">
      <Segmented label="Kind" value={tab} onChange={(t) => { setTab(t); setParams(t === "highlights" && tagFilter ? { tag: tagFilter } : {}, { replace: true }); }} options={[["bookmarks", `Bookmarks ${bookmarks.length}`], ["highlights", `Highlights ${hl.reduce((n, c) => n + Object.keys(c.verses).length, 0)}`], ["notes", `Notes ${notes.length}`]]} />
      {tab === "bookmarks" ? (
        !bookmarks.length ? <Empty title="No bookmarks yet" action={{ label: "Open the Bible", href: "/bible" }}>Select a verse and tap Bookmark, or add one to a chapter from its ⋮ menu.</Empty> : (
          <List>{[...bookmarks].sort((a, b) => b.date - a.date).map((b) => <Row key={b.id} href={`/read/${b.book}/${b.chapter}${b.verse ? `?v=${b.verse}` : ""}`} title={b.name} sub={`${bookName(b.book)} ${b.chapter}${b.verse ? `:${b.verse}` : ""}`} trailing={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Ion name="bookmark" size={20} color={b.color} /><button type="button" className="icon-btn" aria-label="Remove" onClick={async (e) => { e.preventDefault(); e.stopPropagation(); if (await confirm("Are you sure you want to delete this bookmark?")) setBookmarks(bookmarks.filter((x) => x.id !== b.id)); }}>×</button></span>} />)}</List>
        )
      ) : tab === "highlights" ? (
        <>
          {Object.keys(tags).length ? <Chips><Chip on={!tagFilter} onClick={() => setParams({}, { replace: true })}>All</Chip>{Object.values(tags).map((t) => <Chip key={t.id} on={tagFilter === t.id} onClick={() => setParams(tagFilter === t.id ? {} : { tag: t.id }, { replace: true })}>{t.name}</Chip>)}</Chips> : null}
          {!shownHl.length ? <Empty title="No highlights yet" action={{ label: "Open the Bible", href: "/bible" }}>Select a verse and tap a colour.</Empty> : (
            <List>{shownHl.map((c) => { const vs = Object.keys(c.verses).map(Number).sort((a, b) => a - b); return <Row key={`${c.slug}${c.chapter}`} href={`/read/${c.slug}/${c.chapter}?v=${vs[0]}`} title={`${bookName(c.slug)} ${c.chapter}`} sub={`Verses ${vs.join(", ")}`} trailing={<span style={{ display: "flex", gap: 4 }}>{[...new Set(Object.values(c.verses).map(swatch))].filter((x) => x !== "transparent").map((x) => <i key={x} style={{ width: 12, height: 12, borderRadius: 4, background: x }} />)}</span>} />; })}</List>
          )}
        </>
      ) : (
        !notes.length ? <Empty title="No notes yet" action={{ label: "Open the Bible", href: "/bible" }}>Select a verse and tap Note.</Empty> : (
          <List>{notes.map((n) => <Row key={`${n.slug}${n.chapter}${n.key}`} href={`/read/${n.slug}/${n.chapter}?v=${n.key.split("/")[0]}`} meta={`${bookName(n.slug)} ${n.chapter}:${n.key.replace("/", ",")}`} title={n.note.title || "Untitled note"} sub={n.note.description} />)}</List>
        )
      )}
    </Screen>
  );
}
