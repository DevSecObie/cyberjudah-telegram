import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { useBackButton, useStored } from "@/tg/hooks";
import { json, store } from "@/tg/store";
import { Feather, Ion, type FeatherName } from "@/bible/icons";
import { useAllNotes, useBookmarks, useTags, verseToReference, type Bookmark } from "@/bible/store";
import { colorItems, highlightInfo, paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { BookmarkSheet } from "@/bible/ui/Editors";
import { Sheet } from "@/bible/ui/Sheet";
import { allAnnotations, subscribeStudies } from "@/studies/storage";
import { Empty, Icon, List, Row, Screen, SearchField, Segmented } from "@/ui/ui";
import { useSheet } from "@/ui/sheet";
import { DEFAULT_NOTES_QUERY, ENTITY_LIST_SORTS, annotationNoteRows, highlightKey, inTestament, normalizeHighlightFilters, normalizeListQuery, queryBookmarks, queryEntityList, queryHighlights, type HighlightChapter, type HighlightFilters, type HighlightListItem } from "@/lib/entity-list";
import { timeAgo } from "./tab-groups";
import "./kept-lists.css";

type Tab = "bookmarks" | "highlights" | "notes";
type Filter = { id: string; label: string; icon: FeatherName; value?: string; active: boolean; options?: [string, string][]; selected?: string; select?: (value: string) => void };

function useHighlights() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["kept-highlights"], queryFn: async () => {
    const chapters: HighlightChapter[] = [];
    for (const key of await store.keys()) {
      const match = /^bs_h_(.+)_(\d+)$/.exec(key);
      if (match) chapters.push({ slug: match[1], chapter: +match[2], verses: await json.get(key, {}) });
    }
    return { chapters, annotations: await allAnnotations() };
  } });
  useEffect(() => {
    let live = true;
    const refresh = () => { void client.invalidateQueries({ queryKey: ["kept-highlights"] }); };
    const off = [subscribeStudies(refresh)];
    void store.keys().then(keys => { if (!live) return; keys.filter(key => /^bs_h_.+_\d+$/.test(key)).forEach(key => off.push(store.subscribe(key, refresh))); refresh(); }).catch(() => undefined);
    return () => { live = false; off.forEach(stop => stop()); };
  }, [client]);
  return query;
}

