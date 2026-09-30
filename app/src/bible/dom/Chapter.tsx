import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ClassMoment } from "@/api/data";
import type { VerseRelationItem } from "@/lib/relations";
import { verseKey as makeKey } from "@/lib/relations";
import { Feather } from "../icons";
import type { BibleSettings } from "../settings";
import type { Bookmark, Highlight, Tag } from "../store";
import { isDarkTheme, type Palette, type ThemeName } from "../theme";
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
  onSwipe: (dir: "left" | "right") => void; onFullscreen: (on: boolean) => void;
  onOpenBookmark: (b: Bookmark) => void; onOpenRelations: (v: number) => void; onOpenRelationItem: (it: VerseRelationItem) => void; onOpenTags: (v: number) => void; onOpenTag: (id: string) => void;
  footer?: ReactNode;
};

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
  const adjacent = focus?.length ? { prev: Math.min(...focus) - 1, next: Math.max(...focus) + 1 } : null;

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
  useVerseGestures(scrollRef, {
    onTouchedVerseChange: setTouched,
    onTapVerse: (vk) => { const v = verseOf(vk); if (selectedMode || s.press === "longPress") p.onToggleVerse(v); else p.onVerseDetail(v); },
    onLongPressVerse: (vk) => { const v = verseOf(vk); if (s.press === "shortPress") p.onToggleVerse(v); else p.onVerseDetail(v); },
    onDoubleTapVerse: (vk) => p.onDoubleTap?.(verseOf(vk)),
    onSwipe: (dir) => { if (p.canSwipe && !isContextFocused) p.onSwipe(dir); },
  });

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
    sc.scrollTo({ top: sc.scrollTop + (r.top - s0.top) - sc.clientHeight / 2 + r.height / 2, behavior });
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
    <div ref={scrollRef} className="bs-scroll" style={{ background: c.reverse, color: c.default }}>
      <div className="bs-container" style={{ maxWidth: READING_TEXT_MAX_WIDTH + HORIZONTAL_PADDING * 2, padding: `${p.headerHeight + 10}px ${HORIZONTAL_PADDING}px 300px`, textAlign: s.alignContent, background: c.reverse, color: c.default }}>
        {p.verses.map((row) => {
          const n = row.verse;
          const isFocused = focus?.length ? focus.includes(n) : undefined;
          const fadePosition = isContextFocused && adjacent ? (n === adjacent.prev ? "top" : n === adjacent.next ? "bottom" : undefined) : undefined;
          if (isContextFocused && focus?.length && !isFocused && !fadePosition) return null;
          const vk = makeKey(slug, chapter, n);
          const items = p.relationItems[n];
          return (
            <Verse key={vk} verseKey={vk} number={n} text={row.text} settings={s} palette={c} theme={theme}
              isSelected={p.selected.includes(n)} isSelectedMode={selectedMode} isTouched={touched === vk}
              highlightedColor={p.highlights[String(n)]?.color} bookmark={bookmarkOf.get(n)}
              isVerseToScroll={!isContextFocused && p.verseToScroll === n && n !== 1} isFocused={isFocused} fadePosition={fadePosition}
              relationItems={items} relationCount={items?.length || undefined}
              moments={p.moments?.[n]} deck={p.deck}
              tagGroup={tagGroups.get(n)} taggedItemsCount={p.highlights[String(n)]?.tags ? Object.keys(p.highlights[String(n)].tags!).length : 0}
              onOpenBookmark={p.onOpenBookmark} onOpenRelations={() => p.onOpenRelations(n)} onOpenRelationItem={p.onOpenRelationItem} onOpenTags={() => p.onOpenTags(n)} onOpenTag={p.onOpenTag} />
          );
        })}
        {p.footer}
      </div>
      <button type="button" className="bs-return" aria-label="Return to the selected verse" onClick={() => scrollSelectedToMiddle()}
        style={{ top: returnPos === "top" ? HEADER_HEIGHT + 12 : undefined, bottom: returnPos === "bottom" ? RETURN_BOTTOM_OFFSET + 16 : undefined, transform: `translateX(-50%) scale(${returnPos ? 1 : 0.95})`, opacity: returnPos ? 1 : 0, pointerEvents: returnPos ? "auto" : "none", border: `1px solid ${c.border}`, background: c.reverse, color: c.primary, boxShadow: isDarkTheme(theme) ? "0 8px 24px rgba(0, 0, 0, 0.45)" : "0 8px 24px rgba(0, 0, 0, 0.18)" }}>
        <Feather name={returnPos === "top" ? "chevron-up" : "chevron-down"} size={24} color={c.primary} />
      </button>
    </div>
  );
}
