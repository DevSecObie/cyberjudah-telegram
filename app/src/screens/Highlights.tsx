import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import { colorItems, paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { uuid, useTags } from "@/bible/store";
import { Checkbox } from "@/bible/ui/Sheet";
import { ColorCirclesBar } from "@/bible/ui/SelectedVersesSheet";
import { editHighlight, editMark, loadHighlightItems, type TaggedHighlight, type TaggedMark } from "@/lib/tag-items";
import { parseVerseKey } from "@/lib/relations";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { confirmDelete, ContextualPanel, FiltersButton, PanelAction, PanelSearch } from "@/ui/panel";
import { Screen } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { AnnotationItem, HighlightItem } from "./tag-detail";

type Testament = "all" | "old" | "new";
type Sort = "newest" | "oldest" | "bible";
type Query = { typeFilter?: "highlights" | "annotations"; colorId?: string; tagId?: string; testament?: Testament; book?: string; sort?: Sort };
type Item = { type: "highlight"; data: TaggedHighlight } | { type: "annotation"; data: TaggedMark };

/** Bible Strong's highlightsListQueryAtom: the filters kept between visits. */
const QUERY_KEY = "cj:entityListFilters.highlights.v1";
const readQuery = (): Query => { try { return JSON.parse(localStorage.getItem(QUERY_KEY) ?? "{}") as Query; } catch { return {}; } };
const TESTAMENTS: [Testament, string][] = [["all", "Whole Bible"], ["old", "Old Testament"], ["new", "New Testament"]];
const SORTS: [Sort, string][] = [["newest", "Newest"], ["oldest", "Oldest"], ["bible", "Bible order"]];
/** As Bible Strong's FlatList draws only what comes into view: thirty rows, then thirty more near the end. */
const PAGE = 30;

/** Every highlight and word mark, read again after each change. */
function useHighlightItems() {
  const [items, setItems] = useState<{ highlights: TaggedHighlight[]; wordAnnotations: TaggedMark[] }>({ highlights: [], wordAnnotations: [] });
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => { void loadHighlightItems().then(setItems).catch(() => undefined).finally(() => setLoaded(true)); }, []);
  useEffect(reload, [reload]);
  return { ...items, loaded, reload };
}

/**
 * Bible Strong's HighlightsScreen: the filter button (Type, Color, Tags, Testament, Book, Order,
 * kept between visits), then every highlight and word mark as its Verse and AnnotationItem rows,
 * each with its options (Change color, Edit tags, Remove).
 */
