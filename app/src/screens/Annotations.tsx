import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { data, type Book } from "@/api/data";
import { groupMarks, type Mark } from "@/bible/annotation/marks";
import { colorItems, paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { compactVerses, useTags } from "@/bible/store";
import { parseVerseKey } from "@/lib/relations";
import { allAnnotations, subscribeStudies, type Annotation } from "@/studies/storage";
import { useBackButton } from "@/tg/hooks";
import { useSheet } from "@/ui/sheet";
import { Chip, Chips, Empty, Screen, Segmented } from "@/ui/ui";
import "./annotations.css";

/**
 * Bible Strong's Annotations screen (features/settings/WordAnnotationsScreen.tsx): every word mark,
 * filtered by colour, tag, style, testament and book, in Bible order or by date, shown by verse,
 * by date or as a list. A card holds the marked words (three lines), the passage and the
 * version, and whether it has a note; it opens the passage.
 */
type Style = Annotation["style"];
type Testament = "all" | "old" | "new" | "apocrypha";
type Query = { color: string | null; tag: string | null; style: Style | null; testament: Testament; book: string | null; view: "verse" | "date" | "flat"; sort: "bible" | "newest" | "oldest" };
const DEFAULT: Query = { color: null, tag: null, style: null, testament: "all", book: null, view: "verse", sort: "bible" };
const STYLES: [Style, string][] = [["highlight", "Background"], ["underline", "Underlined"], ["circle", "Circled"]];
const TESTAMENTS: [Testament, string][] = [["all", "Whole Bible"], ["old", "Old Testament"], ["new", "New Testament"], ["apocrypha", "Apocrypha"]];
const SORTS: [Query["sort"], string][] = [["bible", "Bible order"], ["newest", "Newest first"], ["oldest", "Oldest first"]];
const TESTAMENT_OF: Record<Exclude<Testament, "all">, Book["testament"]> = { old: "Old Testament", new: "New Testament", apocrypha: "Apocrypha" };

function useAllMarks() {
  const [records, setRecords] = useState<Annotation[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void allAnnotations().then((a) => { if (live) setRecords(a); }).catch(() => { if (live) setRecords([]); });
    load(); const off = subscribeStudies(load);
    return () => { live = false; off(); };
  }, []);
  return useMemo(() => (records ? groupMarks(records) : null), [records]);
}

