import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ClassMoment } from "@/api/data";
import type { VerseRelationItem } from "@/lib/relations";
import { verseKey as makeKey } from "@/lib/relations";
import { Feather } from "../icons";
import type { BibleSettings } from "../settings";
import type { Bookmark, Highlight, Tag } from "../store";
import { isDarkTheme, type Palette, type ThemeName } from "../theme";
import { findVerseContainer, getCaretInfoFromPoint } from "../annotation/domUtils";
import { annotationAt, HighlightLayer, insideSelection, useAnnotationHighlights } from "../annotation/highlights";
import { MarkInlineItems } from "../annotation/InlineItems";
import type { Mark } from "../annotation/marks";
import type { SelectionRange, WordPosition } from "../annotation/selectionUtils";
import { getWordIndexFromCharOffset, tokenizeVerseText } from "../annotation/wordTokenizer";
import { useVerseGestures } from "./gestures";
import { Verse, type VerseTagGroup } from "./Verse";

/**
 * The verse area (BibleDOM/BibleDOMComponent.tsx): its own scroll view under the header, the
 * verses in a 610 px column, the gestures (tap, long press, swipe, scroll velocity that hides
 * the header), scroll-to-verse on open, the "return to selected verse" button.
 */
export const HEADER_HEIGHT = 54, HEADER_HEIGHT_MIN = 20, PASSAGE_CONTEXT_HEADER_HEIGHT = 44;
const READING_TEXT_MAX_WIDTH = 580, HORIZONTAL_PADDING = 15, RETURN_BOTTOM_OFFSET = 250;

