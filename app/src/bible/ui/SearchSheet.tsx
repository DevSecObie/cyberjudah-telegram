import { useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { Empty, SearchField } from "@/ui/ui";
import { useEffect, useRef, useState } from "react";

import { data, type Book } from "@/api/data";
import { useNavigate } from "react-router";
import { haptic } from "@/tg/sdk";
import { findBook, parseReference } from "../../../../bot/src/refs.mjs";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";
import bookRows from "../../../../bot/data/bs-books.json";
import { SEARCH_DEBOUNCE_MS, SEARCH_PAGE_SIZE, ScriptureSearchError, searchRateLimitSeconds, searchRetry, uniquePassages, type PassagePage } from "../search";
import "./search.css";

type SearchPage = PassagePage & { query: string };

/**
 * Search the Scriptures: a reference goes straight there ("john 3:16", "ps 23", "ruth"), and
 * words find the verses that hold them, every book with the Apocrypha, words in quotes kept
 * together. A result opens the chapter at that verse.
 */
export function SearchSheet({ open, initial = "", onClose, books, onGo }: { open: boolean; initial?: string; onClose: () => void; books: Book[]; onGo: (slug: string, chapter: number, verse?: number, verseEnd?: number) => void }) {
  const [q, setQ] = useState("");
  const [text, setText] = useState("");
  // Bible Strong's search filters: the canon (Old Testament, New Testament, Apocrypha) and one book.
  const [canon, setCanon] = useState<"" | Book["testament"]>("");
  const [bookFilter, setBookFilter] = useState("");
  const [sort, setSort] = useState("relevance");
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setQ(initial); setText(initial.trim()); const t = setTimeout(() => field.current?.querySelector("input")?.focus({ preventScroll: true }), 250); return () => clearTimeout(t); } setQ(""); setText(""); setCanon(""); setBookFilter(""); }, [open, initial]);
  useEffect(() => {
    if (!open || q.trim() === text) return;
    const timeout = setTimeout(() => setText(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [open, q, text]);
  const ref = text ? parseReference(text, books) : null;
  const bookOnly = text && !ref && !/\d/.test(text) && text.length >= 2 ? findBook(text, books) : null;
  const words = ref ? "" : text;
  const enabled = open && words.length >= 3;
  const found = useInfiniteQuery<SearchPage, Error, InfiniteData<SearchPage>, string[], number>({
    queryKey: ["bible-search", words, canon, bookFilter, sort], enabled,
    initialPageParam: 0, staleTime: 5 * 60_000,
    ...searchRetry,
    // 27.2.0 keeps a previous query usable while its replacement loads, within the same filters.
    placeholderData: (previous, query) => enabled && JSON.stringify(query?.queryKey.slice(2)) === JSON.stringify([canon, bookFilter, sort]) ? previous : undefined,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ q: words, limit: String(SEARCH_PAGE_SIZE), offset: String(pageParam), sortOrder: sort });
      const id = bookRows.find(b => b.slug === bookFilter)?.id;
      if (id) query.set("book", String(id));
      if (canon) query.set("section", canon === "Old Testament" ? "ot" : canon === "New Testament" ? "nt" : "apoc");
      const response = await fetch(`/bs/v1/bibles/KJV/search?${query}`, { signal });
      if (!response.ok) throw new ScriptureSearchError(response.status, response.headers.get("Retry-After"));
      return { ...await response.json() as PassagePage, query: words };
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.results.length, 0);
      return last.results.length > 0 && loaded < last.count ? loaded : undefined;
    },
  });
  useEffect(() => {
    const scroll = list.current?.closest(".bs-sheet__body");
    if (!open || !scroll) return;
    const loadNearEnd = () => {
      if (enabled && found.hasNextPage && !found.isFetching && !found.isPlaceholderData && !found.isError && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= scroll.clientHeight * 0.4) void found.fetchNextPage();
    };
    scroll.addEventListener("scroll", loadNearEnd, { passive: true });
    loadNearEnd();
    return () => scroll.removeEventListener("scroll", loadNearEnd);
  }, [open, enabled, found.hasNextPage, found.isFetching, found.isPlaceholderData, found.isError, found.fetchNextPage]);
  const navigate = useNavigate();
  const everyone = useQuery({ queryKey: ["people-index"], enabled: open && text.length >= 2, staleTime: Infinity, queryFn: () => data.people() });
  const who = !ref && text.length >= 2 ? (everyone.data ?? []).filter((p) => p.names.some((n) => n.toLowerCase().startsWith(text.toLowerCase()))).sort((a, b) => b.verses - a.verses).slice(0, 5) : [];
  const name = (slug: string) => books.find((b) => b.slug === slug)?.book ?? slug;
  const testament = (slug: string) => books.find((b) => b.slug === slug)?.testament;
  const hits = uniquePassages(enabled ? found.data?.pages ?? [] : []).flatMap(h => {
    const b = bookRows.find(b => b.id === h.book);
    return b ? [{ slug: b.slug, chapter: h.chapter, verse: h.verse, label: `${name(b.slug)} ${h.chapter}:${h.verse}`, snippet: h.text }] : [];
  });
  const count = found.data?.pages[0]?.count ?? 0;
  const canons: ["" | Book["testament"], string][] = [["", "All"], ["Old Testament", "Old Testament"], ["New Testament", "New Testament"], ["Apocrypha", "Apocrypha"]];
  const bookChoices = canon ? books.filter((b) => b.testament === canon) : books;
  const terms = (found.data?.pages[0]?.query ?? words).toLowerCase().replace(/"/g, "").split(/\s+/).filter((w) => w.length > 2);
  const limited = enabled ? searchRateLimitSeconds(found.failureReason ?? found.error) : undefined;
  const go = (slug: string, chapter: number, verse?: number, verseEnd?: number) => { haptic("select"); onGo(slug, chapter, verse, verseEnd); onClose(); };

  return (
    <Sheet open={open} onClose={onClose} height="full" title="Search the Scriptures" className="bs-versesearch" headerChildren={
      <div ref={field} className="reader-search__field">
        <SearchField id="reader-search" value={q} onChange={value => { setQ(value); if (!value) setText(""); }} onSubmit={() => { setQ(q.trim()); setText(q.trim()); }} placeholder="Search" />
      </div>
    }>
      {!ref && !bookOnly && text.length >= 3 ? (
        <div className="bs-search__filters" role="group" aria-label="Search in">
          {canons.map(([v, label]) => <button key={v} type="button" className="bs-chip" aria-pressed={canon === v} onClick={() => { haptic("select"); setCanon(v); if (v && bookFilter && testament(bookFilter) !== v) setBookFilter(""); }}>{label}</button>)}
          <select className="bs-chip bs-chip--select" aria-label="One book" value={bookFilter} onChange={(e) => { haptic("select"); setBookFilter(e.target.value); }}>
            <option value="">Any book</option>
            {bookChoices.map((b) => <option key={b.slug} value={b.slug}>{b.book}</option>)}
          </select>
          <select className="bs-chip bs-chip--select" aria-label="Result order" value={sort} onChange={e => setSort(e.target.value)}><option value="relevance">Relevance</option><option value="book">Bible order</option></select>
        </div>
      ) : null}
      {limited !== undefined ? <p className="reader-search__limit" role="status">{found.isFetching ? `Too many searches in a short time. Retrying automatically after ${limited} seconds.` : `The search limit has been reached. Wait ${limited} seconds before trying again.`}</p> : null}
      <div ref={list} className="bs-search__list">
        {ref ? <Row icon="arrow-right-circle" title={`Go to ${ref.label.replace(ref.book, name(ref.slug))}`} sub={ref.verseEnd ? "Open this passage" : "Open the chapter at this verse"} onClick={() => go(ref.slug, ref.chapter, ref.verse, ref.verseEnd)} /> : null}
        {bookOnly ? <Row icon="book-open" title={`Go to ${name(bookOnly.slug)}`} sub={`${bookOnly.chapters} chapters`} onClick={() => go(bookOnly.slug, 1)} /> : null}
        {who.map((p) => <Row key={p.id} icon="users" leading={<EntityAvatar id={p.id} name={p.name} kind={avatarKind(p.type)} size={30} ink={avatarKind(p.type) === "female" ? "var(--bs-quart)" : "var(--bs-primary)"} base="var(--bs-reverse)" />} title={p.name} sub={`${p.description} · named in ${p.verses} ${p.verses === 1 ? "verse" : "verses"}`} onClick={() => { haptic("select"); onClose(); navigate(`/person/${p.id}`); }} />)}
        {!text ? <p className="bs-search__hint">Type a reference to go there, or a few words to find the verses. Put words in quotes to keep them together.</p> : null}
        {enabled && found.isFetching && !found.isFetchingNextPage ? <p className="bs-search__hint" role="status">Searching…</p> : null}
        {enabled && found.isError && limited === undefined ? <p className="bs-search__hint" role="alert">Bible search could not be opened. <button type="button" onClick={() => void found.refetch()}>Retry</button></p> : null}
        {enabled && found.isSuccess && !found.isPlaceholderData && !hits.length && !bookOnly ? <Empty title="No results">No results found for "{text}"</Empty> : null}
        {hits.length > 0 && <p className="bs-search__count">{count.toLocaleString()} {count === 1 ? "verse" : "verses"}{bookFilter ? ` in ${name(bookFilter)}` : canon ? ` in the ${canon}` : ""}</p>}
        {hits.map((h) => (
          <button key={`${h.slug}${h.chapter}:${h.verse}`} type="button" className="bs-search__hit" onClick={() => go(h.slug, h.chapter, h.verse)}>
            <b>{h.label}</b>
            <span><Mark text={h.snippet} terms={terms} /></span>
          </button>
        ))}
        {enabled && found.isFetchingNextPage ? <p className="bs-search__hint" role="status">Searching…</p> : null}
      </div>
    </Sheet>
  );
}

function Row({ icon, title, sub, onClick, leading }: { icon: "arrow-right-circle" | "book-open" | "users"; title: string; sub: string; onClick: () => void; leading?: React.ReactNode }) {
  return (
    <button type="button" className="bs-search__go" onClick={onClick}>
      {leading ?? <Feather name={icon} size={20} color="var(--bs-primary)" />}
      <span><b>{title}</b><small>{sub}</small></span>
    </button>
  );
}

/** The words searched for, marked in the verse. */
function Mark({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`\\b(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}