/** The three existing destinations, using the 27.2.0 query/filter rules for each list. */
export function Bookmarks() {
  useBackButton();
  const navigate = useNavigate();
  const sheet = useSheet();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "notes" ? "notes" : params.get("tab") === "highlights" || params.has("tag") ? "highlights" : "bookmarks";
  const [bookmarks, setBookmarks] = useBookmarks();
  const [tags, , tagsLoaded] = useTags();
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const colors = colorItems(settings, palette);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const bookName = (slug: string) => books.data?.find(b => b.slug === slug)?.book ?? slug;
  const reference = (b: Bookmark) => `${bookName(b.book)} ${b.chapter}${b.verse && b.verse > 0 ? `:${b.verse}` : ""}`;
  const bookmarkPath = (b: Bookmark) => `/read/${b.book}/${b.chapter}${b.verse && b.verse > 0 ? `?v=${b.verse}` : ""}`;
  const [bookmarkQuery, setBookmarkQuery] = useState<{ query: string; sort: "newest" | "oldest" }>({ query: "", sort: "newest" });
  const [savedNotes, saveNotes, notesReady] = useStored("notes-list-query", DEFAULT_NOTES_QUERY);
  const notesState = normalizeListQuery(savedNotes);
  const [savedHighlights, saveHighlights, highlightsReady] = useStored<HighlightFilters>("highlights-list-query", {});
  const highlightsState = normalizeHighlightFilters(savedHighlights);
  const { rows: allNotes, loaded: notesLoaded } = useAllNotes();
  const highlights = useHighlights();
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  // Existing tag deep links seed the appropriate remembered list without coupling the lists.
  const linkedTag = params.get("tag");
  useEffect(() => {
    if (!linkedTag || !notesReady || !highlightsReady) return;
    if (tab === "notes") saveNotes({ ...notesState, tagId: linkedTag });
    else saveHighlights({ ...highlightsState, tagId: linkedTag });
    setParams({ tab }, { replace: true });
  }, [linkedTag, notesReady, highlightsReady, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tagsLoaded || !notesReady || !highlightsReady) return;
    if (notesState.tagId && !tags[notesState.tagId]) saveNotes({ ...notesState, tagId: null });
    if (highlightsState.tagId && !tags[highlightsState.tagId]) saveHighlights({ ...highlightsState, tagId: undefined });
  }, [tags, tagsLoaded, notesReady, highlightsReady, notesState.tagId, highlightsState.tagId]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownHighlights = queryHighlights(highlights.data?.chapters ?? [], highlights.data?.annotations ?? [], highlightsState);
  const noteRows = [...allNotes.map(n => ({ ...n, annotation: false })), ...annotationNoteRows(highlights.data?.annotations ?? [])];
  const notes = queryEntityList(noteRows.filter(n => !notesState.tagId || n.note.tags?.[notesState.tagId]).map(n => ({ ...n, id: n.annotation ? n.note.id : `${n.slug}/${n.chapter}/${n.key}`, title: n.note.title || "Untitled note", description: n.note.description, date: n.note.date })), notesState);
  const shownBookmarks = queryBookmarks(bookmarks, bookmarkQuery, reference);
  const query = tab === "notes" ? notesState.query : bookmarkQuery.query;
  const setQuery = (value: string) => tab === "notes" ? saveNotes({ ...notesState, query: value }) : setBookmarkQuery({ ...bookmarkQuery, query: value });
  const patchHighlight = (patch: Partial<HighlightFilters>) => saveHighlights({ ...highlightsState, ...patch });
  const tagOptions: [string, string][] = [["", "All"], ...Object.values(tags).filter(t => t && typeof t.name === "string").map(t => [t.id, t.name] as [string, string])];
  const filters: Filter[] = tab === "highlights" ? [
    { id: "type", label: "Type", icon: "layers", value: highlightsState.typeFilter === "highlights" ? "Highlights" : highlightsState.typeFilter === "annotations" ? "Annotations" : "All", active: !!highlightsState.typeFilter && highlightsState.typeFilter !== "all", options: [["all", "All"], ["highlights", "Highlights"], ["annotations", "Annotations"]], selected: highlightsState.typeFilter ?? "all", select: value => patchHighlight({ typeFilter: value as HighlightFilters["typeFilter"] }) },
    { id: "color", label: "Color", icon: "edit-3", value: colors.find(c => c.key === highlightsState.colorId)?.name || (highlightsState.colorId ? `Color ${colors.findIndex(c => c.key === highlightsState.colorId) + 1}` : "All"), active: !!highlightsState.colorId, options: [["", "All"], ...colors.map((c, i) => [c.key, c.name || `Color ${i + 1}`] as [string, string])], selected: highlightsState.colorId ?? "", select: colorId => patchHighlight({ colorId: colorId || undefined }) },
    { id: "tags", label: "Tags", icon: "tag", value: tags[highlightsState.tagId ?? ""]?.name || "All", active: !!highlightsState.tagId, options: tagOptions, selected: highlightsState.tagId ?? "", select: tagId => patchHighlight({ tagId: tagId || undefined }) },
    { id: "testament", label: "Testament", icon: "book", value: highlightsState.testament === "old" ? "Old Testament" : highlightsState.testament === "new" ? "New Testament" : "Whole Bible", active: !!highlightsState.testament && highlightsState.testament !== "all", options: [["all", "Whole Bible"], ["old", "Old Testament"], ["new", "New Testament"]], selected: highlightsState.testament ?? "all", select: value => { const testament = value as HighlightFilters["testament"]; patchHighlight({ testament, book: highlightsState.book && inTestament(highlightsState.book, testament) ? highlightsState.book : undefined }); } },
    { id: "book", label: "Book", icon: "bookmark", value: highlightsState.book ? bookName(highlightsState.book) : "All", active: !!highlightsState.book, options: [["", "All"], ...(books.data ?? []).filter(b => inTestament(b.slug, highlightsState.testament)).map(b => [b.slug, b.book] as [string, string])], selected: highlightsState.book ?? "", select: book => patchHighlight({ book: book || undefined }) },
    { id: "sort", label: "Order", icon: "list", value: highlightsState.sort === "bible" ? "Bible order" : highlightsState.sort === "oldest" ? "Oldest" : "Newest", active: !!highlightsState.sort && highlightsState.sort !== "newest", options: [["newest", "Newest"], ["oldest", "Oldest"], ["bible", "Bible order"]], selected: highlightsState.sort ?? "newest", select: sort => patchHighlight({ sort: sort as HighlightFilters["sort"] }) },
  ] : [
    { id: "search", label: "Search", icon: "search", value: query.trim() || undefined, active: !!query.trim() },
    { id: "sort", label: "Order", icon: "list", value: ENTITY_LIST_SORTS.find(([id]) => id === (tab === "notes" ? notesState.sort : bookmarkQuery.sort))?.[1], active: (tab === "notes" ? notesState.sort : bookmarkQuery.sort) !== "newest", options: tab === "notes" ? ENTITY_LIST_SORTS : [["newest", "Newest"], ["oldest", "Oldest"]], selected: tab === "notes" ? notesState.sort : bookmarkQuery.sort, select: sort => tab === "notes" ? saveNotes(normalizeListQuery({ ...notesState, sort })) : setBookmarkQuery({ ...bookmarkQuery, sort: sort as "newest" | "oldest" }) },
    ...(tab === "notes" ? [{ id: "tags", label: "Tags", icon: "tag" as const, value: tags[notesState.tagId ?? ""]?.name || "All", active: !!notesState.tagId, options: tagOptions, selected: notesState.tagId ?? "", select: (tagId: string) => saveNotes({ ...notesState, tagId: tagId || null }) }] : []),
  ];
  const active = filters.filter(f => f.active);
  const reset = () => tab === "highlights" ? saveHighlights({}) : tab === "notes" ? saveNotes(DEFAULT_NOTES_QUERY) : setBookmarkQuery({ query: "", sort: "newest" });
  const openFilters = async () => {
    const answer = await sheet.open({ title: "Filters", items: [...filters.map(f => ({ id: f.id, text: f.label, hint: f.value, icon: <Feather name={f.icon} size={20} /> })), ...(active.length ? [{ id: "reset", text: "Reset" }] : [])] });
    if (answer?.id === "reset") return reset();
    if (answer?.id === "search") return setSearchOpen(true);
    const filter = filters.find(f => f.id === answer?.id);
    if (!filter?.options) return;
    const choice = await sheet.open({ title: filter.label, items: filter.options.map(([id, text]) => ({ id, text, icon: id === filter.selected ? <Icon name="check" size={18} /> : undefined })) });
    if (choice) filter.select?.(choice.id);
  };
  const options = async (bookmark: Bookmark) => {
    const answer = await sheet.open({ title: "Bookmark", items: [{ id: "open", text: "View in Bible", icon: <Feather name="book-open" size={20} /> }, { id: "edit", text: "Edit", icon: <Feather name="edit-2" size={20} /> }, { id: "remove", text: "Remove", icon: <Feather name="trash-2" size={20} />, destructive: true }] });
    if (answer?.id === "open") navigate(bookmarkPath(bookmark));
    if (answer?.id === "edit") setEditing(bookmark);
    if (answer?.id === "remove") {
      const yes = await sheet.open({ title: "Are you sure you want to delete this bookmark?", items: [{ id: "cancel", text: "Cancel" }, { id: "remove", text: "Remove", destructive: true }] });
      if (yes?.id === "remove") setBookmarks(bookmarks.filter(b => b.id !== bookmark.id));
    }
  };
  return <Screen title={tab === "bookmarks" ? "Bookmarks" : tab === "highlights" ? "Highlights" : "Notes"} className="kept-screen" action={<button type="button" className="kept-screen__filter" aria-label={active.length ? `${active.length} active filters` : "Filter"} onClick={() => void openFilters()}>{active.length ? <span>{active.length === 1 ? <Feather name={active[0].icon} size={14} /> : active.length}<Feather name="chevron-down" size={13} /></span> : <Icon name="filter" size={20} />}</button>}>
    <Segmented label="Kind" value={tab} onChange={tab => setParams({ tab }, { replace: true })} options={[["bookmarks", "Bookmarks"], ["highlights", "Highlights"], ["notes", "Notes"]]} />
    {tab === "bookmarks" ? !bookmarks.length ? <Empty title="No bookmarks yet..." /> : <List>{shownBookmarks.map(b => <div className="kept-screen__bookmark" key={b.id}><Row href={bookmarkPath(b)} leading={<Ion name="bookmark" size={20} color={b.color} />} title={b.name} sub={reference(b)} trailing={<></>} /><button type="button" className="kept-screen__options" aria-label={`Options for ${b.name}`} onClick={() => void options(b)}><Feather name="more-vertical" size={20} /></button></div>)}</List> : tab === "highlights" ? highlights.isError ? <Empty title="Highlights could not be loaded" action={{ label: "Retry", onClick: () => void highlights.refetch() }} /> : highlights.isPending ? null : !shownHighlights.length ? <Empty title={highlights.data.chapters.some(c => Object.keys(c.verses).length) || highlights.data.annotations.length ? "No items match these filters." : "You haven't highlighted anything yet ..."} /> : <List>{shownHighlights.map(item => <HighlightRow key={item.id} item={item} bookName={bookName} />)}</List> : !notesLoaded || highlights.isPending ? null : !notes.length ? <Empty title={!noteRows.length ? "You don't have any notes yet ..." : notesState.query.trim() ? `No results found for "${notesState.query}"` : "No items match these filters."} /> : <List>{notes.map(n => <div className="kept-screen__note" key={n.id}><Row href={`/read/${n.slug}/${n.chapter}?v=${n.key.split("/")[0]}`} meta={`${bookName(n.slug)} ${n.chapter}:${n.key.replaceAll("/", ",")}${n.annotation ? " (annotation)" : ""} · ${timeAgo(n.date, Date.now())}`} title={n.title} sub={n.description?.slice(0, 100)} trailing={<></>} /></div>)}</List>}
    <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search" headerChildren={<div className="kept-screen__search"><SearchField id="kept-search" value={query} onChange={setQuery} onSubmit={() => setSearchOpen(false)} placeholder="Search" autoFocus /></div>}><></></Sheet>
    {editing ? <BookmarkSheet open onClose={() => setEditing(null)} reference={reference(editing)} location={editing} existing={editing} bookmarks={bookmarks} setBookmarks={setBookmarks} formatReference={reference} /> : null}
  </Screen>;
}

