import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from "react";

import type { Book } from "@/api/data";
import { expand, type Progress } from "@/lib/marks";
import { haptic } from "@/tg/sdk";
import { FiltersButton } from "@/ui/panel";
import { Feather } from "../icons";
import { HeaderPicker } from "./HeaderPicker";

/**
 * Bible Strong's BookSelectorSheet on the iPhone: in the list, a book opens its chapters under it
 * (one at a time, 60 px tiles, the chevron turning); in the grid, a book opens its chapter grid.
 * Order, verses and display sit behind its FiltersHeader button and persist on the device.
 */
type Sort = "classical" | "alphabetical"; type Layout = "list" | "grid"; type Verses = "without-verses" | "with-verses";
const pref = <T extends string>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
/**
 * A tile with React Native Web's TouchableBox onLongPress (500 ms): the press that fires it does not
 * also click. Its timer lives in a ref, so a render during the press cannot orphan it, and it is
 * cleared when the tile goes.
 */
function PressTile({ onLong, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { onLong?: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), fired = useRef(false), long = useRef(onLong);
  long.current = onLong;
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  const press = onLong ? {
    onPointerDown: () => { fired.current = false; clear(); timer.current = setTimeout(() => { timer.current = null; fired.current = true; haptic("select"); long.current?.(); }, 500); },
    onPointerUp: clear, onPointerLeave: clear, onPointerCancel: clear,
    onClickCapture: (e: MouseEvent<HTMLButtonElement>) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } },
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault(),
  } : {};
  return <button type="button" {...props} {...press}>{children}</button>;
}

