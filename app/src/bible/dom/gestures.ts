import { useEffect, useRef, type RefObject } from "react";

import type { SelectionRange, WordPosition } from "../annotation/selectionUtils";

/**
 * Bible Strong's touch engine for the verse area (BibleDOM/AnnotationMode/useTouchSelection.ts):
 * a tap waits 200 ms for a double tap, a long press fires at 400 ms, a fast horizontal move
 * (≥ 0.3 px/ms, ≥ 50 px, < 300 ms) is a swipe, a vertical move over 10 px is a scroll.
 * In annotation mode a slow horizontal drag selects words from the word it started on, a touch
 * within 30 px of a selection handle drags that end, and the page scrolls by itself 5 px a frame
 * while the finger is within 100 px of the top or 280 px of the bottom. A mouse drag of more than
 * 10 px selects in any direction, and from reading mode enters annotation mode
 * (`onMouseSelectionStart`). Elements marked `data-ignore-verse-touch` never start a gesture.
 */
const DRAG_THRESHOLD = 10, DOUBLE_TAP_DELAY = 200, LONG_PRESS_DELAY = 400;
const SWIPE_VELOCITY_THRESHOLD = 0.3, SWIPE_MIN_DISTANCE = 50, SWIPE_MAX_TIME = 300, VELOCITY_SAMPLE_COUNT = 5;
const AUTO_SCROLL_ZONE_TOP = 100, AUTO_SCROLL_ZONE_BOTTOM = 280, AUTO_SCROLL_SPEED = 5, HANDLE_HIT_RADIUS = 30;

type Point = { x: number; y: number };
export type GestureCallbacks = {
  onTapVerse?: (verseKey: string, position: Point) => void;
  onDoubleTapVerse?: (verseKey: string, position: Point) => void;
  onLongPressVerse?: (verseKey: string) => void;
  onTouchedVerseChange?: (verseKey: string | null) => void;
  onTapEmpty?: () => void;
  onSwipe?: (direction: "left" | "right") => void;
  /** A mouse drag in reading mode: true enters annotation mode and lets the drag select. */
  onMouseSelectionStart?: () => boolean;
  onDragStart?: () => void;
};
export type SelectionSupport = {
  annotationMode: boolean;
  selection: SelectionRange | null;
  setSelection: (fn: (prev: SelectionRange | null) => SelectionRange | null) => void;
  wordAt: (x: number, y: number) => WordPosition | null;
  /** The handles, relative to `layer`. */
  handles: { start: Point | null; end: Point | null };
  layer: RefObject<HTMLElement | null>;
};

const verseKeyAt = (target: EventTarget | null): string | null => (target instanceof Element ? target.closest<HTMLElement>("[data-vk]")?.dataset.vk ?? null : null);
const ignored = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("[data-ignore-verse-touch]"));

