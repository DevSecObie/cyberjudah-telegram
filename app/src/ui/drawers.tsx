import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";

import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { HomeBody } from "@/screens/Home";
import { MoreBody } from "@/screens/More";
import { sheetOpened } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon } from "@/ui/ui";

/**
 * Bible Strong's Home and menu drawers (CompactAppSwitcherScreen): Home from the left, the menu
 * from the right, each min(95%, 450px) wide, pushing the current tab aside. A tap on the tab, a
 * swipe back, Telegram's back button or any link inside closes them.
 */
export function Drawers() {
  const side = useDrawer();
  const { pathname, search } = useLocation();
  const [shown, setShown] = useState<DrawerSide | null>(side);
  const scrimSwipe = useSwipeClose(side ?? "home");
  // A navigation from inside a drawer (a link, a search) closes it. A screen correcting its own
  // address (the Bible settling /bible on its chapter) is a replace, and must not.
  const navType = useNavigationType();
  useEffect(() => { if (navType !== "REPLACE") setDrawer(null); }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (side) { setShown(side); return sheetOpened(); }
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
        {shown === "home" ? (
          <>
            <div className="drawer__scroll"><HomeBody drawer /></div>
            <div className="drawer__fade" aria-hidden="true" />
            <button type="button" className="drawer__x" aria-label="Close Home" onClick={() => { haptic("select"); setDrawer(null); }}><Icon name="close" size={24} /></button>
          </>
        ) : null}
      </Panel>
      <Panel side="more" open={side === "more"}>
        {shown === "more" ? (
          <>
            <header className="drawer__head">
              <button type="button" className="drawer__back" aria-label="Close the menu" onClick={() => { haptic("select"); setDrawer(null); }}><Icon name="back" size={22} /></button>
              <h2>More</h2>
            </header>
            <div className="drawer__scroll"><MoreBody /></div>
          </>
        ) : null}
      </Panel>
    </>
  );
}

const SLIDE_MS = 380;

/** A horizontal swipe toward the drawer's own edge closes it, as Bible Strong's pan does. */
function useSwipeClose(side: DrawerSide) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; start.current = null; if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && (side === "home" ? dx < 0 : dx > 0)) { haptic("select"); setDrawer(null); }
    },
    onPointerCancel: () => { start.current = null; },
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
