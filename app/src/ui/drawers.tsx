import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";

import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { HomeBody } from "@/screens/Home";
import { sheetOpened } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon } from "@/ui/ui";

/** History entries (by index) that a page was opened over from a drawer, and which drawer. */
const cameFrom = new Map<number, DrawerSide>();

// The menu loads with its first opening (the More screen's module, shared with /more).
const MoreBody = lazy(() => import("@/screens/More").then((m) => ({ default: m.MoreBody })));

/**
 * Bible Strong's Home and menu drawers (CompactAppSwitcherScreen): Home from the left, the menu
 * from the right, each min(95%, 450px) wide, pushing the current tab aside. A tap on the tab, a
 * swipe back, Telegram's back button or any link inside closes them.
 */
export function Drawers() {
  const side = useDrawer();
  const { pathname, search } = useLocation();
  const [shown, setShown] = useState<DrawerSide | null>(side);
  // Bible Strong 1dfaa0d keeps Home mounted after its first opening.
  const [hasOpenedHome, setHasOpenedHome] = useState(side === "home");
  const scrimSwipe = useSwipeClose(side ?? "home");
  // A navigation from inside a drawer (a link, a search) closes it. A screen correcting its own
  // address (the Bible settling /bible on its chapter) is a replace, and must not.
  const navType = useNavigationType();
  useEffect(() => {
    const idx: number = window.history.state?.idx ?? 0;
    if (navType === "PUSH") {
      // A page opened from a drawer remembers it: Back to the entry under it opens the drawer
      // again, as Bible Strong's drawer stays open under the page pushed over it.
      if (side) cameFrom.set(idx - 1, side); else cameFrom.delete(idx - 1);
    }
    if (navType === "POP" && cameFrom.has(idx)) { setDrawer(cameFrom.get(idx)!); cameFrom.delete(idx); return; }
    if (navType !== "REPLACE") setDrawer(null);
  }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (side) { setShown(side); if (side === "home") setHasOpenedHome(true); return sheetOpened(); }
    const t = window.setTimeout(() => setShown(null), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [side]);
  // The app slides aside with the drawer, as one row. The page is pinned where it was scrolled for
  // the slide (a moving page must not scroll under the finger) and given back, in place, after.
  const pinned = useRef<number | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (side) {
      if (pinned.current === null) { pinned.current = window.scrollY; root.style.setProperty("--drawer-y", `${-pinned.current}px`); root.dataset.drawerPin = ""; }
      root.dataset.drawer = side;
      return;
    }
    delete root.dataset.drawer;
    if (pinned.current === null) return;
    const t = window.setTimeout(() => { const y = pinned.current ?? 0; pinned.current = null; delete root.dataset.drawerPin; window.scrollTo(0, y); }, SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [side]);
  useEffect(() => {
    if (!side) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side]);
  return (
    <>
      <div className="drawer-scrim" data-open={side ? "" : undefined} data-side={side ?? undefined} onClick={() => setDrawer(null)} {...scrimSwipe} aria-hidden="true" />
      <Panel side="home" open={side === "home"}>
        {hasOpenedHome ? (
          <>
            <div className="drawer__scroll"><HomeBody drawer active={side === "home"} /></div>
            <div className="drawer__fade" aria-hidden="true" />
            <button type="button" className="drawer__x" aria-label="Close Home" title="Close Home" onClick={() => { haptic("select"); setDrawer(null); }}><Icon name="close" size={24} /></button>
          </>
        ) : null}
      </Panel>
      <Panel side="more" open={side === "more"}>
        {shown === "more" ? (
          <>
            <header className="drawer__head">
              <button type="button" className="drawer__back" aria-label="Close the menu" title="Close the menu" onClick={() => { haptic("select"); setDrawer(null); }}><Icon name="back" size={22} /></button>
              <h2>More</h2>
            </header>
            <div className="drawer__scroll"><Suspense fallback={null}><MoreBody /></Suspense></div>
          </>
        ) : null}
      </Panel>
    </>
  );
}

const SLIDE_MS = 380;

/** A horizontal swipe toward the drawer's own edge closes it, as Bible Strong's pan does. */
function useSwipeClose(side: DrawerSide) {
  // A touch swipe usually ends in pointercancel (the browser takes the pan to scroll the drawer),
  // so a touch is finished on touchend, which still comes; a sideways row it scrolled is not a swipe.
  const start = useRef<{ x: number; y: number; touch: boolean; row: HTMLElement | null; left: number } | null>(null);
  const swiped = useRef(false);
  const finish = (x: number, y: number) => {
    const s = start.current; start.current = null; if (!s || (s.row && s.row.scrollLeft !== s.left)) return;
    const dx = x - s.x, dy = y - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && (side === "home" ? dx < 0 : dx > 0)) { swiped.current = true; haptic("select"); setDrawer(null); }
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      // From any element, an icon's SVG included, to the nearest horizontally scrolling row.
      let el = e.target instanceof Element ? e.target : null;
      while (el && !(el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
      const row = el instanceof HTMLElement ? el : null;
      start.current = { x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", row, left: row?.scrollLeft ?? 0 }; swiped.current = false;
    },
    onPointerUp: (e: React.PointerEvent) => finish(e.clientX, e.clientY),
    onPointerCancel: () => { if (!start.current?.touch) start.current = null; },
    onTouchEnd: (e: React.TouchEvent) => { const t = e.changedTouches[0]; if (start.current?.touch && t) finish(t.clientX, t.clientY); },
    onTouchCancel: () => { start.current = null; },
    // A swipe that starts on a link (the day's verse fills much of Home) would become the
    // browser's own link drag, which cancels the pointer: the swipe never saw its end.
    onDragStart: (e: React.DragEvent) => { e.preventDefault(); },
    // The click that ends a swipe is not a tap on the link under it.
    onClickCapture: (e: React.MouseEvent) => { if (swiped.current) { swiped.current = false; e.preventDefault(); e.stopPropagation(); } },
  };
}

function Panel({ side, open, children }: { side: DrawerSide; open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const close = () => setDrawer(null);
    el.addEventListener("cj:close", close);
    return () => el.removeEventListener("cj:close", close);
  }, []);
  const swipe = useSwipeClose(side);
  return (
    <aside ref={ref} {...swipe} className={`drawer drawer--${side}`} data-open={open ? "" : undefined} data-sheet-open={open ? "" : undefined}
      role="dialog" aria-modal={open} aria-hidden={!open} aria-label={side === "home" ? "Home" : "More"} inert={!open}>
      {children}
    </aside>
  );
}
