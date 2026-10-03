import { useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

import { haptic } from "@/tg/sdk";

/**
 * A bottom sheet's snap points, driven by the finger: the gesture and motion half of Bible
 * Strong's event form sheet (iOS UISheetPresentationController with detents, a grabber, and the
 * timeline left visible under the smallest), for the web. bible/ui/Sheet.tsx renders it; this
 * only moves it.
 *
 *  - Detents are fractions of the height the sheet may take (the viewport below the safe area),
 *    smallest first; the last is the full sheet. The sheet is that full height and is moved by
 *    translateY, so its content never reflows while it is dragged.
 *  - The grabber and header drag it with pointer events. Its content drags it by touch until the
 *    sheet is full; at full the content scrolls, and pulling down from its top drags the sheet
 *    again (UIKit's scroll-edge hand-off, and @gorhom/bottom-sheet's BottomSheetScrollView). The
 *    browser never sees both, so a scroll and a drag cannot fight.
 *  - On release the drag's velocity is projected forward, as iOS does, and the sheet settles on
 *    the detent nearest where a throw would land; a quick swipe down from the smallest, or a
 *    throw well past it, dismisses.
 *  - It moves on a spring (Bible Strong's: stiffness 360, damping 34, mass 0.8) that carries the
 *    release velocity; with reduced motion, a short ease with no overshoot instead.
 *  - Nothing renders per frame: the transform is written to the element, and React hears only
 *    when a detent is reached.
 */
export type DetentsOptions = {
  /** Fractions of the available height, ascending; the last should be 1 (full). */
  detents: number[];
  /** The detent to open at (an index into `detents`). */
  initial?: number;
  /** A detent was reached (not called while dragging). */
  onDetent?: (index: number) => void;
  /** The sheet left the screen: unmount it. */
  onDismissed: () => void;
  /** Off: no gestures and no motion (the desktop side panel). */
  enabled?: boolean;
};
export type DetentsHandle = { snapTo: (index: number) => void; dismiss: () => void; index: () => number };

const STIFFNESS = 360, DAMPING = 34, MASS = 0.8;
/** How far ahead a throw is projected (iOS's normal deceleration, about 0.2s of the release velocity). */
const PROJECT_MS = 200;
/** A downward release this fast (px/ms) from the smallest detent dismisses. */
const FLING = 1.1;
/** Movement before a touch on the content is read as a drag or a scroll. */
const SLOP = 6;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

export function useDetents(sheet: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, grab: RefObject<HTMLElement | null>, opts: DetentsOptions): RefObject<DetentsHandle | null> {
  const o = useRef(opts);
  o.current = opts;
  const handle = useRef<DetentsHandle | null>(null);

  useLayoutEffect(() => {
    const el = sheet.current, content = body.current, grip = grab.current;
    if (!el || !content || !grip || o.current.enabled === false) return;
    let height = 0; // the full sheet's height
    let y = 0; // translateY now
    let index = Math.min(o.current.initial ?? 0, o.current.detents.length - 1);
    let raf = 0;
    let closing = false;

    const measure = () => {
      const vh = window.innerHeight;
      height = Math.max(200, vh - cssPx("--safe-top") - 8);
      el.style.height = `${height}px`;
    };
    const yOf = (i: number) => height - Math.round(height * o.current.detents[i]);
    const write = (v: number) => { y = v; el.style.transform = `translate3d(0, ${v}px, 0)`; };
    const settled = (i: number) => {
      const was = index;
      index = i;
      el.dataset.detent = i === o.current.detents.length - 1 ? "full" : String(i);
      el.style.setProperty("--sheet-visible", `${height - yOf(i)}px`);
      if (was !== i) haptic("select");
      o.current.onDetent?.(i);
    };

    /** Spring (or, with reduced motion, a short ease) from where it is to `to`, starting at velocity v (px/s). */
    const animate = (to: number, v = 0, done?: () => void) => {
      cancelAnimationFrame(raf);
      if (reduced()) {
        const from = y, t0 = performance.now(), dur = 160;
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
          write(from + (to - from) * e);
          if (k < 1) raf = requestAnimationFrame(step); else done?.();
        };
        raf = requestAnimationFrame(step);
        return;
      }
      let x = y, vel = v, last = performance.now();
      const step = (t: number) => {
        const dt = Math.min(0.032, (t - last) / 1000); last = t;
        // Two half-steps per frame keep the stiff spring stable at 60 Hz.
        for (let i = 0; i < 2; i++) {
          const a = (-STIFFNESS * (x - to) - DAMPING * vel) / MASS;
          vel += a * (dt / 2); x += vel * (dt / 2);
        }
        write(x);
        if (Math.abs(vel) < 4 && Math.abs(x - to) < 0.5) { write(to); done?.(); return; }
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const snapTo = (i: number, v = 0) => { const n = Math.max(0, Math.min(o.current.detents.length - 1, i)); animate(yOf(n), v); settled(n); };
    const dismiss = (v = 0) => {
      if (closing) return;
      closing = true;
      animate(height + 24, Math.max(v, 0), () => o.current.onDismissed());
    };
    handle.current = { snapTo: (i) => snapTo(i), dismiss: () => dismiss(), index: () => index };

    /** Where a release settles: the detent nearest the projected throw, or away. */
    const release = (vy: number /* px/ms */) => {
      const projected = y + vy * PROJECT_MS;
      const lowest = yOf(0);
      if ((vy > FLING && y >= lowest - 40) || projected > lowest + (height - lowest) * 0.45) { dismiss(vy * 1000); return; }
      let best = 0;
      o.current.detents.forEach((_, i) => { if (Math.abs(yOf(i) - projected) < Math.abs(yOf(best) - projected)) best = i; });
      snapTo(best, vy * 1000);
    };

    // ---- the drag, shared by the grabber (pointer) and the content (touch) ----
    let dragging = false, startY = 0, startT = 0;
    const samples: { t: number; y: number }[] = [];
    const begin = (clientY: number) => { cancelAnimationFrame(raf); dragging = true; startY = clientY; startT = y; samples.length = 0; samples.push({ t: performance.now(), y: clientY }); el.dataset.dragging = ""; };
    const move = (clientY: number) => {
      let next = startT + (clientY - startY);
      // Past the full sheet it resists, as UIKit's rubber band does.
      if (next < 0) next = next * 0.25;
      write(next);
      samples.push({ t: performance.now(), y: clientY });
      while (samples.length > 2 && samples[samples.length - 1].t - samples[0].t > 90) samples.shift();
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      delete el.dataset.dragging;
      const a = samples[0], b = samples[samples.length - 1];
      const vy = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      release(vy);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
      grip.setPointerCapture(e.pointerId);
      begin(e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => { if (dragging && grip.hasPointerCapture(e.pointerId)) move(e.clientY); };
    const onPointerUp = (e: PointerEvent) => { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); end(); };
    grip.addEventListener("pointerdown", onPointerDown);
    grip.addEventListener("pointermove", onPointerMove);
    grip.addEventListener("pointerup", onPointerUp);
    grip.addEventListener("pointercancel", onPointerUp);

    // The content: below full it moves the sheet; at full it scrolls, and hands back to the sheet
    // when pulled down from its top. Decided once per touch, after SLOP.
    let touchY = 0, touchX = 0, mode: "undecided" | "drag" | "scroll" = "undecided";
    const full = () => index === o.current.detents.length - 1 && !dragging;
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length !== 1) return; touchY = e.touches[0].clientY; touchX = e.touches[0].clientX; mode = "undecided"; };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0], dy = t.clientY - touchY, dx = t.clientX - touchX;
      if (mode === "undecided") {
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
        if (Math.abs(dx) > Math.abs(dy)) { mode = "scroll"; return; } // a sideways swipe (a carousel) is left alone
        mode = !full() || (dy > 0 && content.scrollTop <= 0) ? "drag" : "scroll";
        if (mode === "drag") begin(t.clientY - dy);
      }
      if (mode === "drag") { e.preventDefault(); move(t.clientY); }
    };
    const onTouchEnd = () => { if (mode === "drag") end(); mode = "undecided"; };
    content.addEventListener("touchstart", onTouchStart, { passive: true });
    content.addEventListener("touchmove", onTouchMove, { passive: false });
    content.addEventListener("touchend", onTouchEnd);
    content.addEventListener("touchcancel", onTouchEnd);
    // A wheel or trackpad below full raises the sheet first; at full it scrolls the content.
    let wheelAt = 0;
    const onWheel = (e: WheelEvent) => {
      if (full() || Math.abs(e.deltaY) < 4) return;
      e.preventDefault();
      if (performance.now() - wheelAt < 350) return;
      wheelAt = performance.now();
      if (e.deltaY > 0) snapTo(index + 1); else if (index > 0) snapTo(index - 1);
    };
    content.addEventListener("wheel", onWheel, { passive: false });

    const onResize = () => { measure(); if (!dragging && !closing) { cancelAnimationFrame(raf); write(yOf(index)); settled(index); } };
    window.addEventListener("resize", onResize);

    // Open: from below the screen to the first detent.
    measure();
    write(height + 24);
    snapTo(index);

    return () => {
      cancelAnimationFrame(raf);
      grip.removeEventListener("pointerdown", onPointerDown);
      grip.removeEventListener("pointermove", onPointerMove);
      grip.removeEventListener("pointerup", onPointerUp);
      grip.removeEventListener("pointercancel", onPointerUp);
      content.removeEventListener("touchstart", onTouchStart);
      content.removeEventListener("touchmove", onTouchMove);
      content.removeEventListener("touchend", onTouchEnd);
      content.removeEventListener("touchcancel", onTouchEnd);
      content.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      handle.current = null;
    };
    // The sheet is set up once per mount (and again if it switches between sheet and panel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  return handle;
}

/** Whether the window is wide enough for a side panel instead of a bottom sheet (Bible Strong's web: 768px). */
export function useWide(min = 768): boolean {
  const query = `(min-width: ${min}px)`;
  return useSyncExternalStore(
    (on) => { if (typeof matchMedia !== "function") return () => undefined; const m = matchMedia(query); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => typeof matchMedia === "function" && matchMedia(query).matches,
    () => false,
  );
}