export default function Annotations() {
  useBackButton(true);
  const navigate = useNavigate(), sheet = useSheet();
  const marks = useAllMarks();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const colors = colorItems(settings, palette);
  const [tags] = useTags();
  const [q, setQ] = useState<Query>(DEFAULT);
  const set = (p: Partial<Query>) => setQ((x) => ({ ...x, ...p }));

  const order = useMemo(() => new Map((books.data ?? []).map((b, i) => [b.slug, i])), [books.data]);
  const bookOf = (slug: string) => books.data?.find((b) => b.slug === slug);
  const place = (k: string) => { const p = parseVerseKey(k)!; return [order.get(p.slug) ?? 999, p.chapter, p.verse] as const; };
  const compareKeys = (a: string, b: string) => { const x = place(a), y = place(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  const inScope = (k: string) => {
    const slug = parseVerseKey(k)!.slug;
    if (q.book) return slug === q.book;
    return q.testament === "all" || bookOf(slug)?.testament === TESTAMENT_OF[q.testament];
  };
  const time = (m: Mark) => Date.parse(m.created) || 0;

  const list = useMemo(() => (marks ?? []).filter((m) => {
    if (q.color && m.color !== q.color) return false;
    if (q.tag && !m.tags?.[q.tag]) return false;
    if (q.style && m.style !== q.style) return false;
    return m.records.some((r) => inScope(r.verseKey));
  }).sort((a, b) => {
    if (q.sort === "newest") return time(b) - time(a) || a.id.localeCompare(b.id);
    if (q.sort === "oldest") return time(a) - time(b) || a.id.localeCompare(b.id);
    return compareKeys(a.records[0].verseKey, b.records[0].verseKey) || a.id.localeCompare(b.id);
  }), [marks, q, order]); // eslint-disable-line react-hooks/exhaustive-deps

  const reference = (keys: string[]) => {
    const p = parseVerseKey(keys[0])!;
    return `${bookOf(p.slug)?.book ?? p.slug} ${p.chapter}:${compactVerses(keys.map((k) => parseVerseKey(k)!.verse))}`;
  };
  const open = (m: Mark) => { const p = parseVerseKey(m.records[0].verseKey)!; navigate(`/read/${p.slug}/${p.chapter}?v=${compactVerses(m.records.map((r) => parseVerseKey(r.verseKey)!.verse))}`); };
  const card = (m: Mark) => (
    <button key={m.id} type="button" className="ann-card" onClick={() => open(m)}>
      <span className="ann-card__text">{m.records.map((r) => r.quote).join(" ... ")}</span>
      <span className="ann-card__meta">{reference(m.records.map((r) => r.verseKey))} • KJV{m.note ? " • Has a note" : ""}</span>
    </button>
  );
  const groups = (() => {
    if (q.view === "verse") {
      const by = new Map<string, Mark[]>();
      for (const m of list) { const k = m.records.map((r) => r.verseKey).filter(inScope).sort(compareKeys)[0]; if (k) by.set(k, [...(by.get(k) ?? []), m]); }
      return [...by.entries()].sort(([a], [b]) => compareKeys(a, b)).map(([k, ms]) => ({ key: k, label: reference([k]), marks: ms.sort((a, b) => (q.sort === "oldest" ? time(a) - time(b) : time(b) - time(a)) || a.id.localeCompare(b.id)) }));
    }
    if (q.view === "date") {
      const by = new Map<string, Mark[]>();
      for (const m of list) { const d = new Date(time(m)).toISOString().slice(0, 10); by.set(d, [...(by.get(d) ?? []), m]); }
      return [...by.entries()].sort(([a], [b]) => (q.sort === "oldest" ? a.localeCompare(b) : b.localeCompare(a)))
        .map(([d, ms]) => ({ key: d, label: new Date(`${d}T12:00:00`).toLocaleDateString(), marks: ms.sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id)) }));
    }
    return null;
  })();

  const pick = async <T extends string>(title: string, options: [T | "", string][], apply: (v: T | null) => void) => {
    const a = await sheet.open({ title, items: options.map(([id, text]) => ({ id: id || "__all", text })) });
    if (a) apply(a.id === "__all" ? null : (a.id as T));
  };
  const colorName = (key: string) => { const i = colors.findIndex((c) => c.key === key); return colors[i]?.name || (key.startsWith("color") ? `Color ${i + 1}` : "Custom color"); };
  const tagList = Object.values(tags).sort((a, b) => a.name.localeCompare(b.name));
  const bookList = (books.data ?? []).filter((b) => q.testament === "all" || b.testament === TESTAMENT_OF[q.testament]);

  return (
    <Screen title="Annotations">
      <Chips>
        <Chip on={!!q.color} onClick={() => void pick("Colour", [["", "All"], ...colors.map((c) => [c.key, colorName(c.key)] as [string, string])], (color) => set({ color }))}>Colour: {q.color ? colorName(q.color) : "All"}</Chip>
        <Chip on={!!q.tag} onClick={() => void pick("Tags", [["", "All"], ...tagList.map((t) => [t.id, t.name] as [string, string])], (tag) => set({ tag }))}>Tags: {q.tag ? tags[q.tag]?.name ?? "All" : "All"}</Chip>
        <Chip on={!!q.style} onClick={() => void pick<Style>("Style", [["", "All"], ...STYLES], (style) => set({ style }))}>Style: {q.style ? STYLES.find(([s]) => s === q.style)![1] : "All"}</Chip>
        <Chip on={q.testament !== "all"} onClick={() => void pick<Testament>("Testament", TESTAMENTS, (t) => set({ testament: t ?? "all", book: null }))}>Testament: {TESTAMENTS.find(([t]) => t === q.testament)![1]}</Chip>
        <Chip on={!!q.book} onClick={() => void pick("Book", [["", "All"], ...bookList.map((b) => [b.slug, b.book] as [string, string])], (book) => set({ book }))}>Book: {q.book ? bookOf(q.book)?.book ?? q.book : "All"}</Chip>
        <Chip on={q.sort !== "bible"} onClick={() => void pick<Query["sort"]>("Order", SORTS, (sort) => set({ sort: sort ?? "bible" }))}>Order: {SORTS.find(([s]) => s === q.sort)![1]}</Chip>
      </Chips>
      <Segmented label="View" value={q.view} onChange={(view) => set({ view })} options={[["verse", "By verse"], ["date", "By date"], ["flat", "List"]]} />
      {marks === null ? null : !list.length ? (
        <Empty title={marks.length ? "Nothing matches these filters" : "No annotations yet"}>{marks.length ? "Change or clear a filter to see your annotations." : "You have not annotated any words yet. In the Bible, double-tap a word to start."}</Empty>
      ) : groups ? (
        <div className="ann-list">{groups.map((g) => <section key={g.key}><h3 className="ann-group">{g.label}</h3>{g.marks.map(card)}</section>)}</div>
      ) : <div className="ann-list">{list.map(card)}</div>}
    </Screen>
  );
}