export type ChapterProps = {
  readingVerse?: number | null; onSeekVerse?: (verse: number) => void;
  slug: string; chapter: number; verses: { verse: number; text: string }[];
  settings: BibleSettings; palette: Palette; theme: ThemeName;
  selected: number[]; focusVerses: number[] | null; contextDisplayMode: "focused" | "fullChapter";
  verseToScroll: number | undefined; navigationRequest: number;
  highlights: Record<string, Highlight>; tags: Record<string, Tag>; bookmarks: Bookmark[];
  relationItems: Record<number, VerseRelationItem[]>;
  /** The classes that taught each verse, by the last verse they taught. */
  moments?: Record<number, ClassMoment[]>; deck?: { reference: string; from: string };
  headerHeight: number; fullscreen: boolean; canSwipe: boolean;
  onToggleVerse: (v: number) => void; onVerseDetail: (v: number) => void; onDoubleTap?: (v: number) => void;
  /** Bible Strong's word annotation: a double tap selects a word, the handles extend it. */
  annotationMode?: boolean; marks?: Mark[]; selectedMark?: string | null; colorOf?: (key: string) => string | null;
  wordSelection?: SelectionRange | null; setWordSelection?: (fn: (prev: SelectionRange | null) => SelectionRange | null) => void;
  onEnterAnnotation?: () => void; onSelectMark?: (id: string | null) => void;
  markItems?: Record<string, VerseRelationItem[]>; onOpenMarkTags?: (markId: string) => void;
  onSwipe: (dir: "left" | "right") => void; onFullscreen: (on: boolean) => void;
  onOpenBookmark: (b: Bookmark) => void; onOpenRelations: (v: number) => void; onOpenRelationItem: (it: VerseRelationItem) => void; onOpenTags: (v: number) => void; onOpenTag: (id: string) => void;
  /** Before verse 1 (a book's prologue); hidden while a passage is focused. */
  header?: ReactNode;
  footer?: ReactNode;
};

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Chapter(p: ChapterProps) {
  const { settings: s, palette: c, theme, slug, chapter } = p;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [touched, setTouched] = useState<string | null>(null);
  const [returnPos, setReturnPos] = useState<"top" | "bottom" | null>(null);
  const suppressRef = useRef(false);
  const selectedMode = p.selected.length > 0;
  const hasVerses = p.verses.length > 0;
  const isContextFocused = p.contextDisplayMode === "focused";
  const focus = p.focusVerses;

  // The verse being read: marked, and kept in view a third of the way down while the reading follows
  // it. A scroll by the reader frees the page; "Back to verse N" (or the reading reaching a verse
  // they are looking at, once they have stopped scrolling) brings the following back.
  const reading = p.readingVerse ?? null;
  const followRef = useRef(true), inputAtRef = useRef(0);
  const [readingAway, setReadingAway] = useState<"top" | "bottom" | null>(null);
  const verseEl = (v: number | null) => (v == null ? null : scrollRef.current?.querySelector<HTMLElement>(`#verset-${v}`) ?? null);
  const awayOf = (v: number | null): "top" | "bottom" | null => {
    const sc = scrollRef.current, el = verseEl(v); if (!sc || !el) return null;
    const r = el.getBoundingClientRect(), s0 = sc.getBoundingClientRect();
    if (r.bottom < s0.top + p.headerHeight + 8) return "top";
    if (r.top > s0.bottom - RETURN_BOTTOM_OFFSET) return "bottom";
    return null;
  };
  const placeReading = (behavior: ScrollBehavior) => {
    const sc = scrollRef.current, el = verseEl(reading); if (!sc || !el) return;
    const r = el.getBoundingClientRect(), s0 = sc.getBoundingClientRect();
    const target = p.headerHeight + Math.max(24, (sc.clientHeight - p.headerHeight - RETURN_BOTTOM_OFFSET) * 0.3);
    suppressRef.current = true;
    sc.scrollTo({ top: sc.scrollTop + (r.top - s0.top) - target, behavior: reducedMotion() ? "auto" : behavior });
    setTimeout(() => { suppressRef.current = false; }, 500);
  };
  const followReading = () => { followRef.current = true; setReadingAway(null); placeReading("smooth"); };
  useEffect(() => {
    const root = scrollRef.current; if (!root) return;
    root.querySelectorAll("[data-reading]").forEach((el) => { el.removeAttribute("data-reading"); el.removeAttribute("aria-current"); });
    const el = verseEl(reading);
    if (reading == null || !el) { if (reading == null) { followRef.current = true; setReadingAway(null); } return; }
    el.setAttribute("data-reading", ""); el.setAttribute("aria-current", "true");
    if (!followRef.current && Date.now() - inputAtRef.current > 3000 && awayOf(reading) === null) followRef.current = true;
    if (followRef.current) { setReadingAway(null); requestAnimationFrame(() => placeReading("smooth")); }
    else setReadingAway(awayOf(reading));
  }, [reading, hasVerses]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sc = scrollRef.current; if (!sc || reading == null) return;
    const free = () => { inputAtRef.current = Date.now(); if (followRef.current) { followRef.current = false; setReadingAway(awayOf(reading)); } };
    const keys = (e: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key) && !(e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) free(); };
    let raf: number | null = null;
    const onScroll = () => { if (followRef.current) return; if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setReadingAway(awayOf(reading))); };
    sc.addEventListener("touchmove", free, { passive: true }); sc.addEventListener("wheel", free, { passive: true }); window.addEventListener("keydown", keys);
    sc.addEventListener("scroll", onScroll, { passive: true });
    // A header change can cancel the previous effect’s queued position check.
    // Sample again so an off-screen reading keeps its return control.
    onScroll();
    return () => { sc.removeEventListener("touchmove", free); sc.removeEventListener("wheel", free); window.removeEventListener("keydown", keys); sc.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [reading, p.headerHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tags on highlights: verses highlighted together share a date; the chip goes under the last of them.
  const tagGroups = useMemo(() => {
    const byDate = new Map<number, { last: number; tagIds: Set<string> }>();
    for (const [v, h] of Object.entries(p.highlights)) {
      const g = byDate.get(h.date) ?? { last: 0, tagIds: new Set() };
      g.last = Math.max(g.last, +v); for (const id of Object.keys(h.tags ?? {})) g.tagIds.add(id); byDate.set(h.date, g);
    }
    const out = new Map<number, VerseTagGroup>();
    for (const g of byDate.values()) if (g.tagIds.size) out.set(g.last, { tags: [...g.tagIds].map((id) => p.tags[id]).filter(Boolean) });
    return out;
  }, [p.highlights, p.tags]);
  const bookmarkOf = useMemo(() => { const m = new Map<number, Bookmark>(); for (const b of p.bookmarks) if (b.book === slug && b.chapter === chapter && b.verse) m.set(b.verse, b); return m; }, [p.bookmarks, slug, chapter]);

  const verseOf = (vk: string) => Number(vk.split("-").pop());
  // Word selection (BibleDOM/AnnotationMode): the words under a point, and the selection's pieces in each verse.
  const wordRows = useMemo(() => p.verses.map((r) => ({ verseKey: makeKey(slug, chapter, r.verse), text: r.text })), [p.verses, slug, chapter]);
  const tokensOf = useMemo(() => { const cache = new Map<string, ReturnType<typeof tokenizeVerseText>>(); return (vk: string, text: string) => { let t = cache.get(vk); if (!t) { t = tokenizeVerseText(text); cache.set(vk, t); } return t; }; }, [wordRows]); // eslint-disable-line react-hooks/exhaustive-deps
  const wordAt = (x: number, y: number): WordPosition | null => {
    const caret = getCaretInfoFromPoint(x, y); const vk = caret && (findVerseContainer(caret.targetElement) as HTMLElement | null)?.dataset.verseKey;
    const row = vk ? wordRows.find((r) => r.verseKey === vk) : undefined; if (!caret || !row) return null;
    const wordIndex = getWordIndexFromCharOffset(tokensOf(row.verseKey, row.text), caret.charOffset);
    return wordIndex == null ? null : { verseKey: row.verseKey, wordIndex };
  };
  const wordSel = p.wordSelection ?? null, mode = !!p.annotationMode, selectedMark = p.selectedMark ?? null;
  const setSel = (next: SelectionRange | null) => p.setWordSelection?.(() => next);
  const layerRef = useRef<HTMLDivElement>(null);
  const { highlightRects, handles } = useAnnotationHighlights({
    containerRef: layerRef, marks: p.marks ?? [], verses: wordRows, selection: mode ? wordSel : null, colorOf: p.colorOf ?? (() => null),
    chapterKey: `${slug}-${chapter}`, layoutKey: [s.fontSizeScale, s.lineHeight, s.fontFamily, s.textDisplay, s.showVerseNumbers, p.contextDisplayMode, focus?.join(","), p.headerHeight, p.verses.length].join("|"),
  });
  const wordOfTap = (vk: string, pos: { x: number; y: number }): SelectionRange | null => { const w = wordAt(pos.x, pos.y); return w && w.verseKey === vk ? { start: w, end: w } : null; };
  // handleTapVerseAnnotationMode: a mark selects (or deselects) it; inside the selection nothing;
  // otherwise the mark is let go, and an existing selection ends or the tapped word is selected.
  const tapInMode = (vk: string, pos: { x: number; y: number }) => {
    const hit = annotationAt(highlightRects, layerRef.current, pos);
    if (hit) { setSel(null); p.onSelectMark?.(hit === selectedMark ? null : hit); return; }
    if (insideSelection(highlightRects, layerRef.current, pos)) return;
    if (selectedMark) p.onSelectMark?.(null);
    if (wordSel) { setSel(null); return; }
    const w = wordOfTap(vk, pos); if (w) setSel(w);
  };
  useVerseGestures(scrollRef, {
    onTouchedVerseChange: setTouched,
    onTapVerse: (vk, pos) => {
      if (mode) { tapInMode(vk, pos); return; }
      const v = verseOf(vk); if (p.onSeekVerse) { followRef.current = true; setReadingAway(null); p.onSeekVerse(v); return; } if (selectedMode || s.press === "longPress") p.onToggleVerse(v); else p.onVerseDetail(v);
    },
    onDoubleTapVerse: (vk, pos) => {
      const w = wordOfTap(vk, pos), hit = annotationAt(highlightRects, layerRef.current, pos);
      if (mode) {
        if (hit) { setSel(null); p.onSelectMark?.(hit === selectedMark ? null : hit); }
        else if (w) { if (selectedMark) p.onSelectMark?.(null); setSel(w); }
        return;
      }
      if (!p.onEnterAnnotation) { p.onDoubleTap?.(verseOf(vk)); return; }
      // Reading mode: no annotation mode while verses are selected.
      if (selectedMode) return;
      p.onEnterAnnotation();
      if (hit) p.onSelectMark?.(hit); else if (w) setSel(w);
    },
    onLongPressVerse: (vk) => { if (mode) return; const v = verseOf(vk); if (s.press === "shortPress") p.onToggleVerse(v); else p.onVerseDetail(v); },
    onTapEmpty: () => { if (mode) { if (selectedMark) p.onSelectMark?.(null); if (wordSel) setSel(null); } },
    onMouseSelectionStart: () => { if (!p.onEnterAnnotation || selectedMode) return false; p.onEnterAnnotation(); return true; },
    onDragStart: () => { if (selectedMark) p.onSelectMark?.(null); },
    onSwipe: (dir) => { if (p.canSwipe && !isContextFocused) p.onSwipe(dir); },
  }, p.setWordSelection ? { annotationMode: mode, selection: wordSel, setSelection: p.setWordSelection, wordAt, handles, layer: layerRef } : undefined);

  // Scroll velocity above 400 px/s hides the header (SWIPE_DOWN) and shows it again (SWIPE_UP).
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    let lastTop = el.scrollTop, lastTime = Date.now(), canDown = true, canUp = true, reached = false;
    const onScroll = () => {
      const top = el.scrollTop, now = Date.now(), dt = now - lastTime, dy = top - lastTop;
      const velocity = Math.abs(dy / Math.max(dt, 1)); const total = el.scrollHeight - el.clientHeight;
      if (top < 0 || top > total) { if (!reached) p.onFullscreen(false); reached = true; return; }
      reached = false;
      if (velocity * 1000 > 400 && !suppressRef.current) {
        if (dy > 0 && canDown) { p.onFullscreen(true); canDown = false; canUp = true; }
        else if (dy < 0 && canUp) { p.onFullscreen(false); canUp = false; canDown = true; }
      }
      lastTop = top; lastTime = now;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [p.onFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

  // A layout change (a new chapter, the focus bar, the header collapsing) moves the scroll position without a gesture; it must not read as a fast scroll.
  useEffect(() => { suppressRef.current = true; const t = setTimeout(() => { suppressRef.current = false; }, 600); return () => clearTimeout(t); }, [chapter, p.contextDisplayMode, p.headerHeight, hasVerses, focus?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const scrollTarget = isContextFocused && focus?.length ? Math.min(...focus) : p.verseToScroll;
  useEffect(() => { if (hasVerses && scrollTarget === 1) scrollRef.current?.scrollTo({ top: 0 }); }, [chapter, scrollTarget, hasVerses, p.navigationRequest]);
  useEffect(() => {
    if (!scrollTarget || !hasVerses || scrollTarget === 1) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`#verset-${scrollTarget}`); const sc = scrollRef.current;
      if (el && sc) { suppressRef.current = true; sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 100 }); setTimeout(() => { suppressRef.current = false; }, 400); }
    });
  }, [scrollTarget, hasVerses, p.contextDisplayMode, focus?.join(","), p.navigationRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // The last selected verse: scrolled to the middle when selected, and a button to return to it when it leaves the screen.
  const lastSelected = p.selected[p.selected.length - 1];
  const returnPosition = (): "top" | "bottom" | null => {
    const sc = scrollRef.current; const el = lastSelected ? sc?.querySelector<HTMLElement>(`#verset-${lastSelected}`) : null;
    if (!el || !sc) return null;
    const r = el.getBoundingClientRect(), s0 = sc.getBoundingClientRect();
    if (r.bottom < s0.top + p.headerHeight) return "top";
    if (r.top > s0.bottom - RETURN_BOTTOM_OFFSET) return "bottom";
    return null;
  };
  const scrollSelectedToMiddle = (behavior: ScrollBehavior = "smooth") => {
    const sc = scrollRef.current; const el = lastSelected ? sc?.querySelector<HTMLElement>(`#verset-${lastSelected}`) : null;
    if (!el || !sc) return;
    const r = el.getBoundingClientRect(), s0 = sc.getBoundingClientRect();
    suppressRef.current = true;
    // The middle of what the selection sheet leaves showing, so the verse is never under it.
    const sheet = document.querySelector<HTMLElement>(".bs-sheet.bs-selected");
    const covered = sheet ? Math.max(0, s0.bottom - sheet.getBoundingClientRect().top) : 0;
    sc.scrollTo({ top: sc.scrollTop + (r.top - s0.top) - (sc.clientHeight - covered) / 2 + r.height / 2, behavior });
    setReturnPos(null);
    setTimeout(() => { suppressRef.current = false; setReturnPos(returnPosition()); }, 450);
  };
  useEffect(() => { if (!lastSelected || !hasVerses) { setReturnPos(null); return; } requestAnimationFrame(() => scrollSelectedToMiddle("smooth")); }, [lastSelected, hasVerses]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!lastSelected) return;
    const sc = scrollRef.current; if (!sc) return;
    let raf: number | null = null;
    const update = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setReturnPos(returnPosition())); };
    update(); sc.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update);
    return () => { sc.removeEventListener("scroll", update); window.removeEventListener("resize", update); if (raf) cancelAnimationFrame(raf); };
  }, [lastSelected, p.headerHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <div ref={scrollRef} className="bs-scroll" style={{ background: "var(--bs-reverse)", color: "var(--bs-default)" }}>
      <div ref={layerRef} className="bs-container" data-annotating={mode ? "" : undefined} style={{ position: "relative", maxWidth: READING_TEXT_MAX_WIDTH + HORIZONTAL_PADDING * 2, padding: `${p.headerHeight + 10}px ${HORIZONTAL_PADDING}px 300px`, textAlign: s.alignContent, background: "var(--bs-reverse)", color: "var(--bs-default)" }}>
        {isContextFocused && focus?.length ? null : p.header}
        {p.verses.map((row) => {
          const n = row.verse;
          const isFocused = focus?.length ? focus.includes(n) : undefined;
          if (isContextFocused && focus?.length && !isFocused) return null;
          const vk = makeKey(slug, chapter, n);
          const items = p.relationItems[n];
          return (
            <Verse key={vk} verseKey={vk} number={n} text={row.text} settings={s} palette={c} theme={theme}
              isSelected={p.selected.includes(n)} isSelectedMode={selectedMode} isTouched={touched === vk}
              highlightedColor={p.highlights[String(n)]?.color} bookmark={bookmarkOf.get(n)}
              isVerseToScroll={!isContextFocused && p.verseToScroll === n && n !== 1} isFocused={isFocused}
              relationItems={items} relationCount={items?.length || undefined}
              moments={p.moments?.[n]} deck={p.deck}
              tagGroup={tagGroups.get(n)} taggedItemsCount={p.highlights[String(n)]?.tags ? Object.keys(p.highlights[String(n)].tags!).length : 0}
              onOpenBookmark={p.onOpenBookmark} onOpenRelations={() => p.onOpenRelations(n)} onOpenRelationItem={p.onOpenRelationItem} onOpenTags={() => p.onOpenTags(n)} onOpenTag={p.onOpenTag} />
          );
        })}
        {p.footer}
        {p.marks?.length ? <MarkInlineItems marks={p.marks} markItems={p.markItems ?? {}} tags={p.tags} settings={s} palette={c} theme={theme} contentKey={`${slug}-${chapter}-${p.verses.length}`}
          onOpenRelationItem={p.onOpenRelationItem} onOpenTags={(id) => p.onOpenMarkTags?.(id)} onOpenTag={p.onOpenTag} /> : null}
        <HighlightLayer rects={highlightRects} selectedId={selectedMark} dimmed={!mode && selectedMode} handles={handles} showHandles={mode && !!wordSel} />
      </div>
      <button type="button" className="bs-return" aria-label="Return to the selected verse" title="Return to the selected verse" onClick={() => scrollSelectedToMiddle()}
        style={{ top: returnPos === "top" ? HEADER_HEIGHT + 12 : undefined, bottom: returnPos === "bottom" ? RETURN_BOTTOM_OFFSET + 16 : undefined, transform: `translateX(-50%) scale(${returnPos ? 1 : 0.95})`, opacity: returnPos ? 1 : 0, pointerEvents: returnPos ? "auto" : "none", border: `1px solid var(--bs-border)`, background: "var(--bs-reverse)", color: "var(--bs-primary)", boxShadow: isDarkTheme(theme) ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(0, 0, 0, 0.18)" }}>
        <Feather name={returnPos === "top" ? "chevron-up" : "chevron-down"} size={24} color={"var(--bs-primary)"} />
      </button>
    </div>
      <button type="button" className="bs-follow" aria-label={reading != null ? `Back to verse ${reading}, now being read` : undefined} title={reading != null ? `Back to verse ${reading}, now being read` : undefined} aria-hidden={readingAway ? undefined : true} tabIndex={readingAway ? 0 : -1} onClick={followReading}
        data-at={readingAway ?? undefined} style={{ top: p.headerHeight + 12 }}>
        <Feather name={readingAway === "top" ? "arrow-up" : "arrow-down"} size={16} color="currentColor" />
        <span>Back to verse {reading}</span>
      </button>
    </>
  );
}

