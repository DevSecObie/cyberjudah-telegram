import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { collectAnnotationTextNodes, createAnnotationTextRanges } from "./annotationDomText";
import type { Mark } from "./marks";
import { buildRangesFromSelection, type SelectionRange, type SelectionVerse } from "./selectionUtils";
import { tokenizeVerseText } from "./wordTokenizer";

/**
 * Bible Strong's highlight layer (BibleDOM/AnnotationMode/useAnnotationHighlights.ts and
 * HighlightComponents.tsx): every mark and the word selection drawn as rectangles behind the
 * text, measured from the DOM ranges of their characters, one per line. Only selection and
 * selected-mark outlines are painted here; saved marks retain CyberJudah's inline styling.
 */
export type MarkKind = "background" | "underline" | "circle";
export const kindOfStyle = (s: Mark["style"]): MarkKind => (s === "highlight" ? "background" : s);
export const styleOfKind = (k: MarkKind): Mark["style"] => (k === "background" ? "highlight" : k);

export interface HighlightRect {
  id: string; top: number; left: number; width: number; height: number; color: string;
  type: "selection" | "annotation"; annotationType?: MarkKind; annotationId?: string;
}

/** Merges the rects on one line (within 5 px) into a single rect from leftmost to rightmost. */
function mergeRectsOnSameLine(rects: DOMRect[]): DOMRect[] {
  if (rects.length === 0) return [];
  const lineGroups = new Map<number, DOMRect[]>();
  const LINE_TOLERANCE = 5;
  for (const rect of rects) {
    let foundLine: number | null = null;
    for (const lineTop of lineGroups.keys()) if (Math.abs(rect.top - lineTop) < LINE_TOLERANCE) { foundLine = lineTop; break; }
    if (foundLine !== null) lineGroups.get(foundLine)!.push(rect); else lineGroups.set(rect.top, [rect]);
  }
  const merged: DOMRect[] = [];
  for (const lineRects of lineGroups.values()) {
    const left = Math.min(...lineRects.map((r) => r.left)), right = Math.max(...lineRects.map((r) => r.right));
    const top = Math.min(...lineRects.map((r) => r.top)), height = Math.max(...lineRects.map((r) => r.height));
    merged.push(new DOMRect(left, top, right - left, height));
  }
  return merged.sort((a, b) => a.top - b.top);
}

/** The rects of characters [start, end) of a verse, relative to the container. */
function rectsForChars(verseKey: string, start: number, end: number, containerRect: DOMRect) {
  const verseEl = document.getElementById(`verse-text-${verseKey}`);
  if (!verseEl) return [];
  const { fullText, textNodes } = collectAnnotationTextNodes(verseEl);
  if (!fullText || textNodes.length === 0) return [];
  try {
    const domRanges = createAnnotationTextRanges(textNodes, start, end);
    return mergeRectsOnSameLine(domRanges.flatMap((range) => Array.from(range.getClientRects())))
      .map((rect) => ({ top: rect.top - containerRect.top, left: rect.left - containerRect.left, width: rect.width, height: rect.height }));
  } catch { return []; }
}

const DEFAULT_HIGHLIGHT_COLOR = "rgba(255, 255, 0, 0.3)";
const tokens = (_: string, text: string) => tokenizeVerseText(text);