export function useVerseGestures(containerRef: RefObject<HTMLElement | null>, callbacks: GestureCallbacks, selection?: SelectionSupport) {
  const cbs = useRef(callbacks); cbs.current = callbacks;
  const sel = useRef(selection); sel.current = selection;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const st = { active: false, startPos: { x: 0, y: 0 }, startVerseKey: null as string | null, startWord: null as WordPosition | null, hasMoved: false, isSwipe: false, isDragging: false, dragHandle: null as "start" | "end" | null, longPressFired: false, startTime: 0, samples: [] as { time: number; x: number }[], lastTapTime: 0, lastTapVerseKey: null as string | null, lastTapPos: { x: 0, y: 0 }, longPressTimer: null as ReturnType<typeof setTimeout> | null, singleTapTimer: null as ReturnType<typeof setTimeout> | null };
    let lastTouchEndAt = 0, mouseIsDown = false, autoScroll: number | null = null, current: Point | null = null;
    const clearTimers = () => { if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; } if (st.singleTapTimer) { clearTimeout(st.singleTapTimer); st.singleTapTimer = null; } };
    const stopAutoScroll = () => { if (autoScroll) { cancelAnimationFrame(autoScroll); autoScroll = null; } };
    const reset = () => { st.isDragging = false; st.isSwipe = false; st.hasMoved = false; st.dragHandle = null; st.startWord = null; st.startVerseKey = null; st.longPressFired = false; st.samples = []; };
    const cancel = () => {
      clearTimers(); stopAutoScroll(); mouseIsDown = false; current = null;
      st.active = false; reset(); st.lastTapTime = 0; st.lastTapVerseKey = null;
      cbs.current.onTouchedVerseChange?.(null);
    };
    // updateSelectionDuringDrag: the dragged handle's end follows the word under the pointer.
    const dragTo = (w: WordPosition) => sel.current?.setSelection((prev) => {
      if (!prev) return st.startWord ? { start: st.startWord, end: w } : null;
      return st.dragHandle === "start" ? { start: w, end: prev.end } : { start: prev.start, end: w };
    });
    const startAutoScroll = (dy: number) => {
      if (autoScroll) return;
      const tick = () => {
        el.scrollBy({ top: dy });
        if (current && st.isDragging) { const w = sel.current?.wordAt(current.x, current.y); if (w) dragTo(w); }
        autoScroll = requestAnimationFrame(tick);
      };
      autoScroll = requestAnimationFrame(tick);
    };
    const followDrag = (x: number, y: number) => {
      const w = sel.current?.wordAt(x, y); if (w) dragTo(w);
      if (y < AUTO_SCROLL_ZONE_TOP) startAutoScroll(-AUTO_SCROLL_SPEED);
      else if (y > window.innerHeight - AUTO_SCROLL_ZONE_BOTTOM) startAutoScroll(AUTO_SCROLL_SPEED);
      else stopAutoScroll();
    };
    const nearHandle = (x: number, y: number): "start" | "end" | null => {
      const s = sel.current; if (!s?.selection || !s.annotationMode) return null;
      const r = s.layer.current?.getBoundingClientRect(); if (!r) return null;
      for (const which of ["start", "end"] as const) { const h = s.handles[which]; if (h && Math.hypot(x - (r.left + h.x), y - (r.top + h.y)) < HANDLE_HIT_RADIUS) return which; }
      return null;
    };
    /** Starts a gesture; true when it grabbed a selection handle (the caller then blocks scrolling). */
    const begin = (x: number, y: number, target: EventTarget | null): boolean => {
      const skip = ignored(target);
      const word = skip ? null : sel.current?.wordAt(x, y) ?? null;
      const vk = skip ? null : word?.verseKey ?? verseKeyAt(target);
      // A second verse cannot form a double tap with the first. Deliver that completed tap
      // before replacing its timer so a quick passage selection keeps both verses.
      if (vk && st.singleTapTimer && st.lastTapVerseKey && st.lastTapVerseKey !== vk) {
        cbs.current.onTapVerse?.(st.lastTapVerseKey, st.lastTapPos);
        st.lastTapTime = 0; st.lastTapVerseKey = null;
      }
      clearTimers();
      const now = Date.now();
      st.active = !skip; st.startPos = { x, y }; st.isDragging = false; st.dragHandle = null; st.hasMoved = false; st.isSwipe = false; st.longPressFired = false; st.startTime = now; st.samples = [{ time: now, x }];
      current = { x, y };
      if (skip) { st.hasMoved = true; st.startVerseKey = null; st.startWord = null; cbs.current.onTouchedVerseChange?.(null); return false; }
      st.startWord = word; st.startVerseKey = vk;
      if (vk) cbs.current.onTouchedVerseChange?.(vk);
      const handle = nearHandle(x, y);
      if (handle) { st.dragHandle = handle; st.isDragging = true; return true; }
      if (vk) {
        st.longPressTimer = setTimeout(() => {
          if (!st.hasMoved && !st.isDragging && st.startVerseKey) { st.longPressFired = true; cbs.current.onTouchedVerseChange?.(null); cbs.current.onLongPressVerse?.(st.startVerseKey); }
        }, LONG_PRESS_DELAY);
      }
      return false;
    };
    const stopLongPress = () => { if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; } };
    const startDrag = (end: WordPosition) => {
      st.isDragging = true; cbs.current.onDragStart?.();
      const start = st.startWord!; sel.current?.setSelection(() => ({ start, end }));
    };
    /** True when the move belongs to a selection drag (the caller blocks scrolling). */
    const moveTouch = (x: number, y: number): boolean => {
      if (!st.active) return false;
      const now = Date.now(); current = { x, y };
      st.samples.push({ time: now, x }); if (st.samples.length > VELOCITY_SAMPLE_COUNT) st.samples.shift();
      if (st.isDragging) { followDrag(x, y); return true; }
      if (st.isSwipe || st.hasMoved) return false;
      const dx = Math.abs(x - st.startPos.x), dy = Math.abs(y - st.startPos.y);
      if (dy > DRAG_THRESHOLD) { st.hasMoved = true; stopLongPress(); cbs.current.onTouchedVerseChange?.(null); return false; }
      if (dx > DRAG_THRESHOLD && dx > dy) {
        stopLongPress(); cbs.current.onTouchedVerseChange?.(null);
        const first = st.samples[0]; const dt = now - first.time;
        const velocity = dt > 0 ? Math.abs(x - first.x) / dt : 0;
        if (velocity >= SWIPE_VELOCITY_THRESHOLD) { st.isSwipe = true; return false; }
        // Slow movement: a text selection in annotation mode, nothing in reading mode.
        if (st.startWord && sel.current?.annotationMode) { startDrag(st.startWord); return true; }
        st.hasMoved = true;
      }
      return false;
    };
    const moveMouse = (x: number, y: number): boolean => {
      if (!st.active) return false;
      const now = Date.now(); current = { x, y };
      st.samples.push({ time: now, x }); if (st.samples.length > VELOCITY_SAMPLE_COUNT) st.samples.shift();
      if (st.isDragging) { followDrag(x, y); return true; }
      if (st.hasMoved || st.isSwipe) return false;
      const dx = Math.abs(x - st.startPos.x), dy = Math.abs(y - st.startPos.y);
      if (Math.max(dx, dy) <= DRAG_THRESHOLD) return false;
      stopLongPress(); cbs.current.onTouchedVerseChange?.(null);
      // A fast horizontal flick of the mouse still turns the chapter.
      const first = st.samples[0], dt = now - first.time;
      if (dx > dy && dt > 0 && Math.abs(x - first.x) / dt >= SWIPE_VELOCITY_THRESHOLD) { st.isSwipe = true; return false; }
      if (st.startWord && sel.current && (sel.current.annotationMode || cbs.current.onMouseSelectionStart?.())) { startDrag(sel.current.wordAt(x, y) ?? st.startWord); return true; }
      st.hasMoved = true;
      return false;
    };
    const end = (x: number) => {
      if (!st.active) return;
      st.active = false; stopAutoScroll(); current = null;
      const now = Date.now();
      stopLongPress();
      cbs.current.onTouchedVerseChange?.(null);
      if (st.isSwipe) {
        const elapsed = now - st.startTime, dist = Math.abs(x - st.startPos.x);
        if (dist >= SWIPE_MIN_DISTANCE && elapsed < SWIPE_MAX_TIME) cbs.current.onSwipe?.(x < st.startPos.x ? "left" : "right");
        reset(); return;
      }
      if (!st.isDragging && !st.hasMoved && !st.longPressFired) {
        const vk = st.startVerseKey;
        if (vk) {
          if (st.lastTapVerseKey === vk && now - st.lastTapTime < DOUBLE_TAP_DELAY) {
            if (st.singleTapTimer) { clearTimeout(st.singleTapTimer); st.singleTapTimer = null; }
            const pos = { ...st.startPos }; st.lastTapTime = 0; st.lastTapVerseKey = null;
            cbs.current.onDoubleTapVerse?.(vk, pos);
          } else {
            const pos = { ...st.startPos }; st.lastTapTime = now; st.lastTapVerseKey = vk; st.lastTapPos = pos;
            st.singleTapTimer = setTimeout(() => { if (st.lastTapVerseKey === vk) { cbs.current.onTapVerse?.(vk, pos); st.lastTapVerseKey = null; } st.singleTapTimer = null; }, DOUBLE_TAP_DELAY);
          }
        } else cbs.current.onTapEmpty?.();
      }
      reset();
    };
    const onTouchStart = (e: TouchEvent) => { lastTouchEndAt = Date.now(); if (e.touches.length !== 1) { cancel(); return; } const t = e.touches[0]; if (begin(t.clientX, t.clientY, e.target)) e.preventDefault(); };
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length !== 1) { cancel(); return; } const t = e.touches[0]; if (moveTouch(t.clientX, t.clientY)) e.preventDefault(); };
    const onTouchEnd = (e: TouchEvent) => { lastTouchEndAt = Date.now(); if (e.touches.length) { cancel(); return; } const t = e.changedTouches[0]; end(t?.clientX ?? st.startPos.x); };
    const onTouchCancel = () => { lastTouchEndAt = Date.now(); cancel(); };
    const onVisibilityChange = () => { if (document.hidden) cancel(); };
    const onMouseDown = (e: MouseEvent) => { if (e.button !== 0 || Date.now() - lastTouchEndAt < 700) return; mouseIsDown = true; if (begin(e.clientX, e.clientY, e.target)) e.preventDefault(); };
    const onMouseMove = (e: MouseEvent) => { if (mouseIsDown && moveMouse(e.clientX, e.clientY)) e.preventDefault(); };
    const onMouseUp = (e: MouseEvent) => { if (!mouseIsDown) return; mouseIsDown = false; end(e.clientX); };
    // A right click on a verse opens no browser menu.
    const onContextMenu = (e: MouseEvent) => { if (verseKeyAt(e.target)) e.preventDefault(); };
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove, { passive: false });
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimers(); stopAutoScroll();
      el.removeEventListener("touchstart", onTouchStart); el.removeEventListener("touchmove", onTouchMove); el.removeEventListener("touchend", onTouchEnd); el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("mousedown", onMouseDown); el.removeEventListener("contextmenu", onContextMenu); window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [containerRef]);
}
