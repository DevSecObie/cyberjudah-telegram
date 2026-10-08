import { useEffect, useRef, type RefObject } from "react";

/**
 * Bible Strong's touch engine for the verse area (BibleDOM/AnnotationMode/useTouchSelection.ts),
 * without the word-level drag: a tap waits 200 ms for a double tap, a long press fires at
 * 400 ms, a fast horizontal move (≥ 0.3 px/ms, ≥ 50 px, < 300 ms) is a swipe, a vertical move
 * over 10 px is a scroll. Elements marked `data-ignore-verse-touch` never start a gesture.
 */
const DRAG_THRESHOLD = 10, DOUBLE_TAP_DELAY = 200, LONG_PRESS_DELAY = 400;
const SWIPE_VELOCITY_THRESHOLD = 0.3, SWIPE_MIN_DISTANCE = 50, SWIPE_MAX_TIME = 300, VELOCITY_SAMPLE_COUNT = 5;

export type GestureCallbacks = {
  onTapVerse?: (verseKey: string, position: { x: number; y: number }) => void;
  onDoubleTapVerse?: (verseKey: string, position: { x: number; y: number }) => void;
  onLongPressVerse?: (verseKey: string) => void;
  onTouchedVerseChange?: (verseKey: string | null) => void;
  onTapEmpty?: () => void;
  onSwipe?: (direction: "left" | "right") => void;
};

const verseKeyAt = (target: EventTarget | null): string | null => (target instanceof Element ? target.closest<HTMLElement>("[data-vk]")?.dataset.vk ?? null : null);
const ignored = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("[data-ignore-verse-touch]"));

export function useVerseGestures(containerRef: RefObject<HTMLElement | null>, callbacks: GestureCallbacks) {
  const cbs = useRef(callbacks); cbs.current = callbacks;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const st = { active: false, startPos: { x: 0, y: 0 }, startVerseKey: null as string | null, hasMoved: false, isSwipe: false, longPressFired: false, startTime: 0, samples: [] as { time: number; x: number }[], lastTapTime: 0, lastTapVerseKey: null as string | null, lastTapPos: { x: 0, y: 0 }, longPressTimer: null as ReturnType<typeof setTimeout> | null, singleTapTimer: null as ReturnType<typeof setTimeout> | null };
    let lastTouchEndAt = 0, mouseIsDown = false;
    const clearTimers = () => { if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; } if (st.singleTapTimer) { clearTimeout(st.singleTapTimer); st.singleTapTimer = null; } };
    const cancel = () => {
      clearTimers(); mouseIsDown = false;
      st.active = false; st.startVerseKey = null; st.hasMoved = false; st.isSwipe = false; st.longPressFired = false; st.lastTapTime = 0; st.lastTapVerseKey = null;
      cbs.current.onTouchedVerseChange?.(null);
    };
    const begin = (x: number, y: number, target: EventTarget | null) => {
      const skip = ignored(target), vk = skip ? null : verseKeyAt(target);
      // A second verse cannot form a double tap with the first. Deliver that completed tap
      // before replacing its timer so a quick passage selection keeps both verses.
      if (vk && st.singleTapTimer && st.lastTapVerseKey && st.lastTapVerseKey !== vk) {
        cbs.current.onTapVerse?.(st.lastTapVerseKey, st.lastTapPos);
        st.lastTapTime = 0; st.lastTapVerseKey = null;
      }
      clearTimers();
      const now = Date.now();
      st.active = !skip; st.startPos = { x, y }; st.hasMoved = false; st.isSwipe = false; st.longPressFired = false; st.startTime = now; st.samples = [{ time: now, x }];
      if (skip) { st.hasMoved = true; st.startVerseKey = null; cbs.current.onTouchedVerseChange?.(null); return; }
      st.startVerseKey = vk;
      if (st.startVerseKey) {
        cbs.current.onTouchedVerseChange?.(st.startVerseKey);
        st.longPressTimer = setTimeout(() => {
          if (!st.hasMoved && st.startVerseKey) { st.longPressFired = true; cbs.current.onTouchedVerseChange?.(null); cbs.current.onLongPressVerse?.(st.startVerseKey); }
        }, LONG_PRESS_DELAY);
      }
    };
    const move = (x: number, y: number) => {
      if (!st.active) return;
      const now = Date.now();
      st.samples.push({ time: now, x }); if (st.samples.length > VELOCITY_SAMPLE_COUNT) st.samples.shift();
      if (st.isSwipe || st.hasMoved) return;
      const dx = Math.abs(x - st.startPos.x), dy = Math.abs(y - st.startPos.y);
      if (dy > DRAG_THRESHOLD) { st.hasMoved = true; if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; } cbs.current.onTouchedVerseChange?.(null); return; }
      if (dx > DRAG_THRESHOLD && dx > dy) {
        if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; }
        cbs.current.onTouchedVerseChange?.(null);
        const first = st.samples[0]; const dt = now - first.time;
        const velocity = dt > 0 ? Math.abs(x - first.x) / dt : 0;
        if (velocity >= SWIPE_VELOCITY_THRESHOLD) { st.isSwipe = true; return; }
        st.hasMoved = true;
      }
    };
    const end = (x: number) => {
      if (!st.active) return;
      st.active = false;
      const now = Date.now();
      if (st.longPressTimer) { clearTimeout(st.longPressTimer); st.longPressTimer = null; }
      cbs.current.onTouchedVerseChange?.(null);
      if (st.isSwipe) {
        const elapsed = now - st.startTime, dist = Math.abs(x - st.startPos.x);
        if (dist >= SWIPE_MIN_DISTANCE && elapsed < SWIPE_MAX_TIME) cbs.current.onSwipe?.(x < st.startPos.x ? "left" : "right");
        st.isSwipe = false; st.hasMoved = false; return;
      }
      if (!st.hasMoved && !st.longPressFired) {
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
      st.hasMoved = false; st.longPressFired = false; st.startVerseKey = null;
    };
    const onTouchStart = (e: TouchEvent) => { lastTouchEndAt = Date.now(); if (e.touches.length !== 1) { cancel(); return; } const t = e.touches[0]; begin(t.clientX, t.clientY, e.target); };
    const onTouchMove = (e: TouchEvent) => { if (e.touches.length !== 1) { cancel(); return; } const t = e.touches[0]; move(t.clientX, t.clientY); };
    const onTouchEnd = (e: TouchEvent) => { lastTouchEndAt = Date.now(); if (e.touches.length) { cancel(); return; } const t = e.changedTouches[0]; end(t?.clientX ?? st.startPos.x); };
    const onTouchCancel = () => { lastTouchEndAt = Date.now(); cancel(); };
    const onVisibilityChange = () => { if (document.hidden) cancel(); };
    const onMouseDown = (e: MouseEvent) => { if (e.button !== 0 || Date.now() - lastTouchEndAt < 700) return; mouseIsDown = true; begin(e.clientX, e.clientY, e.target); };
    const onMouseMove = (e: MouseEvent) => { if (mouseIsDown) move(e.clientX, e.clientY); };
    const onMouseUp = (e: MouseEvent) => { if (!mouseIsDown) return; mouseIsDown = false; end(e.clientX); };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimers();
      el.removeEventListener("touchstart", onTouchStart); el.removeEventListener("touchmove", onTouchMove); el.removeEventListener("touchend", onTouchEnd); el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("mousedown", onMouseDown); window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [containerRef]);
}
