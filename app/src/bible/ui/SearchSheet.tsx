import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { useEffect, useRef, useState } from "react";

import { data, type Book } from "@/api/data";
import { useNavigate } from "react-router";
import { haptic } from "@/tg/sdk";
import { findBook, parseReference } from "../../../../bot/src/refs.mjs";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";
import bookRows from "../../../../bot/data/bs-books.json";

/**
 * Search the Scriptures: a reference goes straight there ("john 3:16", "ps 23", "ruth"), and
 * words find the verses that hold them, every book with the Apocrypha, words in quotes kept
 * together. A result opens the chapter at that verse.
 */
const useDebounced = (v: string, ms: number) => { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]); return d; };

export function SearchSheet({ open, initial = "", onClose, books, onGo }: { open: boolean; initial?: string; onClose: () => void; books: Book[]; onGo: (slug: string, chapter: number, verse?: number, verseEnd?: number) => void }) {
  const [q, setQ] = useState("");
  // Bible Strong's search filters: the canon (Old Testament, New Testament, Apocrypha) and one book.
  const [canon, setCanon] = useState<"" | Book["testament"]>("");
  const [bookFilter, setBookFilter] = useState("");
  const [sort, setSort] = useState("relevance");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(initial); const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 250); return () => clearTimeout(t); } setQ(""); setCanon(""); setBookFilter(""); }, [open, initial]);
  const text = q.trim();
  const ref = text ? parseReference(text, books) : null;
  const bookOnly = text && !ref && !/\d/.test(text) && text.length >= 2 ? findBook(text, books) : null;
  const words = useDebounced(ref ? "" : text, 300);
  const found = useInfiniteQuery({
    queryKey: ["bible-search", words, canon, bookFilter, sort], enabled: open && words.length >= 3,
    initialPageParam: 0, staleTime: 5 * 60_000,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ q: words, limit: "50", offset: String(pageParam), sortOrder: sort });
      const id = bookRows.find(b => b.slug === bookFilter)?.id;
      if (id) query.set("book", String(id));
      if (canon) query.set("section", canon === "Old Testament" ? "ot" : canon === "New Testament" ? "nt" : "apoc");
      const response = await fetch(`/bs/v1/bibles/KJV/search?${query}`);
      if (!response.ok) throw new Error("Scripture search is unavailable.");
      return response.json() as Promise<{ results: { book: number; chapter: number; verse: number; text: string }[]; count: number }>;
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.results.length, 0);
      return last.results.length && loaded < last.count ? loaded : undefined;
    },
  });
  const navigate = useNavigate();
  const everyone = useQuery({ queryKey: ["people-index"], enabled: open && text.length >= 2, staleTime: Infinity, queryFn: () => data.people() });
  const who = !ref && text.length >= 2 ? (everyone.data ?? []).filter((p) => p.names.some((n) => n.toLowerCase().startsWith(text.toLowerCase()))).sort((a, b) => b.verses - a.verses).slice(0, 5) : [];
  const name = (slug: string) => books.find((b) => b.slug === slug)?.book ?? slug;
  const testament = (slug: string) => books.find((b) => b.slug === slug)?.testament;
  const hits = (found.data?.pages ?? []).flatMap(p => p.results).flatMap(h => {
    const b = bookRows.find(b => b.id === h.book);
    return b ? [{ slug: b.slug, chapter: h.chapter, verse: h.verse, label: `${name(b.slug)} ${h.chapter}:${h.verse}`, snippet: h.text }] : [];
  });
  const count = found.data?.pages[0]?.count ?? 0;
  const canons: ["" | Book["testament"], string][] = [["", "All"], ["Old Testament", "Old Testament"], ["New Testament", "New Testament"], ["Apocrypha", "Apocrypha"]];
  const bookChoices = canon ? books.filter((b) => b.testament === canon) : books;
  const terms = words.toLowerCase().replace(/"/g, "").split(/\s+/).filter((w) => w.length > 2);
  const go = (slug: string, chapter: number, verse?: number, verseEnd?: number) => { haptic("select"); onGo(slug, chapter, verse, verseEnd); onClose(); };

  return (
    <Sheet open={open} onClose={onClose} height="full" title="Search the Scriptures" className="bs-versesearch">
      <form className="bs-search__field" onSubmit={(e) => { e.preventDefault(); if (ref) go(ref.slug, ref.chapter, ref.verse, ref.verseEnd); else if (bookOnly) go(bookOnly.slug, 1); else if (hits[0]) go(hits[0].slug, hits[0].chapter, hits[0].verse); }}>
        <Feather name="search" size={18} color="var(--bs-tertiary)" />
        <input ref={input} type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="John 3:16, a name, or words in a verse" aria-label="Search the Scriptures" autoComplete="off" />
        {q ? <button type="button" className="bs-iconbtn" aria-label="Clear" title="Clear" onClick={() => { setQ(""); input.current?.focus({ preventScroll: true }); }}><Feather name="x" size={16} /></button> : null}
      </form>
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
      <div className="bs-search__list">
        {ref ? <Row icon="arrow-right-circle" title={`Go to ${ref.label.replace(ref.book, name(ref.slug))}`} sub={ref.verseEnd ? "Open this passage" : "Open the chapter at this verse"} onClick={() => go(ref.slug, ref.chapter, ref.verse, ref.verseEnd)} /> : null}
        {bookOnly ? <Row icon="book-open" title={`Go to ${name(bookOnly.slug)}`} sub={`${bookOnly.chapters} chapters`} onClick={() => go(bookOnly.slug, 1)} /> : null}
        {who.map((p) => <Row key={p.id} icon="users" leading={<EntityAvatar id={p.id} name={p.name} kind={avatarKind(p.type)} size={30} ink={avatarKind(p.type) === "female" ? "var(--bs-quart)" : "var(--bs-primary)"} base="var(--bs-reverse)" />} title={p.name} sub={`${p.description} · named in ${p.verses} ${p.verses === 1 ? "verse" : "verses"}`} onClick={() => { haptic("select"); onClose(); navigate(`/person/${p.id}`); }} />)}
        {!text ? <p className="bs-search__hint">Type a reference to go there, or a few words to find the verses. Put words in quotes to keep them together.</p> : null}
        {words.length >= 3 && found.isPending ? <p className="bs-search__hint">Searching…</p> : null}
        {words.length >= 3 && found.isError ? <p className="bs-search__hint" role="alert">Search is unavailable. <button type="button" onClick={() => void found.refetch()}>Retry</button></p> : null}
        {words.length >= 3 && found.isSuccess && !hits.length && !bookOnly ? <p className="bs-search__hint">No matching verses{bookFilter ? ` in ${name(bookFilter)}` : canon ? ` in the ${canon}` : ""}.</p> : null}
        {hits.length > 0 && <p className="bs-search__count">{count.toLocaleString()} {count === 1 ? "verse" : "verses"}{bookFilter ? ` in ${name(bookFilter)}` : canon ? ` in the ${canon}` : ""}</p>}
        {hits.map((h) => (
          <button key={`${h.slug}${h.chapter}:${h.verse}`} type="button" className="bs-search__hit" onClick={() => go(h.slug, h.chapter, h.verse)}>
            <b>{h.label}</b>
            <span><Mark text={h.snippet} terms={terms} /></span>
          </button>
        ))}
        {found.hasNextPage && <button type="button" className="bs-btn" disabled={found.isFetchingNextPage} onClick={() => void found.fetchNextPage()}>{found.isFetchingNextPage ? "Loading more…" : "More verses"}</button>}
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
