import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Book } from "@/api/data";
import { expand, type Progress } from "@/lib/marks";
import { haptic } from "@/tg/sdk";
import { Feather } from "../icons";
import { HeaderPicker } from "./HeaderPicker";

/** Books, chapters and optional verses stay in one header card. Filters persist on the device. */
type Sort = "classical" | "alphabetical"; type Layout = "list" | "grid"; type Verses = "without-verses" | "with-verses";
const pref = <T extends string>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
/** React Native Web's TouchableBox onLongPress (500 ms): the press that fires it does not also click. */
function longPress(onLong?: () => void) {
  if (!onLong) return {};
  let timer: ReturnType<typeof setTimeout> | null = null, fired = false;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  return {
    onPointerDown: () => { fired = false; clear(); timer = setTimeout(() => { fired = true; haptic("select"); onLong(); }, 500); },
    onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

export function BookSelectorSheet({ open, onClose, books, current, onSelect, onLongSelect, loadVerseCount, progress = {} }: { progress?: Progress; open: boolean; onClose: () => void; books: Book[]; current: { slug: string; chapter: number }; onSelect: (slug: string, chapter: number, verse?: number) => void; onLongSelect?: (slug: string, chapter: number, verse: number) => void; loadVerseCount: (slug: string, chapter: number) => Promise<number> }) {
  const [sort, setSort] = useState<Sort>(() => pref("bookSelectorSort", "classical"));
  const [layout, setLayout] = useState<Layout>(() => pref("bookSelectorSelectionMode", "list"));
  const [verses, setVerses] = useState<Verses>(() => pref("bookSelectorVerses", "without-verses"));
  const [filters, setFilters] = useState(false);
  const [query, setQuery] = useState("");
  const [gridBook, setGridBook] = useState<Book | null>(null);
  const [verseSheet, setVerseSheet] = useState<{ book: Book; chapter: number; count: number } | null>(null);
  const data = useMemo(() => (sort === "alphabetical" ? [...books].sort((a, b) => a.book.localeCompare(b.book)) : books).filter((b) => b.book.toLowerCase().includes(query.trim().toLowerCase())), [books, sort, query]);
  useEffect(() => { if (!open) { setQuery(""); setGridBook(null); setVerseSheet(null); setFilters(false); } }, [open]);
  // The book being read is in view when the list opens, as Bible Strong's list does.
  // Once per opening, as soon as the book list holds it (the books may still be loading).
  const shown = useRef(false);
  const hasCurrent = data.some((b) => b.slug === current.slug);
  useEffect(() => { if (!open) shown.current = false; }, [open]);
  const listRef = useCallback((list: HTMLDivElement | null) => {
    if (!open || shown.current || gridBook || verseSheet || !hasCurrent) return;
    // Snapshot transitions can defer this mount beyond the parent's effects. Scroll from
    // the committed list ref, including when the books arrive after the picker opens.
    const row = list?.querySelector<HTMLElement>("[data-current]");
    if (row) { row.scrollIntoView({ block: "center", behavior: "instant" }); shown.current = true; }
  }, [open, gridBook, verseSheet, layout, hasCurrent]);

  const pick = async (book: Book, chapter: number) => {
    haptic("select");
    if (verses === "with-verses") { const count = await loadVerseCount(book.slug, chapter); setVerseSheet({ book, chapter, count }); return; }
    onSelect(book.slug, chapter, 1); onClose();
  };
  const set = { sort: (v: Sort) => { setSort(v); setPref("bookSelectorSort", v); }, layout: (v: Layout) => { setLayout(v); setPref("bookSelectorSelectionMode", v); }, verses: (v: Verses) => { setVerses(v); setPref("bookSelectorVerses", v); } };
  const grid = gridBook !== null;
  const readOf = (b: Book) => expand(progress[b.slug]);
  return (
    <>
      <HeaderPicker open={open && !verseSheet} onClose={onClose} title={grid ? gridBook!.book : "Books"} onBack={grid ? () => setGridBook(null) : undefined}
        right={grid ? null : <button type="button" className="bs-filterbtn" aria-label="Filters" title="Filters" aria-expanded={filters} onClick={() => setFilters(!filters)}><Feather name="sliders" size={18} color="var(--bs-primary)" /></button>}>
        {!grid ? <label className="bs-search"><Feather name="search" size={18} /><input aria-label="Search books" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /></label> : null}
        {!grid && filters ? (
          <div className="bs-filters">
            <Filter icon="list" label="Order" value={sort === "classical" ? "Classical order" : "Alphabetical order"} options={[["classical", "Classical order"], ["alphabetical", "Alphabetical order"]]} current={sort} onSelect={set.sort} />
            <Filter icon="hash" label="Verse" value={verses === "with-verses" ? "With verses" : "Without verses"} options={[["without-verses", "Without verses"], ["with-verses", "With verses"]]} current={verses} onSelect={set.verses} />
            <Filter icon="grid" label="Display" value={layout === "list" ? "List" : "Grid"} options={[["list", "List"], ["grid", "Grid"]]} current={layout} onSelect={set.layout} />
          </div>
        ) : null}
        {grid ? <ChapterGrid book={gridBook!} read={readOf(gridBook!)} selectedChapter={gridBook!.slug === current.slug ? current.chapter : undefined} onPick={(c) => void pick(gridBook!, c)} onLongPick={onLongSelect ? (c) => { onLongSelect(gridBook!.slug, c, 1); onClose(); } : undefined} /> : layout === "grid" ? (
          <div ref={listRef} className="bs-bookgrid">
            {data.map((b) => <button key={b.slug} type="button" className="bs-bookshort" data-current={b.slug === current.slug ? "" : undefined} aria-label={b.book} title={b.book} aria-pressed={b.slug === current.slug} style={{ color: b.slug === current.slug ? "var(--bs-primary)" : b.testament === "New Testament" ? "var(--bs-quart)" : b.testament === "Apocrypha" ? "var(--bs-tertiary)" : "var(--bs-default)", fontWeight: b.slug === current.slug ? "bold" : "normal" }} onClick={() => setGridBook(b)}>{b.book.replace(/^(Rest|Wisdom|Epistle|Song|History|Prayer) of (the )?/, "").replace(/\s/g, "").slice(0, 3)}<BookBar read={readOf(b).size} total={b.chapterIds.length} /></button>)}
          </div>
        ) : (
          <div ref={listRef} className="bs-booklist">
            {data.map((b) => <button key={b.slug} type="button" className="bs-bookrow" data-current={b.slug === current.slug ? "" : undefined} style={{ background: b.slug === current.slug ? "var(--bs-light-grey)" : "transparent" }} onClick={() => { haptic("select"); setGridBook(b); }}>
              <span style={{ color: b.slug === current.slug ? "var(--bs-primary)" : "var(--bs-default)", fontWeight: b.slug === current.slug ? "bold" : undefined }}>{b.book}</span>
              {readOf(b).size ? <BookRing read={readOf(b).size} total={b.chapterIds.length} /> : null}
              <Feather name="chevron-right" size={20} color="var(--bs-grey)" />
            </button>)}
          </div>
        )}
        {!grid && !data.length ? <p className="bs-tip">No books found.</p> : null}
      </HeaderPicker>
      {verseSheet ? (
        <HeaderPicker open={open} onClose={onClose} onBack={() => setVerseSheet(null)} title="Go to verse">
          <div className="bs-versegrid">
            {Array.from({ length: verseSheet.count }, (_, i) => i + 1).map((v) => <button key={v} type="button" aria-label={`Verse ${v}`} title={`Verse ${v}`} className="bs-versetile bs-versetile--48" onClick={() => { haptic("select"); onSelect(verseSheet.book.slug, verseSheet.chapter, v); setVerseSheet(null); onClose(); }} {...longPress(onLongSelect && (() => { onLongSelect(verseSheet.book.slug, verseSheet.chapter, v); setVerseSheet(null); onClose(); }))}>{v}</button>)}
          </div>
        </HeaderPicker>
      ) : null}
    </>
  );
}

function Filter<T extends string>({ icon, label, value, options, current, onSelect }: { icon: "list" | "hash" | "grid"; label: string; value: string; options: [T, string][]; current: T; onSelect: (v: T) => void }) {
  return (
    <div className="bs-filter">
      <span className="bs-filter__label"><Feather name={icon} size={14} color="var(--bs-tertiary)" />{label}</span>
      <div className="bs-filter__opts" role="radiogroup" aria-label={label}>{options.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={current === k} onClick={() => onSelect(k)}>{l}</button>)}</div>
      <span className="visually-hidden">{value}</span>
    </div>
  );
}

function ChapterGrid({ book, read, selectedChapter, onPick, onLongPick }: { book: Book; read: Set<number>; selectedChapter?: number; onPick: (c: number) => void; onLongPick?: (c: number) => void }) {
  return <div className="bs-chaptergrid">{book.chapterIds.map((c) => <button key={c} type="button" aria-label={`Chapter ${c}`} title={`Chapter ${c}`} aria-pressed={c === selectedChapter} data-read={read.has(c) ? "" : undefined} className="bs-chaptertile bs-chaptertile--48" style={{ background: c === selectedChapter ? "var(--bs-light-grey)" : undefined, color: c === selectedChapter ? "var(--bs-primary)" : undefined, fontWeight: c === selectedChapter ? "bold" : undefined }} onClick={() => onPick(c)} {...longPress(onLongPick && (() => onLongPick(c)))}>{c}</button>)}</div>;
}

/** How far through a book: "18/50" beside a small ring, a check when it is all read. */
function BookRing({ read, total }: { read: number; total: number }) {
  const done = read >= total, r = 7, len = 2 * Math.PI * r;
  return (
    <span className="bs-bookprog" data-done={done ? "" : undefined} aria-label={`${read} of ${total} chapters read`}>
      <small>{done ? "Read" : `${read}/${total}`}</small>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r={r} className="bs-bookprog__track" /><circle cx="9" cy="9" r={r} className="bs-bookprog__fill" strokeDasharray={len} strokeDashoffset={len * (1 - Math.min(1, read / total))} transform="rotate(-90 9 9)" /></svg>
    </span>
  );
}
function BookBar({ read, total }: { read: number; total: number }) {
  return read ? <i className="bs-bookbar" aria-hidden="true"><i style={{ width: `${Math.min(100, (read / total) * 100)}%` }} /></i> : null;
}

/** The chevrons in the header open the six-column verse grid. */
export function VersePopup({ open, onClose, count, selected, onSelect }: { open: boolean; onClose: () => void; count: number; selected?: number; onSelect: (v: number) => void }) {
  return (
    <HeaderPicker open={open} onClose={onClose} title="Go to verse">
      <div className="bs-versegrid">
        {count ? Array.from({ length: count }, (_, i) => i + 1).map((v) => <button key={v} type="button" aria-label={`Verse ${v}`} title={`Verse ${v}`} aria-pressed={v === selected} className="bs-versetile" onClick={() => { haptic("select"); onSelect(v); onClose(); }}>{v}</button>) : <p className="bs-loading">Loading...</p>}
      </div>
    </HeaderPicker>
  );
}