export function Highlights() {
  useBackButton();
  const [params] = useSearchParams();
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const [tags] = useTags();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const { highlights, wordAnnotations, loaded, reload } = useHighlightItems();
  const [now] = useState(() => Date.now());
  // A tag opened from the reader narrows the list to it.
  const [q, setQState] = useState<Query>(() => ({ ...readQuery(), ...(params.get("tag") ? { tagId: params.get("tag")! } : {}) }));
  const setQ = (next: Query) => { setQState(next); try { localStorage.setItem(QUERY_KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  const colors = colorItems(settings, palette).map((c, i) => ({ ...c, label: c.name || (c.key.startsWith("color") ? `Color ${i + 1}` : `Custom color ${i - 4}`) }));
  const order = useMemo(() => new Map((books.data ?? []).map((b, i) => [b.slug, { i, testament: b.testament }])), [books.data]);
  const inTestament = (slug: string, t: Testament | undefined) => !t || t === "all" || order.get(slug)?.testament === (t === "old" ? "Old Testament" : "New Testament");
  const slugsOf = (item: Item) => (item.type === "highlight" ? item.data.verses.map((v) => v.slug) : item.data.verseKeys.map((k) => parseVerseKey(k)?.slug ?? ""));
  const firstVerse = (item: Item) => {
    const vs = item.type === "highlight" ? item.data.verses : item.data.verseKeys.map(parseVerseKey).filter((p): p is NonNullable<typeof p> => !!p);
    return vs.map((v) => [order.get(v.slug)?.i ?? 0, v.chapter, v.verse]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])[0] ?? [0, 0, 0];
  };
  const shown = useMemo(() => {
    const all: Item[] = [
      ...(q.typeFilter === "annotations" ? [] : highlights.map((h) => ({ type: "highlight" as const, data: h }))),
      ...(q.typeFilter === "highlights" ? [] : wordAnnotations.map((a) => ({ type: "annotation" as const, data: a }))),
    ];
    return all
      .filter((it) => (!q.colorId || it.data.color === q.colorId) && (!q.tagId || it.data.tags?.[q.tagId]))
      .filter((it) => (q.book ? slugsOf(it).includes(q.book) : slugsOf(it).some((s) => inTestament(s, q.testament))))
      .sort((a, b) => {
        if (q.sort === "oldest") return a.data.date - b.data.date;
        if (q.sort === "bible") { const x = firstVerse(a), y = firstVerse(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }
        return b.data.date - a.data.date;
      });
  }, [highlights, wordAnnotations, q, order]); // eslint-disable-line react-hooks/exhaustive-deps
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [q]);
  const end = useRef<HTMLDivElement>(null);
  const more = shown.length > limit;
  useEffect(() => {
    const el = end.current; if (!el || !more) return;
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) setLimit((n) => n + PAGE); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);
  const tagList = Object.values(tags).filter((t) => t && typeof t.name === "string" && typeof t.id === "string");
  const color = colors.find((c) => c.key === q.colorId);
  const book = books.data?.find((b) => b.slug === q.book);
  const testament = q.testament ?? "all";
  const filters = (
    <FiltersButton onReset={() => setQ({})} filters={[
      { key: "type", icon: "layers", label: "Type", value: q.typeFilter === "highlights" ? "Highlights" : q.typeFilter === "annotations" ? "Annotations" : "All", active: !!q.typeFilter,
        options: ([[undefined, "All"], ["highlights", "Highlights"], ["annotations", "Annotations"]] as const).map(([k, label]) => ({ key: k ?? "all", label, selected: q.typeFilter === k, onSelect: () => setQ({ ...q, typeFilter: k }) })) },
      { key: "color", icon: "droplet", label: "Color", value: color?.label ?? "All", color: color?.hex, active: !!q.colorId,
        options: [{ key: "all", label: "All", selected: !q.colorId, onSelect: () => setQ({ ...q, colorId: undefined }) }, ...colors.map((c) => ({ key: c.key, label: c.label, color: c.hex, selected: q.colorId === c.key, onSelect: () => setQ({ ...q, colorId: c.key }) }))] },
      { key: "tags", icon: "tag", label: "Tags", value: (q.tagId && tags[q.tagId]?.name) || "All", active: !!q.tagId,
        options: [{ key: "all", label: "All", selected: !q.tagId, onSelect: () => setQ({ ...q, tagId: undefined }) }, ...tagList.map((t) => ({ key: t.id, label: t.name, selected: q.tagId === t.id, onSelect: () => setQ({ ...q, tagId: t.id }) }))] },
      { key: "testament", icon: "book", label: "Testament", value: TESTAMENTS.find(([t]) => t === testament)![1], active: testament !== "all",
        options: TESTAMENTS.map(([t, label]) => ({ key: t, label, selected: testament === t, onSelect: () => setQ({ ...q, testament: t, book: q.book && t !== "all" && !inTestament(q.book, t) ? undefined : q.book }) })) },
      { key: "book", icon: "bookmark", label: "Book", value: book?.book ?? "All", active: !!q.book,
        options: [{ key: "all", label: "All", selected: !q.book, onSelect: () => setQ({ ...q, book: undefined }) }, ...(books.data ?? []).filter((b) => b.testament !== "Apocrypha" && inTestament(b.slug, testament)).map((b) => ({ key: b.slug, label: b.book, selected: q.book === b.slug, onSelect: () => setQ({ ...q, book: b.slug }) }))] },
      { key: "sort", icon: "list", label: "Order", value: SORTS.find(([s]) => s === (q.sort ?? "newest"))![1], active: !!q.sort && q.sort !== "newest",
        options: SORTS.map(([s, label]) => ({ key: s, label, selected: (q.sort ?? "newest") === s, onSelect: () => setQ({ ...q, sort: s }) })) },
    ]} />
  );
  return (
    <Screen title="Highlights" className="hlscreen" action={filters}>
      {!loaded ? null : shown.length ? (
        <div className="hlscreen__list">
          {shown.slice(0, limit).map((it) => it.type === "highlight"
            ? <HighlightItem key={`h${it.data.date}`} item={it.data} now={now} options={<HighlightOptions item={it} colors={colors} onChanged={reload} />} />
            : <AnnotationItem key={`a${it.data.id}`} item={it.data} now={now} options={<HighlightOptions item={it} colors={colors} onChanged={reload} />} />)}
          {more ? <div ref={end} className="list-more" role="status">Loading more…</div> : null}
        </div>
      ) : <EmptyState icon="highlight" message={highlights.length || wordAnnotations.length ? "No items match these filters." : "You haven't highlighted anything yet ..."} />}
    </Screen>
  );
}

/** Bible Strong's HighlightOptions: Change color (its colours), Edit tags (search, check, create), Remove. */
function HighlightOptions({ item, colors, onChanged }: { item: Item; colors: ReturnType<typeof colorItems>; onChanged: () => void }) {
  const [tags, setTags] = useTags();
  const [query, setQuery] = useState("");
  const [itemTags, setItemTags] = useState(item.data.tags ?? {});
  const mark = item.type === "annotation";
  const edit = async (fn: <T extends { color?: string; tags?: Record<string, true> }>(x: T) => T | null) => {
    if (item.type === "highlight") await editHighlight(item.data, fn);
    else await editMark(item.data.id, fn);
    onChanged();
  };
  const toggleTag = (id: string) => {
    const next = { ...itemTags }; if (next[id]) delete next[id]; else next[id] = true;
    setItemTags(next); haptic("select");
    void edit((x) => ({ ...x, tags: Object.keys(next).length ? next : undefined }));
  };
  const needle = query.trim().toLocaleLowerCase();
  const valid = Object.values(tags).filter((t) => t && typeof t.name === "string" && typeof t.id === "string");
  const matching = valid.filter((t) => t.name.toLocaleLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <span className="tagd-item__options">
      <ContextualPanel triggerSize={28} trigger={<Feather name="more-vertical" size={20} />} label="More options" initialScreen="actions" onClose={() => setQuery("")} screens={{
        actions: {
          title: "Highlights",
          content: (nav) => (
            <>
              <PanelAction nested icon="droplet" label="Change color" onPress={() => nav.open("colors")} />
              <PanelAction nested icon="tag" label="Edit tags" onPress={() => nav.open("tags")} />
              <PanelAction icon="trash-2" destructive label="Remove" onPress={() => {
                nav.close();
                void confirmDelete(mark ? "Are you sure you want to delete this annotation?" : "Are you sure you want to delete this highlight?", "Remove").then((ok) => { if (ok) void edit(() => null); });
              }} />
            </>
          ),
        },
        colors: {
          title: "Change color",
          content: (nav) => <div className="hlscreen__colors"><ColorCirclesBar colors={colors} selected={item.data.color ?? null} onSelect={(k) => { void edit((x) => ({ ...x, color: k })); nav.back(); }} /></div>,
        },
        tags: {
          title: "Edit tags",
          headerContent: <PanelSearch value={query} onChange={setQuery} />,
          content: () => (
            <>
              {matching.map((t) => (
                <button key={t.id} type="button" role="checkbox" aria-checked={!!itemTags[t.id]} className="panel-choice" onClick={() => toggleTag(t.id)}>
                  <Checkbox checked={!!itemTags[t.id]} /><span>{t.name}</span>
                </button>
              ))}
              {needle && !valid.some((t) => t.name.toLocaleLowerCase() === needle) ? (
                <PanelAction icon="plus" label={`Create « ${query.trim()} »`} onPress={() => {
                  const id = uuid();
                  setTags({ ...tags, [id]: { id, name: query.trim(), date: Date.now() } });
                  toggleTag(id); setQuery("");
                }} />
              ) : null}
            </>
          ),
        },
      }} />
    </span>
  );
}
