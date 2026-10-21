import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Feather, Ion } from "@/bible/icons";
import { useAllNotes, useBookmarks, useTags, type Bookmark } from "@/bible/store";
import { BookmarkForm } from "@/bible/ui/Editors";
import { confirmDelete, ContextualPanel, FiltersButton, PanelAction, PanelSearch } from "@/ui/panel";
import { Chip, Chips, Empty, List, Row, Screen, SearchField } from "@/ui/ui";
import { ENTITY_LIST_SORTS, queryEntityList, type EntityListSort } from "@/lib/entity-list";
import { EmptyState } from "./new-tab-search";

function useBookName() {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  return (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug;
}
const readerAt = (b: Bookmark) => `/read/${b.book}/${b.chapter}${b.verse ? `?at=${b.verse}` : ""}`;

/**
 * Bible Strong's BookmarksScreen: the filter button (Search, Order), then a row per bookmark,
 * its colour, its name over its reference, and its options. The old Kept addresses
 * (`?tab=highlights`, `?tab=notes`, `?tag=`) lead to the Highlights and Notes screens.
 */
export function Bookmarks() {
  useBackButton();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useBookmarks();
  const bookName = useBookName();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const tab = params.get("tab"), tag = params.get("tag");
  if (tab === "notes") return <Navigate replace to={tag ? `/notes?tag=${encodeURIComponent(tag)}` : "/notes"} />;
  if (tab === "highlights" || tag) return <Navigate replace to={tag ? `/highlights?tag=${encodeURIComponent(tag)}` : "/highlights"} />;
  const reference = (b: Bookmark) => `${bookName(b.book)} ${b.chapter}${b.verse !== undefined ? `:${b.verse}` : ""}`;
  const needle = query.trim().toLocaleLowerCase();
  const visible = bookmarks
    .filter((b) => `${b.name} ${reference(b)}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => (sort === "oldest" ? a.date - b.date : b.date - a.date));
  const update = (id: string, patch: Partial<Bookmark>) => setBookmarks(bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id: string) => setBookmarks(bookmarks.filter((b) => b.id !== id));
  const filters = (
    <FiltersButton onReset={() => { setQuery(""); setSort("newest"); }} filters={[
      { key: "search", icon: "search", label: "Search", value: query.trim() || undefined, active: !!query.trim(), content: () => <PanelSearch value={query} onChange={setQuery} /> },
      { key: "sort", icon: "list", label: "Order", value: sort === "oldest" ? "Oldest" : "Newest", active: sort !== "newest", options: (["newest", "oldest"] as const).map((s) => ({ key: s, label: s === "oldest" ? "Oldest" : "Newest", selected: sort === s, onSelect: () => setSort(s) })) },
    ]} />
  );
  return (
    <Screen title="Bookmarks" className="bmscreen" action={filters}>
      {bookmarks.length ? (
        <div className="bmscreen__list">
          {visible.map((b) => (
            <div key={b.id} className="bmitem">
              <Link to={readerAt(b)} className="bmitem__link" onClick={() => haptic("select")}>
                <Ion name="bookmark" size={20} color={b.color} />
                <span className="bmitem__text"><b>{b.name}</b><span>{reference(b)}</span></span>
              </Link>
              <BookmarkOptions bookmark={b} onNavigate={() => navigate(readerAt(b))} onSave={(patch) => update(b.id, patch)} onRemove={() => remove(b.id)} />
            </div>
          ))}
        </div>
      ) : <EmptyState icon="bookmark" message="No bookmarks yet..." />}
    </Screen>
  );
}

/** Bible Strong's BookmarkOptionsPanel: View in Bible, Edit (the name and colour, in the panel), Remove. */
function BookmarkOptions({ bookmark, onNavigate, onSave, onRemove }: { bookmark: Bookmark; onNavigate: () => void; onSave: (patch: Partial<Bookmark>) => void; onRemove: () => void }) {
  const [name, setName] = useState(bookmark.name);
  const [color, setColor] = useState(bookmark.color);
  const reset = () => { setName(bookmark.name); setColor(bookmark.color); };
  return (
    <ContextualPanel triggerSize={54} trigger={<Feather name="more-vertical" size={20} />} label="More options" initialScreen="actions" onClose={reset} screens={{
      actions: {
        title: "Bookmark",
        content: (nav) => (
          <>
            <PanelAction icon="book-open" label="View in Bible" onPress={() => { nav.close(); onNavigate(); }} />
            <PanelAction nested icon="edit-2" label="Edit" onPress={() => { reset(); nav.open("edit"); }} />
            <PanelAction icon="trash-2" destructive label="Remove" onPress={() => { nav.close(); void confirmDelete("Are you sure you want to delete this bookmark?", "Remove").then((ok) => { if (ok) onRemove(); }); }} />
          </>
        ),
      },
      edit: {
        title: "Edit",
        content: (nav) => (
          <BookmarkForm name={name} color={color} onNameChange={setName} onColorChange={setColor} onSave={() => { onSave({ name: name.trim() || bookmark.name, color }); nav.close(); }} />
        ),
      },
    }} />
  );
}

/** Bible Strong's AllNotesTabScreen: filter by tag, then search and sort (queryEntityList). */
export function Notes() {
  useBackButton();
  const [params, setParams] = useSearchParams();
  const [tags] = useTags();
  const bookName = useBookName();
  const tagFilter = params.get("tag") ?? "";
  const { rows: allNotes } = useAllNotes();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<EntityListSort>("newest");
  const tagged = useMemo(() => (tagFilter ? allNotes.filter((n) => n.note.tags?.[tagFilter]) : allNotes), [allNotes, tagFilter]);
  const notes = useMemo(() => queryEntityList(tagged.map((n) => ({ ...n, id: `${n.slug}/${n.chapter}/${n.key}`, title: n.note.title || "Untitled note", description: n.note.description, date: n.note.date })), { query, sort }), [tagged, query, sort]);
  return (
    <Screen title="Notes" kicker="Synced with your Telegram account">
      {!allNotes.length ? <Empty title="No notes yet" action={{ label: "Open the Bible", href: "/bible" }}>Select a verse and tap Note.</Empty> : (
        <>
          <SearchField id="notes-search" value={query} onChange={setQuery} placeholder="Search notes" />
          <Chips>{ENTITY_LIST_SORTS.map(([value, label]) => <Chip key={value} on={sort === value} onClick={() => setSort(value)}>{label}</Chip>)}</Chips>
          {Object.keys(tags).length ? <Chips><Chip on={!tagFilter} onClick={() => setParams({}, { replace: true })}>All tags</Chip>{Object.values(tags).map((t) => <Chip key={t.id} on={tagFilter === t.id} onClick={() => setParams(tagFilter === t.id ? {} : { tag: t.id }, { replace: true })}>{t.name}</Chip>)}</Chips> : null}
          {!notes.length ? <Empty title="No matching notes">Try another word, tag or order.</Empty> : (
            <List>{notes.map((n) => <Row key={n.id} href={`/read/${n.slug}/${n.chapter}?v=${n.key.split("/")[0]}`} meta={`${bookName(n.slug)} ${n.chapter}:${n.key.replace("/", ",")}`} title={n.title} sub={n.note.description} />)}</List>
          )}
        </>
      )}
    </Screen>
  );
}