function HighlightRow({ item, bookName }: { item: HighlightListItem; bookName: (slug: string) => string }) {
  const [tags] = useTags();
  const [settings] = useBibleSettings();
  const color = highlightInfo(item.color, settings, paletteOf(resolveTheme(settings, telegramScheme()), settings));
  const chapters = [...new Map(item.locations.map(v => [`${v.slug}/${v.chapter}`, v])).values()];
  const content = useQueries({ queries: chapters.map(v => ({ queryKey: ["chapter", v.slug, v.chapter], queryFn: () => data.chapter(v.slug, v.chapter), enabled: item.kind === "highlight", staleTime: Infinity })) });
  const text = item.kind === "annotation" ? `...${item.text}...` : content.flatMap((q, i) => q.data?.verses.filter(v => item.locations.some(at => at.slug === chapters[i].slug && at.chapter === chapters[i].chapter && at.verse === v.verse)).map(v => v.text) ?? []).join(" ").slice(0, 200);
  const first = item.locations[0], reference = verseToReference(item.locations.map(highlightKey), bookName);
  return <div className="kept-screen__highlight" data-kind={item.kind}>
    <Row href={`/read/${first.slug}/${first.chapter}?v=${first.verse}`} title={<span className="kept-screen__reference"><i data-style={item.style ?? color.type} style={{ color: color.hex, background: item.style === "underline" || color.type === "underline" ? "transparent" : color.hex }} />{reference}<small>{timeAgo(item.date, Date.now())}</small></span>} sub={<><span>{text || "The text is unavailable in the installed Bible."}</span><span className="kept-screen__tags">{Object.keys(item.tags).filter(id => tags[id]).map(id => <span key={id}>{tags[id].name}</span>)}</span></>} trailing={<></>} />
  </div>;
}
