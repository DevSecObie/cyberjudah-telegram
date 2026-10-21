import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { data, type Book } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useAllNotes } from "@/bible/store";
import { Sheet } from "@/bible/ui/Sheet";
import { SheetSearchInput } from "@/bible/ui/SheetSearchInput";
import raw from "@/data/timeline.json";
import { assetUrl } from "@/lib/asset";
import { searchWithMatches } from "@/lib/entity-list";
import type { Study } from "@/studies/model";
import { listStudies, subscribeStudies } from "@/studies/storage";
import { AlphabetList, firstLetter } from "@/ui/alphabet";
import { useSettled } from "@/ui/search-bar";
import { flatten, hasDetails } from "@shared/timeline.mjs";
import type { TimelineData } from "@shared/timeline.mjs";
import { parseReference } from "../../../bot/src/refs.mjs";
import bookRows from "../../../bot/data/bs-books.json";
import { findStrongs, gloss, useStrongsIndex } from "./Lexicon";

/**
 * Bible Strong's scoped Search sheet (commandPalette/GlobalCommandPalette over
 * search/SearchSelectionSheet), as a New Tab card opens it: titled Search, at three quarters of the
 * screen, its field taking the keyboard. Each card searches its own kind, and the tab becomes what
 * is picked; closing it leaves the New Tab as it was.
 */
export type Scope = "bible" | "timeline" | "study" | "notes" | "strong" | "nave" | "dictionary";
/** The cards that open the sheet (Bible Strong's paletteScopes), by the page each one would open. */
export const SCOPES: Record<string, Scope> = { "/bible": "bible", "/timeline": "timeline", "/studies": "study", "/bookmarks": "notes", "/lexicon": "strong", "/topics": "nave", "/dictionary": "dictionary" };

type Kind = "passages" | "timeline" | "studies" | "notes" | "strong" | "nave" | "dictionary";
type Item = { id: string; kind: Kind; title: string; chip?: string; subtitle?: string; description?: string; lines?: number; path: string };
type Section = { id: Kind; title: string; items: Item[]; loading?: boolean; more?: () => void; hasMore?: boolean };
/** A source that failed to load, with its retry (the resource failure or the catalog's Retry). */
type Failure = { retry: () => void } | null;

/** Each kind's colour (themes/universeColors), on the row's left edge. */
const EDGE: Record<Kind, string> = {
  passages: "var(--bs-tertiary, var(--text-3))", timeline: "var(--bs-tertiary, var(--text-3))", studies: "var(--bs-tertiary, var(--text-3))",
  notes: "#ff7675", strong: "var(--bs-primary, var(--accent))", nave: "var(--bs-quint, var(--violet))", dictionary: "var(--bs-secondary, rgb(255, 188, 0))",
};
/** The browse lists: one kind with nothing typed, as SearchSelectionSheet's browseMode. */
const BROWSE: Partial<Record<Scope, { label: string; placeholder: string; icon: string }>> = {
  notes: { label: "Notes", placeholder: "Search in notes", icon: "note" },
  study: { label: "Studies", placeholder: "Search in studies", icon: "study" },
  strong: { label: "Strong", placeholder: "Search a Strong code", icon: "word" },
  nave: { label: "Nave", placeholder: "Search in Nave", icon: "word" },
  dictionary: { label: "Dictionary", placeholder: "Search in dictionary", icon: "word" },
};
const PLACEHOLDER: Partial<Record<Scope, string>> = { bible: "A passage, for example Gen 1:2-5…", timeline: "Search in Timeline…" };
const PREVIEW = 5, MORE = 10, PAGE = 20;
const TIMELINE = raw as unknown as TimelineData;

/** matchesQuery: every word of the query, accents aside, somewhere in the values. */
const matches = (query: string, ...values: (string | undefined)[]) => {
  const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const text = fold(values.filter(Boolean).join(" "));
  return fold(query).trim().split(/\s+/).every((w) => text.includes(w));
};

