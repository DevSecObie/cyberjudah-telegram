import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import { compactVerses, useAllNotes, useTags, versesOfKey, writeNote, type Note } from "@/bible/store";
import { queryEntityList, ENTITY_LIST_SORTS, type EntityListSort } from "@/lib/entity-list";
import { deleteRelation, identity, useSavedRelations, verseKey, type Relation } from "@/lib/relations";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { useOpenInNewTab } from "@/ui/open-in-new-tab";
import { confirmDelete, ContextualPanel, FiltersButton, PanelAction, PanelSearch } from "@/ui/panel";
import { Screen } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { timeAgo } from "./tab-groups";
import { EntityChipList, truncate } from "./tag-detail";

type Query = { query: string; sort: EntityListSort; tagId?: string };
type Row = { id: string; slug: string; chapter: number; key: string; note: Note; title: string; description?: string; date: number; reference: string; relations: Relation[] };

/** Bible Strong's notesListQueryAtom: the search, order and tag kept between visits. */
const QUERY_KEY = "cj:entityListFilters.notes.v1";
const DEFAULT_QUERY: Query = { query: "", sort: "newest" };
const readQuery = (): Query => { try { return { ...DEFAULT_QUERY, ...JSON.parse(localStorage.getItem(QUERY_KEY) ?? "{}") }; } catch { return DEFAULT_QUERY; } };
const PAGE = 30;
const readerAt = (r: Pick<Row, "slug" | "chapter" | "key">) => `/read/${r.slug}/${r.chapter}?v=${versesOfKey(r.key)[0]}`;

/**
 * Bible Strong's BibleVerseNotesScreen: the filter button (Search, Order, Tags, kept between
 * visits), then a BibleNoteItem per note: where and how long ago, its title and the start of its
 * text, its tags and relations, and its options.
 */
export function Notes() {
  useBackButton();
  const [params] = useSearchParams();
  const [tags] = useTags();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug;
  const { rows: all, loaded, reload } = useAllNotes();
  const saved = useSavedRelations();
  const [now] = useState(() => Date.now());
  // A tag opened from an old Kept address narrows the list to it.
  const [q, setQState] = useState<Query>(() => ({ ...readQuery(), ...(params.get("tag") ? { tagId: params.get("tag")! } : {}) }));
  const setQ = (next: Query) => { setQState(next); try { localStorage.setItem(QUERY_KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  const byNote = useMemo(() => {
    const out = new Map<string, Relation[]>();
    for (const r of saved) for (const e of r.endpoints) if (e.type === "note") out.set(identity(e), [...(out.get(identity(e)) ?? []), r]);
    return out;
  }, [saved]);
  const rows = useMemo(() => all.map((n): Row => {
    const verses = versesOfKey(n.key);
    return { ...n, id: `${n.slug}/${n.chapter}/${n.key}`, title: n.note.title || "", description: n.note.description, date: n.note.date, reference: `${bookName(n.slug)} ${n.chapter}:${compactVerses(verses)}`, relations: byNote.get(`note:${verseKey(n.slug, n.chapter, verses[0])}`) ?? [] };
  }), [all, byNote, books.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => queryEntityList(rows.filter((r) => !q.tagId || r.note.tags?.[q.tagId]), q), [rows, q]);
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
  const filters = (
    <FiltersButton onReset={() => setQ(DEFAULT_QUERY)} filters={[
      { key: "search", icon: "search", label: "Search", value: q.query.trim() || undefined, active: !!q.query.trim(), content: () => <PanelSearch value={q.query} onChange={(query) => setQ({ ...q, query })} /> },
      { key: "sort", icon: "list", label: "Order", value: ENTITY_LIST_SORTS.find(([s]) => s === q.sort)?.[1], active: q.sort !== "newest", options: ENTITY_LIST_SORTS.map(([s, label]) => ({ key: s, label, selected: q.sort === s, onSelect: () => setQ({ ...q, sort: s }) })) },
      { key: "tags", icon: "tag", label: "Tags", value: (q.tagId && tags[q.tagId]?.name) || "All", active: !!q.tagId,
        options: [{ key: "all", label: "All", selected: !q.tagId, onSelect: () => setQ({ ...q, tagId: undefined }) }, ...tagList.map((t) => ({ key: t.id, label: t.name, selected: q.tagId === t.id, onSelect: () => setQ({ ...q, tagId: t.id }) }))] },
    ]} />
  );
  return (
    <Screen title="Notes" className="notesscreen" action={filters}>
      {!loaded ? null : shown.length ? (
        <div className="notesscreen__list">
          {shown.slice(0, limit).map((r) => <BibleNoteItem key={r.id} row={r} now={now} onRemoved={reload} />)}
          {more ? <div ref={end} className="list-more" role="status">Loading more…</div> : null}
        </div>
      ) : <EmptyState icon="note" message={all.length ? (q.query.trim() ? `No results found for "${q.query}"` : "No items match these filters.") : "You don't have any notes yet ..."} />}
    </Screen>
  );
}

/** Bible Strong's BibleNoteItem: "Psalms 23:1-2 - 2 days ago", the title, the start of the text, then the tags and relations. */
function BibleNoteItem({ row, now, onRemoved }: { row: Row; now: number; onRemoved: () => void }) {
  const navigate = useNavigate();
  const title = row.note.title?.trim() ?? "", description = row.note.description?.trim() ?? "";
  const chips = !!Object.keys(row.note.tags ?? {}).length || !!row.relations.length;
  const relationsAt = `/relations?endpoint=${encodeURIComponent(`note:${verseKey(row.slug, row.chapter, versesOfKey(row.key)[0])}`)}`;
  return (
    <div className="noteitem">
      <div className="noteitem__main">
        <Link to={readerAt(row)} className="noteitem__link" data-chips={chips ? "" : undefined} onClick={() => haptic("select")}>
          <small className="noteitem__meta">{`${row.reference} - ${timeAgo(row.note.date, now)}`}</small>
          {title ? <b className="noteitem__title">{title}</b> : null}
          {description && description !== title ? <span className="noteitem__desc">{truncate(description, 100)}</span> : null}
        </Link>
        {chips ? <div className="noteitem__chips"><EntityChipList tags={row.note.tags} relationCount={row.relations.length} onRelationPress={() => navigate(relationsAt)} /></div> : null}
      </div>
      <NoteOptions row={row} onRemoved={onRemoved} />
    </div>
  );
}

/** Bible Strong's NoteOptionsPanel: View in Bible, Open in new tab, Remove (its link to the verse too). */
function NoteOptions({ row, onRemoved }: { row: Row; onRemoved: () => void }) {
  const navigate = useNavigate();
  const openInNewTab = useOpenInNewTab();
  return (
    <ContextualPanel triggerSize={54} trigger={<Feather name="more-vertical" size={20} />} label="More options" initialScreen="actions" screens={{
      actions: {
        title: "Notes",
        content: (nav) => (
          <>
            <PanelAction icon="book-open" label="View in Bible" onPress={() => { nav.close(); navigate(readerAt(row)); }} />
            <PanelAction icon="external-link" label="Open in new tab" onPress={() => { nav.close(); openInNewTab(readerAt(row)); }} />
            <PanelAction icon="trash-2" destructive label="Remove" onPress={() => {
              nav.close();
              void confirmDelete("Are you sure you want to delete this note?", "Remove").then(async (ok) => {
                if (!ok) return;
                await writeNote(row.slug, row.chapter, row.key, null);
                for (const r of row.relations) await deleteRelation(r);
                onRemoved();
              });
            }} />
          </>
        ),
      },
    }} />
  );
}
