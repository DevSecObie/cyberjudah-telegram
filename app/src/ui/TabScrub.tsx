import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { tabTitle, type Tab } from "@/lib/tabs";
import { TabIcon } from "@/screens/Tabs";
import { haptic } from "@/tg/sdk";

/**
 * Bible Strong's swipe along the bottom bar (app-switcher/BottomTabBar/useTabBarSwipeGesture and
 * TabPreviewCarousel): the open tabs as full-screen cards that follow the finger, a tick at each
 * tab passed, and on release the nearest tab, or the next one in the direction of a quick flick.
 */
const DRAG_SCALE = 1.5;
const VELOCITY_THRESHOLD = 800;
const GAP = 20;

/** Elastic resistance past either end (tabHelpers.rubberBand). */
export const rubberBand = (value: number, min: number, max: number, resistance = 0.3) =>
  value < min ? min - (min - value) * resistance : value > max ? max + (value - max) * resistance : value;

/** Where a released swipe settles: the nearest tab, or past the flick's direction when it is quick. */
export function swipeTarget(index: number, velocityX: number, count: number) {
  let target = Math.round(index);
  if (Math.abs(velocityX) > VELOCITY_THRESHOLD) target = velocityX < 0 ? Math.ceil(index) : Math.floor(index);
  return Math.max(0, Math.min(count - 1, target));
}

type Gesture = { x: number; y: number; start: number; index: number; snapped: number; active: boolean; failed: boolean; lastX: number; lastT: number; vx: number };

export function useTabScrub(tabs: Tab[], current: string, select: (id: string) => void) {
  const [shown, setShown] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  // Where the cards came to rest, kept while the carousel fades: a render then leaves them there.
  const settled = useRef(0);
  const offset = (index: number) => `translateX(${-index * (window.innerWidth + GAP)}px)`;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finish = (target: number) => {
    const t = track.current, l = layer.current;
    const id = tabs[target]?.id;
    settled.current = target;
    if (id) select(id);
    if (!t || !l) { setShown(false); return; }
    // The cards glide to the chosen tab (300 ms), then the carousel fades over the tab already behind it.
    const from = t.style.transform;
    t.style.transform = offset(target);
    t.animate([{ transform: from }, { transform: offset(target) }], { duration: reduced() ? 0 : 300, easing: "ease-out" }).finished
      .then(() => l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 0 : 200, delay: reduced() ? 0 : 150, fill: "forwards" }).finished)
      .catch(() => {})
      .finally(() => setShown(false));
  };

  return {
    begin(x: number, y: number) {
      const start = Math.max(0, tabs.findIndex((t) => t.id === current));
      gesture.current = { x, y, start, index: start, snapped: start, active: false, failed: false, lastX: x, lastT: performance.now(), vx: 0 };
    },
    /** Follows the finger; true once the swipe has started, so a press or a tap no longer counts. */
    move(x: number, y: number): boolean {
      const g = gesture.current;
      if (!g || g.failed) return false;
      const dx = x - g.x, dy = y - g.y, now = performance.now();
      if (!g.active) {
        // Bible Strong starts the swipe after 15 px across, and gives it up after 10 px up or down.
        if (Math.abs(dy) > 10) { g.failed = true; return false; }
        if (Math.abs(dx) < 15 || tabs.length <= 1) return false;
        g.active = true; setShown(true); haptic("tap");
      }
      if (now > g.lastT) { g.vx = ((x - g.lastX) / (now - g.lastT)) * 1000; g.lastX = x; g.lastT = now; }
      g.index = rubberBand(g.start + (-dx * DRAG_SCALE) / (window.innerWidth + GAP), 0, tabs.length - 1);
      if (track.current) track.current.style.transform = offset(g.index);
      const snapped = Math.round(g.index);
      if (snapped !== g.snapped && snapped >= 0 && snapped < tabs.length) { g.snapped = snapped; haptic("select"); }
      return true;
    },
    /** Settles a started swipe on its tab; false if there was none. */
    end(): boolean {
      const g = gesture.current; gesture.current = null;
      if (!g?.active) return false;
      finish(swipeTarget(g.index, g.vx, tabs.length));
      return true;
    },
    /** A cancelled swipe goes back to the tab it started on. */
    cancel() {
      const g = gesture.current; gesture.current = null;
      if (g?.active) finish(g.start);
    },
    layer: shown ? createPortal(
      <div ref={layer} className="tabscrub" aria-hidden="true">
        <div ref={track} className="tabscrub__track" style={{ transform: offset(gesture.current?.index ?? settled.current) }}>
          {tabs.map((t) => {
            return (
              <div key={t.id} className="tabscrub__card" data-tab-id={t.id}>
                <span className="tabscrub__icon"><TabIcon path={t.path} size={30} /></span>
                <b className="tabscrub__title">{tabTitle(t.path)}</b>
              </div>
            );
          })}
        </div>
      </div>,
      document.body,
    ) : null,
  };
}