export function SearchPicker({ scope, onClose, onPick }: { scope: Scope | null; onClose: () => void; onPick: (path: string) => void }) {
  const [shown, setShown] = useState<Scope | null>(scope);
  useEffect(() => { if (scope) setShown(scope); }, [scope]);
  const box = useRef<HTMLDivElement>(null);
  // The field takes the keyboard once the sheet is up (onPresent → focus).
  useEffect(() => {
    if (!scope) return;
    const t = window.setTimeout(() => box.current?.querySelector("input")?.focus({ preventScroll: true }), 250);
    return () => window.clearTimeout(t);
  }, [scope]);
  const [q, setQ] = useState("");
  useEffect(() => { if (!scope) setQ(""); }, [scope]);
  const kind = shown ?? "bible";
  const browse = BROWSE[kind];
  return (
    <Sheet open={!!scope} onClose={onClose} snapPoints={[0.75]} background="reverse" title="Search" label="Search"
      headerChildren={<div ref={box} className="spick__field"><SheetSearchInput value={q} onChange={setQ} placeholder={browse?.placeholder ?? PLACEHOLDER[kind] ?? "Search"} /></div>}>
      {shown ? <Results key={`${shown}`} scope={shown} active={!!scope} q={q} onPick={onPick} /> : null}
    </Sheet>
  );
}

function Results({ scope, active, q, onPick }: { scope: Scope; active: boolean; q: string; onPick: (path: string) => void }) {
  const text = q.trim();
  const settled = useSettled(text, 300);
  const [letter, setLetter] = useState("a");
  const [counts, setCounts] = useState<Partial<Record<Kind, number>>>({});
  useEffect(() => setCounts({}), [settled]);
  const browse = BROWSE[scope];
  const sections = useSections(scope, active, text, settled, letter);
  const list = useRef<HTMLDivElement>(null);
  // The browse lists of Strong, Nave and the dictionary load the next page near their end.
  const onScroll = () => {
    const el = list.current; if (!el || el.scrollTop + el.clientHeight < el.scrollHeight * 0.6) return;
    const s = sections.sections[0];
    if (s && !text && (scope === "strong" || scope === "nave" || scope === "dictionary") && s.hasMore) s.more?.();
  };
  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [letter, settled]);
  const all = (id: Kind) => !text ? (scope === "strong" && id === "strong") || (scope === "nave" && id === "nave") || (scope === "dictionary" && id === "dictionary") : false;
  const message = browse ? `No item found in ${browse.label.toLowerCase()}` : text ? "No target found" : "Search for a passage, Strong, note, study, Nave, or word";
  const showBrowser = scope === "bible" && !text;
  const alpha = !settled && (scope === "strong" || scope === "nave" || scope === "dictionary");
  return (
    <div className="spick">
      <div ref={list} className="spick__list" onScroll={onScroll}>
        {showBrowser ? <PassageBrowser onPick={onPick} /> : sections.failed && !sections.sections.length ? <div className="spick__failed"><button type="button" onClick={sections.failed.retry}>Retry</button></div> : sections.sections.length ? sections.sections.map((s) => {
          const shown = all(s.id) ? s.items.length : counts[s.id] ?? PREVIEW;
          return <SectionBlock key={s.id} section={s} visible={shown} showMore={!all(s.id)} onMore={() => {
            const now = counts[s.id] ?? PREVIEW;
            setCounts((c) => ({ ...c, [s.id]: now + MORE }));
            if (now + MORE >= s.items.length && s.hasMore) s.more?.();
          }} onPick={onPick} />;
        }) : sections.loading ? <div className="spick__loading"><span className="spick__spinner" aria-label="Loading" /></div>
          : <EmptyState icon={browse?.icon ?? "search"} message={message} />}
      </div>
      {alpha ? <AlphabetList letter={letter} setLetter={setLetter} color={scope === "nave" ? "var(--bs-quint, var(--violet))" : scope === "dictionary" ? "var(--bs-secondary, rgb(255, 188, 0))" : "var(--bs-primary, var(--accent))"} /> : null}
    </div>
  );
}

