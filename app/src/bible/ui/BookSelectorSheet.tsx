import { useEffect, useMemo, useRef, useState } from "react";

import type { Book } from "@/api/data";
import { haptic } from "@/tg/sdk";
import { Feather } from "../icons";
import { Sheet } from "./Sheet";

/**
 * The book selector (BookSelectorSheet): "Books", a filters button (Order, Verse, Display),
 * the books as 46 px rows that unfold a grid of chapter tiles, or as a 5-column grid of
 * three-letter names that opens a chapter grid; with "With verses" a chapter opens the
 * "Go to verse" sheet. The filters persist on the device.
 */
type Sort = "classical" | "alphabetical"; type Layout = "list" | "grid"; type Verses = "without-verses" | "with-verses";
const pref = <T extends string>(k: string, d: T): T => { try { return (localStorage.getItem(k) as T) || d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function BookSelectorSheet({ open, onClose, books, current, onSelect, loadVerseCount }: { open: boolean; onClose: () => void; books: Book[]; current: { slug: string; chapter: number }; onSelect: (slug: string, chapter: number, verse?: number) => void; loadVerseCount: (slug: string, chapter: number) => Promise<number> }) {
  const [sort, setSort] = useState<Sort>(() => pref("bookSelectorSort", "classical"));
  const [layout, setLayout] = useState<Layout>(() => pref("bookSelectorSelectionMode", "list"));
  const [verses, setVerses] = useState<Verses>(() => pref("bookSelectorVerses", "without-verses"));
  const [filters, setFilters] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [gridBook, setGridBook] = useState<Book | null>(null);
  const [verseSheet, setVerseSheet] = useState<{ book: Book; chapter: number; count: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const data = useMemo(() => (sort === "alphabetical" ? [...books].sort((a, b) => a.book.localeCompare(b.book)) : books), [books, sort]);
  useEffect(() => { if (!open) { setExpanded(null); setGridBook(null); setVerseSheet(null); setFilters(false); return; } const i = data.findIndex((b) => b.slug === current.slug); const t = setTimeout(() => listRef.current?.closest('.bs-sheet__body')?.scrollTo({ top: Math.max(0, 46 * (i - 2)) }), 100); return () => clearTimeout(t); }, [open, data, current.slug]);

  const pick = async (book: Book, chapter: number) => {
    haptic("select");
    if (verses === "with-verses") { const count = await loadVerseCount(book.slug, chapter); setVerseSheet({ book, chapter, count }); return; }
    onSelect(book.slug, chapter, 1); onClose();
  };
  const set = { sort: (v: Sort) => { setSort(v); setPref("bookSelectorSort", v); }, layout: (v: Layout) => { setLayout(v); setPref("bookSelectorSelectionMode", v); }, verses: (v: Verses) => { setVerses(v); setPref("bookSelectorVerses", v); } };
  const grid = layout === "grid" && gridBook !== null;
  return (
    <>
      <Sheet open={open && !verseSheet} onClose={onClose} height="full" title={grid ? gridBook!.book : "Books"} subTitle={grid ? "Chapters" : undefined} hasBack={grid} onBack={() => setGridBook(null)}
        right={grid ? <span style={{ width: 54 }} /> : <button type="button" className="bs-filterbtn" aria-label="Filters" aria-expanded={filters} onClick={() => setFilters(!filters)}><Feather name="sliders" size={18} color="var(--bs-primary)" /></button>}>
        {!grid && filters ? (
          <div className="bs-filters">
            <Filter icon="list" label="Order" value={sort === "classical" ? "Classical order" : "Alphabetical order"} options={[["classical", "Classical order"], ["alphabetical", "Alphabetical order"]]} current={sort} onSelect={set.sort} />
            <Filter icon="hash" label="Verse" value={verses === "with-verses" ? "With verses" : "Without verses"} options={[["without-verses", "Without verses"], ["with-verses", "With verses"]]} current={verses} onSelect={set.verses} />
            <Filter icon="grid" label="Display" value={layout === "list" ? "List" : "Grid"} options={[["list", "List"], ["grid", "Grid"]]} current={layout} onSelect={set.layout} />
          </div>
        ) : null}
        {!grid ? <p className="bs-tip">Tap a book, then a chapter.</p> : null}
        {layout === "grid" ? (
          grid ? <ChapterGrid book={gridBook!} selectedChapter={gridBook!.slug === current.slug ? current.chapter : undefined} onPick={(c) => void pick(gridBook!, c)} /> : (
            <div className="bs-bookgrid">
              {data.map((b) => <button key={b.slug} type="button" className="bs-bookshort" aria-label={b.book} aria-pressed={b.slug === current.slug} style={{ color: b.slug === current.slug ? "var(--bs-primary)" : b.testament === "New Testament" ? "var(--bs-quart)" : b.testament === "Apocrypha" ? "var(--bs-tertiary)" : "var(--bs-default)", fontWeight: b.slug === current.slug ? "bold" : "normal" }} onClick={() => setGridBook(b)}>{b.book.replace(/\s/g, "").slice(0, 3)}</button>)}
            </div>
          )
        ) : (
          <div ref={listRef} className="bs-booklist">
            {data.map((b) => {
              const isSel = b.slug === current.slug, isOpen = expanded === b.slug;
              return (
                <div key={b.slug}>
                  <button type="button" className="bs-bookrow" aria-expanded={isOpen} style={{ background: isSel ? "var(--bs-light-grey)" : "transparent" }} onClick={() => { haptic("select"); setExpanded(isOpen ? null : b.slug); }}>
                    <span style={{ color: isSel ? "var(--bs-primary)" : "var(--bs-default)", fontWeight: isSel ? "bold" : undefined }}>{b.book}</span>
                    <Feather name="chevron-down" size={24} color="var(--bs-grey)" style={{ opacity: 0.5, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .3s" }} />
                  </button>
                  <div className="bs-accordion" style={{ maxHeight: isOpen ? 2000 : 0 }}>
                    {isOpen ? <div className="bs-chaptertiles">{b.chapterIds.map((c) => <button key={c} type="button" aria-label={`Chapter ${c}`} className="bs-chaptertile" onClick={() => void pick(b, c)}>{c}</button>)}</div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Sheet>
      {verseSheet ? (
        <Sheet open onClose={() => setVerseSheet(null)} height="half" title="Go to verse">
          <div className="bs-versegrid">
            {Array.from({ length: verseSheet.count }, (_, i) => i + 1).map((v) => <button key={v} type="button" aria-label={`Verse ${v}`} className="bs-versetile bs-versetile--48" onClick={() => { haptic("select"); onSelect(verseSheet.book.slug, verseSheet.chapter, v); setVerseSheet(null); onClose(); }}>{v}</button>)}
          </div>
        </Sheet>
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

function ChapterGrid({ book, selectedChapter, onPick }: { book: Book; selectedChapter?: number; onPick: (c: number) => void }) {
  return <div className="bs-chaptergrid">{book.chapterIds.map((c) => <button key={c} type="button" aria-label={`Chapter ${c}`} aria-pressed={c === selectedChapter} className="bs-chaptertile bs-chaptertile--48" style={{ background: c === selectedChapter ? "var(--bs-light-grey)" : undefined, color: c === selectedChapter ? "var(--bs-primary)" : undefined, fontWeight: c === selectedChapter ? "bold" : undefined }} onClick={() => onPick(c)}>{c}</button>)}</div>;
}

/** VerseSelectorPopup: the chevrons in the header open "Go to verse", a grid of 40 px tiles. */
export function VersePopup({ open, onClose, count, selected, onSelect }: { open: boolean; onClose: () => void; count: number; selected?: number; onSelect: (v: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Go to verse">
      <div className="bs-versegrid">
        {count ? Array.from({ length: count }, (_, i) => i + 1).map((v) => <button key={v} type="button" aria-label={`Verse ${v}`} aria-pressed={v === selected} className="bs-versetile" onClick={() => { haptic("select"); onSelect(v); onClose(); }}>{v}</button>) : <p className="bs-loading">Loading...</p>}
      </div>
    </Sheet>
  );
}