export function useAnnotationHighlights({ containerRef, marks, verses, selection, colorOf, chapterKey, layoutKey }: {
  containerRef: RefObject<HTMLElement | null>; marks: Mark[]; verses: SelectionVerse[]; selection: SelectionRange | null;
  colorOf: (key: string) => string | null; chapterKey: string; layoutKey: string;
}) {
  const [rects, setRects] = useState<HighlightRect[]>([]);
  const [pending, setPending] = useState(true);
  const prevChapter = useRef(chapterKey);
  const marksKey = marks.map((m) => `${m.id}:${m.style}:${m.color}:${m.records.map((r) => `${r.verseKey}.${r.start}.${r.end}`).join("|")}`).sort().join(",");
  useEffect(() => {
    const chapterChange = prevChapter.current !== chapterKey; prevChapter.current = chapterKey;
    if (chapterChange) setPending(true);
    const compute = (): HighlightRect[] => {
      const container = containerRef.current; if (!container) return [];
      const containerRect = container.getBoundingClientRect(), out: HighlightRect[] = [];
      for (const m of marks) {
        // Resolve the colour: the theme's colour for the key, a custom colour, else the default yellow.
        const color = (m.color && colorOf(m.color)) || (m.color ? null : "#d9a625") || DEFAULT_HIGHLIGHT_COLOR;
        m.records.filter(r => verses.some(v => v.verseKey === r.verseKey && v.text.slice(r.start, r.end) === r.quote)).forEach((r, rangeIdx) => rectsForChars(r.verseKey, r.start, r.end, containerRect).forEach((rect, rectIdx) => out.push({ id: `${m.id}-${rangeIdx}-${rectIdx}`, ...rect, color, type: "annotation", annotationType: kindOfStyle(m.style), annotationId: m.id })));
      }
      if (selection) for (const r of buildRangesFromSelection(selection, verses, tokens)) {
        rectsForChars(r.verseKey, r.charStart, r.charEnd, containerRect).forEach((rect, rectIdx) => out.push({ id: `selection-${r.verseKey}-${rectIdx}`, ...rect, color: "rgba(0, 122, 255, 0.3)", type: "selection" }));
      }
      return out;
    };
    const update = () => setRects(compute());
    const raf = requestAnimationFrame(() => { update(); if (chapterChange) setPending(false); });
    let again: number | null = null;
    const later = () => { if (again) cancelAnimationFrame(again); again = requestAnimationFrame(update); };
    window.addEventListener("resize", later);
    document.fonts?.addEventListener("loadingdone", later);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    if (containerRef.current && ro) ro.observe(containerRef.current);
    if (pending && !chapterChange) setPending(false);
    return () => { cancelAnimationFrame(raf); if (again) cancelAnimationFrame(again); window.removeEventListener("resize", later); document.fonts?.removeEventListener("loadingdone", later); ro?.disconnect(); };
  }, [chapterKey, marksKey, selection, verses, colorOf, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handles from the selection rects: the start at the first rect's top left, the end at the last's bottom right, 2 px in.
  const sel = rects.filter((r) => r.type === "selection").sort((a, b) => (Math.abs(a.top - b.top) > 5 ? a.top - b.top : a.left - b.left));
  const HANDLE_OFFSET = 2;
  const handles = sel.length
    ? { start: { x: sel[0].left, y: sel[0].top + HANDLE_OFFSET }, end: { x: sel[sel.length - 1].left + sel[sel.length - 1].width, y: sel[sel.length - 1].top + sel[sel.length - 1].height - HANDLE_OFFSET } }
    : { start: null, end: null };
  return { highlightRects: pending && !selection ? [] : rects, handles };
}

// Selection geometry is from #238. Saved marks use CyberJudah's existing inline styles in Verse.
function rectStyle(rect: HighlightRect): CSSProperties {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height,
    ...(rect.type === "selection" ? { background: "color-mix(in srgb, var(--bs-primary) 25%, transparent)" } : {}) };
}

/** HighlightLayer + HighlightRectDiv + SelectionHandles. */
export function HighlightLayer({ rects, selectedId, dimmed, handles, showHandles }: {
  rects: HighlightRect[]; selectedId: string | null; dimmed: boolean;
  handles: { start: { x: number; y: number } | null; end: { x: number; y: number } | null }; showHandles: boolean;
}) {
  if (!rects.length && !showHandles) return null;
  return (
    <div className="bs-hl-layer" data-dimmed={dimmed ? "" : undefined} aria-hidden="true">
      {rects.map((r) => (
        <div key={r.id} className={`bs-hl${r.type === "annotation" ? ` bs-hl--${r.annotationType}` : " bs-hl--selection"}`} data-annotation={r.annotationId}
          data-selected={r.annotationId && r.annotationId === selectedId ? "" : undefined} style={rectStyle(r)} />
      ))}
      {showHandles && handles.start ? <span className="bs-sel-handle bs-sel-handle--start" style={{ top: handles.start.y, left: handles.start.x }} /> : null}
      {showHandles && handles.end ? <span className="bs-sel-handle bs-sel-handle--end" style={{ top: handles.end.y, left: handles.end.x }} /> : null}
    </div>
  );
}

/** Hit-test the rendered mark, even when fonts or inline content have moved it. */
export function annotationAt(target: EventTarget | null): string | null {
  return target instanceof Element ? target.closest<HTMLElement>("[data-mark]")?.dataset.mark ?? null : null;
}
/** isClickInsideSelection. */
export function insideSelection(rects: HighlightRect[], container: HTMLElement | null, p: { x: number; y: number }): boolean {
  const c = container?.getBoundingClientRect(); if (!c) return false;
  const x = p.x - c.left, y = p.y - c.top;
  return rects.some((r) => r.type === "selection" && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
}