/** The results by section, in SearchSelectionSheet's order, for the one kind the card searches. */
function useSections(scope: Scope, active: boolean, text: string, settled: string, letter: string): { sections: Section[]; loading: boolean; failed?: Failure } {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity, enabled: scope === "bible" });
  const passages = usePassages(scope === "bible" && active, text, settled, books.data ?? []);
  const strongs = useStrongs(scope === "strong" && active, settled, letter);
  const topics = useTopics(scope === "nave" && active, settled, letter);
  const dictionary = useDictionary(scope === "dictionary" && active, settled, letter);
  const studies = useStudies(scope === "study" && active, text);
  const notes = useNotes(scope === "notes" && active, text);
  const timeline = useMemo(() => scope === "timeline" ? timelineItems(text) : [], [scope, text]);
  const one = (s: Section | null, loading = false, failed: Failure = null) => ({ sections: s && s.items.length ? [s] : [], loading, failed });
  switch (scope) {
    case "bible": return one({ id: "passages", title: "Passages", items: passages.items, hasMore: passages.hasMore, more: passages.more, loading: passages.loading }, passages.loading || text !== settled, passages.failed);
    case "strong": return one({ id: "strong", title: "Strong", ...strongs }, strongs.loading || text !== settled, strongs.failed);
    case "nave": return one({ id: "nave", title: "Nave", ...topics }, topics.loading || text !== settled, topics.failed);
    case "dictionary": return one({ id: "dictionary", title: "Dictionary", ...dictionary }, dictionary.loading || text !== settled, dictionary.failed);
    case "study": return one({ id: "studies", title: "Studies", items: studies.items }, studies.loading);
    case "notes": return one({ id: "notes", title: "Notes", items: notes.items }, notes.loading);
    case "timeline": return one({ id: "timeline", title: "Timeline", items: timeline });
  }
}

/** A reference typed goes straight to it; words find the verses that hold them (the KJV search). */
function usePassages(enabled: boolean, text: string, words: string, books: Book[]) {
  const ref = text ? parseReference(text, books) : null;
  const search = !ref && words.length >= 3 ? words : "";
  const found = useInfiniteQuery({
    queryKey: ["bible-search", search, "", "", "relevance"], enabled: enabled && !!search, initialPageParam: 0, staleTime: 5 * 60_000,
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams({ q: search, limit: "50", offset: String(pageParam), sortOrder: "relevance" });
      const response = await fetch(`/bs/v1/bibles/KJV/search?${query}`);
      if (!response.ok) throw new Error("Scripture search is unavailable.");
      return response.json() as Promise<{ results: { book: number; chapter: number; verse: number; text: string }[]; count: number }>;
    },
    getNextPageParam: (last, pages) => { const loaded = pages.reduce((n, p) => n + p.results.length, 0); return last.results.length > 0 && loaded < last.count ? loaded : undefined; },
  });
  const items: Item[] = [];
  if (ref) items.push({ id: `reference:${ref.slug}:${ref.chapter}:${ref.verse ?? ""}`, kind: "passages", title: ref.label, path: `/read/${ref.slug}/${ref.chapter}${ref.verse ? `?v=${ref.verse}${ref.verseEnd ? `-${ref.verseEnd}` : ""}` : ""}` });
  if (search) for (const r of found.data?.pages.flatMap((p) => p.results) ?? []) {
    const slug = bookRows.find((b) => b.id === r.book)?.slug;
    const name = books.find((b) => b.slug === slug)?.book;
    if (slug && name) items.push({ id: `verse:${r.book}-${r.chapter}-${r.verse}`, kind: "passages", title: `${name} ${r.chapter}:${r.verse}`, chip: "KJV", description: r.text, lines: 3, path: `/read/${slug}/${r.chapter}?v=${r.verse}` });
  }
  return { items, loading: !!search && found.isFetching, hasMore: !!found.hasNextPage, more: () => { if (!found.isFetchingNextPage) void found.fetchNextPage(); }, failed: found.isError ? { retry: () => void found.refetch() } : null };
}

