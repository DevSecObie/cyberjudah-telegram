import { useEffect, useSyncExternalStore } from "react";

/**
 * The bottom bar follows the reading, as iOS's tab bar and Instagram's do: scrolling down into
 * content shrinks it to a small capsule with the current tab, so the page has the screen; a scroll
 * back up, the top or the end of a page, a new screen or a tap on the capsule brings it back.
 * Every scroller counts (the page, the Bible's own column), except sheets, drawers and anything
 * that only scrolls sideways.
 */
const DOWN = 28, UP = 14, EDGE = 24;
let mini = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => { if (mini === v) return; mini = v; for (const l of listeners) l(); };
export const expandBar = () => set(false);
const SIDEBAR = "(min-width: 900px)";
const subscribeMini = (listener: () => void) => {
  listeners.add(listener);
  const sidebar = matchMedia(SIDEBAR);
  const resize = () => { set(false); listener(); };
  sidebar.addEventListener("change", resize);
  return () => { listeners.delete(listener); sidebar.removeEventListener("change", resize); };
};
// The same rendered buttons stay directly clickable and keyboard reachable in the sidebar.
export const useBarMini = () => useSyncExternalStore(subscribeMini, () => mini && !matchMedia(SIDEBAR).matches, () => false);

export function useBarScroll(route: string) {
  useEffect(() => { set(false); }, [route]);
  useEffect(() => {
    const last = new WeakMap<Element, number>();
    let travel = 0, frame = 0, pending: Element | null = null, inputAt = -Infinity, previous: Element | null = null;
    const sidebar = matchMedia(SIDEBAR);
    const evaluate = () => {
      frame = 0;
      const el = pending; pending = null; if (!el) return;
      if (sidebar.matches) { travel = 0; set(false); return; }
      if (el !== previous) { travel = 0; previous = el; }
      const top = el.scrollTop;
      let before = last.get(el);
      last.set(el, top);
      // Restoring a route’s scroll position is not a reading gesture. Record its
      // baseline, but wait for actual input before minimizing the dock.
      if (performance.now() - inputAt > 1500) { travel = 0; return; }
      // A scroller seen for the first time: right after a touch, wheel or key it started at its
      // top; otherwise the app moved it (a chapter opening at its verse), which is not reading.
      if (before === undefined) before = 0;
      if (top === before) return;
      const room = el.scrollHeight - el.clientHeight;
      if (room <= EDGE * 2 || top <= EDGE || room - top <= EDGE) { travel = 0; set(false); return; }
      const dy = top - before;
      if ((dy > 0) !== (travel > 0)) travel = 0;
      travel += dy;
      if (travel >= DOWN) { travel = 0; set(true); }
      else if (travel <= -UP) { travel = 0; set(false); }
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      const el = t === document || t === window ? document.scrollingElement : t instanceof Element ? t : null;
      if (!el || el.closest("[data-sheet-open], .drawer, .tabs, [data-bar-ignore]")) return;
      pending = el;
      if (!frame) frame = requestAnimationFrame(evaluate);
    };
    // When the reader last touched, wheeled or pressed a key: a scroll soon after is theirs. (Only
    // the time: these listeners are passive, so the page may already have moved by now.)
    const seed = () => { inputAt = performance.now(); };
    if (document.scrollingElement) last.set(document.scrollingElement, document.scrollingElement.scrollTop);
    const seeds = ["touchstart", "touchmove", "wheel", "pointerdown", "keydown"] as const;
    for (const s of seeds) document.addEventListener(s, seed, { capture: true, passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      for (const s of seeds) document.removeEventListener(s, seed, { capture: true });
      document.removeEventListener("scroll", onScroll, { capture: true }); cancelAnimationFrame(frame);
    };
  }, [route]);
}