export function BookSelectorSheet({ open, onClose, books, current, onSelect, onLongSelect, loadVerseCount, progress = {} }: { progress?: Progress; open: boolean; onClose: () => void; books: Book[]; current: { slug: string; chapter: number }; onSelect: (slug: string, chapter: number, verse?: number) => void; onLongSelect?: (slug: string, chapter: number, verse: number) => void; loadVerseCount: (slug: string, chapter: number) => Promise<number> }) {
  const [sort, setSort] = useState<Sort>(() => pref("bookSelectorSort", "classical"));
  const [layout, setLayout] = useState<Layout>(() => pref("bookSelectorSelectionMode", "list"));
  const [verses, setVerses] = useState<Verses>(() => pref("bookSelectorVerses", "without-verses"));
  const [expanded, setExpanded] = useState<string | null>(null);
  // A closed book keeps its chapters for the 300 ms its row folds over them, as BookItem does.
  const [closing, setClosing] = useState<string | null>(null);
  const toggle = (slug: string) => {
    haptic("select");
    if (expanded) { const was = expanded; setClosing(was); setTimeout(() => setClosing((c) => (c === was ? null : c)), 300); }
    setExpanded(expanded === slug ? null : slug);
  };
  const [query, setQuery] = useState("");
  const [gridBook, setGridBook] = useState<Book | null>(null);
  const [verseSheet, setVerseSheet] = useState<{ book: Book; chapter: number; count: number } | null>(null);
  const data = useMemo(() => (sort === "alphabetical" ? [...books].sort((a, b) => a.book.localeCompare(b.book)) : books).filter((b) => b.book.toLowerCase().includes(query.trim().toLowerCase())), [books, sort, query]);
  useEffect(() => { if (!open) { setQuery(""); setGridBook(null); setVerseSheet(null); setExpanded(null); setClosing(null); } }, [open]);
  // The book being read is in view when the list opens, as Bible Strong's list does.
  // Once per opening, as soon as the book list holds it (the books may still be loading).
  const shown = useRef(false);
  const hasCurrent = data.some((b) => b.slug === current.slug);
  useEffect(() => { if (!open) shown.current = false; }, [open]);
  const listRef = useCallback((list: HTMLDivElement | null) => {
    if (!open || shown.current || gridBook || verseSheet || !hasCurrent) return;
    // Snapshot transitions can defer this mount beyond the parent's effects. Scroll from
    // the committed list ref, including when the books arrive after the picker opens.
    // Only the sheet's body scrolls, so the header stays put (scrollIntoView moved the whole sheet);
    // two rows sit above the book, as BookSelectorList's offset of itemHeight * (index - 2).
    const row = list?.querySelector<HTMLElement>("[data-current]"), body = list?.closest<HTMLElement>(".bs-sheet__body");
    if (row && body) { body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - 2 * row.offsetHeight; shown.current = true; }
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
      <HeaderPicker open={open} onClose={onClose} snapPoints={[1]} reverse centerTitle title={grid ? gridBook!.book : "Books"} subTitle={grid ? "Chapters" : undefined} onBack={grid ? () => setGridBook(null) : undefined}
        right={grid ? null : <FiltersButton onReset={() => { set.sort("classical"); set.verses("without-verses"); set.layout("list"); }} filters={[
          { key: "sort", icon: "list", label: "Order", value: sort === "classical" ? "Classical order" : "Alphabetical order", active: sort !== "classical", options: ([["classical", "Classical order"], ["alphabetical", "Alphabetical order"]] as const).map(([k, l]) => ({ key: k, label: l, selected: sort === k, onSelect: () => set.sort(k) })) },
          { key: "verses", icon: "hash", label: "Verse", value: verses === "with-verses" ? "With verses" : "Without verses", active: verses === "with-verses", options: ([["without-verses", "Without verses"], ["with-verses", "With verses"]] as const).map(([k, l]) => ({ key: k, label: l, selected: verses === k, onSelect: () => set.verses(k) })) },
          { key: "layout", icon: "grid", label: "Display", value: layout === "list" ? "List" : "Grid", active: layout !== "list", options: ([["list", "List"], ["grid", "Grid"]] as const).map(([k, l]) => ({ key: k, label: l, selected: layout === k, onSelect: () => set.layout(k) })) },
        ]} />}>
        {!grid ? <label className="bs-search"><Feather name="search" size={18} /><input aria-label="Search books" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /></label> : null}
        {grid ? <ChapterGrid book={gridBook!} read={readOf(gridBook!)} selectedChapter={gridBook!.slug === current.slug ? current.chapter : undefined} onPick={(c) => void pick(gridBook!, c)} onLongPick={onLongSelect ? (c) => { onLongSelect(gridBook!.slug, c, 1); onClose(); } : undefined} /> : layout === "grid" ? (
          <div ref={listRef} className="bs-bookgrid">
            {data.map((b) => <button key={b.slug} type="button" className="bs-bookshort" data-current={b.slug === current.slug ? "" : undefined} aria-label={b.book} title={b.book} aria-pressed={b.slug === current.slug} style={{ color: b.slug === current.slug ? "var(--bs-primary)" : b.testament === "New Testament" ? "var(--bs-quart)" : b.testament === "Apocrypha" ? "var(--bs-tertiary)" : "var(--bs-default)", fontWeight: b.slug === current.slug ? "bold" : "normal" }} onClick={() => setGridBook(b)}>{b.book.replace(/^(Rest|Wisdom|Epistle|Song|History|Prayer) of (the )?/, "").replace(/\s/g, "").slice(0, 3)}<BookBar read={readOf(b).size} total={b.chapterIds.length} /></button>)}
          </div>
        ) : (
          <div ref={listRef} className="bs-booklist">
            {data.map((b) => {
              const isCurrent = b.slug === current.slug, isOpen = expanded === b.slug;
              return <div key={b.slug} className="bs-bookitem">
                <button type="button" className="bs-bookrow" aria-expanded={isOpen} data-current={isCurrent ? "" : undefined} style={{ background: isCurrent ? "var(--bs-light-grey)" : "transparent" }} onClick={() => toggle(b.slug)}>
                  <span style={{ color: isCurrent ? "var(--bs-primary)" : "var(--bs-default)", fontWeight: isCurrent ? "bold" : undefined }}>{b.book}</span>
                  {readOf(b).size ? <BookRing read={readOf(b).size} total={b.chapterIds.length} /> : null}
                  <span className="bs-bookrow__chevron"><Feather name="chevron-down" size={24} color="var(--bs-grey)" /></span>
                </button>
                <div className="bs-accordion" data-open={isOpen ? "" : undefined} inert={!isOpen || undefined}>
                  <div className="bs-accordion__body">{isOpen || closing === b.slug ? <ChapterTiles book={b} read={readOf(b)} selectedChapter={isCurrent ? current.chapter : undefined} onPick={(c) => void pick(b, c)} onLongPick={onLongSelect ? (c) => { onLongSelect(b.slug, c, 1); onClose(); } : undefined} /> : null}</div>
                </div>
              </div>;
            })}
          </div>
        )}
        {!grid && !data.length ? <p className="bs-tip">No books found.</p> : null}
      </HeaderPicker>
      {verseSheet ? (
        <HeaderPicker open={open} onClose={() => setVerseSheet(null)} snapPoints={[0.5]} centerTitle title="Go to verse">
          <div className="bs-versegrid">
            {Array.from({ length: verseSheet.count }, (_, i) => i + 1).map((v) => <PressTile key={v} type="button" aria-label={`Verse ${v}`} title={`Verse ${v}`} className="bs-versetile bs-versetile--48" onClick={() => { haptic("select"); onSelect(verseSheet.book.slug, verseSheet.chapter, v); setVerseSheet(null); onClose(); }} onLong={onLongSelect && (() => { onLongSelect(verseSheet.book.slug, verseSheet.chapter, v); setVerseSheet(null); onClose(); })}>{v}</PressTile>)}
          </div>
        </HeaderPicker>
      ) : null}
    </>
  );
}

function ChapterGrid({ book, read, selectedChapter, onPick, onLongPick }: { book: Book; read: Set<number>; selectedChapter?: number; onPick: (c: number) => void; onLongPick?: (c: number) => void }) {
  return <div className="bs-chaptergrid">{book.chapterIds.map((c) => <PressTile key={c} type="button" aria-label={`Chapter ${c}`} title={`Chapter ${c}`} aria-pressed={c === selectedChapter} data-read={read.has(c) ? "" : undefined} className="bs-chaptertile bs-chaptertile--48" style={{ background: c === selectedChapter ? "var(--bs-light-grey)" : undefined, color: c === selectedChapter ? "var(--bs-primary)" : undefined, fontWeight: c === selectedChapter ? "bold" : undefined }} onClick={() => onPick(c)} onLong={onLongPick && (() => onLongPick(c))}>{c}</PressTile>)}</div>;
}

/** BookItem's chapters under an opened book: 60 px tiles, 10 px apart, centred within 500 px; the chapter being read marked as in ChapterGrid. */
function ChapterTiles({ book, read, selectedChapter, onPick, onLongPick }: { book: Book; read: Set<number>; selectedChapter?: number; onPick: (c: number) => void; onLongPick?: (c: number) => void }) {
  return <div className="bs-chaptertiles">{book.chapterIds.map((c) => <PressTile key={c} type="button" aria-label={`Chapter ${c}`} title={`Chapter ${c}`} aria-pressed={c === selectedChapter} data-read={read.has(c) ? "" : undefined} className="bs-chaptertile" style={{ background: c === selectedChapter ? "var(--bs-light-grey)" : undefined, color: c === selectedChapter ? "var(--bs-primary)" : undefined, fontWeight: c === selectedChapter ? "bold" : undefined }} onClick={() => onPick(c)} onLong={onLongPick ? () => onLongPick(c) : undefined}>{c}</PressTile>)}</div>;
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
    <HeaderPicker open={open} onClose={onClose} centerTitle title="Go to verse">
      <div className="bs-versegrid">
        {count ? Array.from({ length: count }, (_, i) => i + 1).map((v) => <button key={v} type="button" aria-label={`Verse ${v}`} title={`Verse ${v}`} aria-pressed={v === selected} className="bs-versetile" onClick={() => { haptic("select"); onSelect(v); onClose(); }}>{v}</button>) : <p className="bs-loading">Loading...</p>}
      </div>
    </HeaderPicker>
  );
}