/** Strong's words under the letter, by meaning, or found by number or word; twenty at a time. */
function useStrongs(enabled: boolean, settled: string, letter: string) {
  const idx = useStrongsIndex(enabled);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [settled, letter]);
  const rows = useMemo(() => enabled ? findStrongs(idx.data ?? [], idx.data ?? [], settled, letter) : [], [enabled, idx.data, settled, letter]);
  const items: Item[] = rows.slice(0, limit).map((r) => ({ id: `strong:${r.n}`, kind: "strong", title: gloss(r), chip: r.n, description: r.lemma, path: `/lexicon/${r.n}` }));
  return { items, loading: enabled && idx.isPending && !idx.isError, hasMore: rows.length > limit, more: () => setLimit((l) => l + PAGE), failed: enabled && idx.isError ? { retry: () => void idx.refetch() } : null };
}

/** The topics (Bible Strong's Nave) under the letter, or those whose name holds what is typed. */
function useTopics(enabled: boolean, settled: string, letter: string) {
  const all = useQuery({ queryKey: ["topics"], queryFn: data.topics, enabled });
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [settled, letter]);
  const rows = useMemo(() => (all.data ?? []).filter((t) => (t.notes || t.cases) && !t.slug.startsWith("verdict-"))
    .filter((t) => settled ? t.label.toLowerCase().includes(settled.toLowerCase()) : firstLetter(t.label) === letter), [all.data, settled, letter]);
  const items: Item[] = rows.slice(0, limit).map((t) => ({ id: `nave:${t.slug}`, kind: "nave", title: t.label, subtitle: "Nave", path: `/topics/${t.slug}` }));
  return { items, loading: enabled && all.isPending, hasMore: rows.length > limit, more: () => setLimit((l) => l + PAGE), failed: all.isError ? { retry: () => void all.refetch() } : null };
}

/** The dictionary's words under the letter, or found by the server, a page at a time. */
function useDictionary(enabled: boolean, settled: string, letter: string) {
  const pages = useInfiniteQuery({
    queryKey: ["dict", settled, settled ? "" : letter], enabled, initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await fetch(`/api/dictionary?q=${encodeURIComponent(settled)}&letter=${settled ? "" : letter.toUpperCase()}&page=${pageParam}`);
      if (!r.ok) throw new Error("The dictionary did not load.");
      return r.json() as Promise<{ page: number; pages: number; rows: { slug: string; term: string }[] }>;
    },
    getNextPageParam: (last) => last.page < last.pages ? last.page + 1 : undefined,
  });
  const items: Item[] = (pages.data?.pages.flatMap((p) => p.rows) ?? []).map((r, i) => ({ id: `dictionary:${r.slug}:${i}`, kind: "dictionary", title: r.term, subtitle: "Dictionary", path: `/dictionary/${r.slug}` }));
  return { items, loading: enabled && pages.isFetching, hasMore: !!pages.hasNextPage, more: () => { if (!pages.isFetchingNextPage) void pages.fetchNextPage(); }, failed: pages.isError ? { retry: () => void pages.refetch() } : null };
}

/** The reader's studies, last changed first, or those matching what is typed. */
function useStudies(enabled: boolean, text: string) {
  const [studies, setStudies] = useState<Study[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const load = () => void listStudies().then(setStudies).finally(() => setLoaded(true));
    load();
    return subscribeStudies(load);
  }, [enabled]);
  const items: Item[] = studies.map((s) => ({ id: `study:${s.id}`, kind: "studies", title: s.title || "Untitled study", subtitle: "Study",
    description: s.blocks.map((b) => ("text" in b ? b.text : "reference" in b ? b.reference : "")).filter(Boolean).join(" ") || undefined, path: `/studies/${s.id}` }));
  return { items: text ? searchWithMatches(items, text) : items, loading: !loaded };
}

/** The reader's verse notes, newest first, or those matching what is typed; each opens at its verse. */
function useNotes(enabled: boolean, text: string) {
  const all = useAllNotes(enabled);
  const items: Item[] = all.rows.map((n) => ({ id: `note:${n.slug}/${n.chapter}/${n.key}`, kind: "notes", title: n.note.title || "Untitled note", subtitle: "Note",
    description: n.note.description || undefined, path: `/read/${n.slug}/${n.chapter}?v=${n.key.split("/")[0]}` }));
  return { items: text ? searchWithMatches(items, text) : items, loading: !all.loaded };
}

/** catalogSearch's searchTimeline: each period matching what is typed, then (once something is typed) its events. */
function timelineItems(text: string): Item[] {
  const events = flatten(TIMELINE.sections);
  return TIMELINE.sections.flatMap((section, index) => [
    ...(matches(text, section.title, section.sectionTitle) ? [{ id: `period:${section.id}`, kind: "timeline" as const, title: section.title, subtitle: "Period", path: `/timeline/${index}` }] : []),
    ...(text.trim() ? events.filter((e) => e.sectionIndex === index && hasDetails(e) && matches(text, e.title))
      .map((e) => ({ id: `event:${section.id}:${e.slug}`, kind: "timeline" as const, title: e.title, subtitle: `Event · ${section.title}`, path: `/timeline/event/${e.slug}` })) : []),
  ]);
}

/** SearchSectionBlock: the title faint with its count, five rows, then See more for ten more. */
function SectionBlock({ section, visible, showMore, onMore, onPick }: { section: Section; visible: number; showMore: boolean; onMore: () => void; onPick: (path: string) => void }) {
  const rows = section.items.slice(0, visible);
  return (
    <div className="spick__section">
      <div className="spick__head"><span>{section.title}</span><Chip bold>{section.items.length}</Chip></div>
      {rows.map((item) => <ResultRow key={item.id} item={item} onPress={() => onPick(item.path)} />)}
      {showMore && (section.items.length > visible || section.hasMore) ? <button type="button" className="spick__more" onClick={onMore}><span>See more</span></button> : null}
    </div>
  );
}

function Chip({ bold, children }: { bold?: boolean; children: ReactNode }) {
  return <span className="spick__chip" data-bold={bold ? "" : undefined}>{children}</span>;
}

/** SearchEntityResultRow: the kind's colour on the left edge, the title in bold, its chip, the description under it, and the arrow. */
function ResultRow({ item, onPress }: { item: Item; onPress: () => void }) {
  return (
    <div className="spick__row" style={{ ["--edge" as string]: EDGE[item.kind] } as CSSProperties}>
      <button type="button" className="spick__main" onClick={onPress}>
        <span className="spick__title"><b>{item.title}</b>{item.chip ? <Chip>{item.chip}</Chip> : null}</span>
        {item.description ? <span className="spick__desc" style={{ WebkitLineClamp: item.lines ?? 1 }}>{item.description}</span> : item.subtitle ? <span className="spick__desc">{item.subtitle}</span> : null}
      </button>
      <button type="button" className="spick__arrow" aria-label={item.title} onClick={onPress}><Feather name="arrow-right" size={20} /></button>
    </div>
  );
}

/** Empty: Bible Strong's faint illustration with the kind's icon tilted on it, and the message. */
export function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="spick__empty">
      <div className="spick__art" aria-hidden="true">
        <img src={assetUrl("bs/empty-state-illustration.png")} alt="" />
        <span style={{ ["--icon" as string]: `url("${assetUrl(`bs/empty-state-icons/${icon}.svg`)}")` }} />
      </div>
      <p>{message}</p>
    </div>
  );
}

/** PassageBrowser: the books, then a book's chapters on 48 px tiles; a chapter opens whole. */
function PassageBrowser({ onPick }: { onPick: (path: string) => void }) {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [book, setBook] = useState<Book | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const go = (b: Book | null) => {
    (document.activeElement as HTMLElement | null)?.blur();
    setBook(b);
    top.current?.closest(".spick__list")?.scrollTo({ top: 0 });
  };
  if (!book) return (
    <div ref={top}>
      {(books.data ?? []).map((b) => (
        <button key={b.slug} type="button" className="spick__book" onClick={() => go(b)}><span>{b.book}</span><Feather name="chevron-right" size={18} /></button>
      ))}
    </div>
  );
  return (
    <div ref={top}>
      <button type="button" className="spick__back" aria-label="Books" onClick={() => go(null)}><Feather name="arrow-left" size={20} /><b>{book.book}</b></button>
      <div className="spick__grid">
        {book.chapterIds.map((c) => <button key={c} type="button" aria-label={`${book.book}, Chapter ${c}`} onClick={() => onPick(`/read/${book.slug}/${c}`)}>{c}</button>)}
      </div>
    </div>
  );
}
