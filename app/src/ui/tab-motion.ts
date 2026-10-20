import { clearOver, historyIdx, isOver, markOver } from "@/lib/over-page";
import { flushSync } from "react-dom";
import { currentTab } from "@/lib/tabs";

type Position = { page: number; reader?: number };
const positions = new Map<string, Position>();
const path = () => location.pathname + location.search;
const positionKey = () => `${currentTab()?.id ?? ""}:${path()}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const timing = (level: 1 | 3 | 4) => {
  const style = getComputedStyle(document.documentElement);
  return { duration: parseFloat(style.getPropertyValue(`--dur-${level}`)), easing: style.getPropertyValue("--ease-tab").trim() };
};
const card = (id = currentTab()?.id ?? "") => document.querySelector<HTMLElement>(`.tabcard[data-tab-id="${CSS.escape(id)}"]`);
let cancelMotion: (() => void) | undefined;
let cancelRestore: (() => void) | undefined;
const cancelPending = () => { cancelMotion?.(); cancelRestore?.(); };
window.addEventListener("popstate", cancelPending);
window.addEventListener("resize", cancelPending);
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", cancelPending);

/** Only viewport positions are retained in memory; no images or private screen content. */
export function rememberTabPosition() {
  if (document.querySelector(".switcher")) return;
  positions.delete(positionKey());
  positions.set(positionKey(), { page: scrollY, reader: document.querySelector(".bs-scroll")?.scrollTop });
  if (positions.size > 80) positions.delete(positions.keys().next().value!);
}

function restoreTabPosition() {
  cancelRestore?.();
  const key = positionKey(), saved = positions.get(key);
  if (!saved) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
  let stopped = false;
  const apply = () => {
    if (stopped || positionKey() !== key) return;
    window.scrollTo({ top: saved.page, behavior: "instant" });
    const reader = document.querySelector(".bs-scroll");
    if (reader && saved.reader !== undefined) reader.scrollTop = saved.reader;
  };
  const observer = new MutationObserver(apply);
  const stop = () => {
    stopped = true; observer.disconnect(); clearTimeout(timer);
    for (const event of ["pointerdown", "wheel", "keydown"]) window.removeEventListener(event, stop, true);
    if (cancelRestore === stop) cancelRestore = undefined;
  };
  const timer = window.setTimeout(stop, 800);
  for (const event of ["pointerdown", "wheel", "keydown"]) window.addEventListener(event, stop, { capture: true, once: true });
  observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
  cancelRestore = stop;
  apply(); requestAnimationFrame(() => { apply(); requestAnimationFrame(apply); });
}

/** BrowserRouter schedules its React update separately from its synchronous history change. */
function routeCommitted() {
  const key = history.state?.key;
  const ready = () => {
    const route = document.querySelector<HTMLElement>(".route");
    return route !== null && route.dataset.locationKey === key && !route.querySelector(".route-loading");
  };
  if (!key || ready()) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const observer = new MutationObserver(() => { if (ready()) finish(); });
    const timer = window.setTimeout(finish, 1000);
    observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-location-key"] });
  });
}

type Mode = "overview" | "expand" | "slide";

/** Bible Strong's card expand and collapse (useTabAnimations): 500 ms on this curve. */
const EXPAND = { duration: 500, easing: "cubic-bezier(0.36, 0.77, 0.44, 1)" };
/** Reanimated's withTiming default: 300 ms, ease in-out quad. */
const TIMING = { duration: 300, easing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)" };
type Box = { x: number; y: number; width: number; height: number };
const screen = (): Box => ({ x: 0, y: 0, width: innerWidth, height: innerHeight });
const frame = (b: Box) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.width}px`, height: `${b.height}px` });

/** A copy of a card (Bible Strong's TabPreview box), fixed under the bar, that resizes: its icon disc stays 80 px and centred. */
function cardGhost(el: HTMLElement, at: Box) {
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-tab-id"); ghost.removeAttribute("data-current");
  ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
  Object.assign(ghost.style, { position: "fixed", margin: "0", zIndex: "calc(var(--z-dock) - 1)", pointerEvents: "none", ...frame(at) });
  (document.getElementById("root") ?? document.body).append(ghost);
  return ghost;
}
/** The bar's row as it is, held in place over the bar (a see-through copy of it), to leave as the other comes (useBottomTabBar). */
function barGhost() {
  const nav = document.querySelector<HTMLElement>("nav.tabs");
  if (!nav?.querySelector(".tabs__row, .switcherbar")) return null;
  const ghost = nav.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-hidden"); ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
  Object.assign(ghost.style, { background: "transparent", borderTopColor: "transparent", zIndex: "calc(var(--z-dock) + 1)", pointerEvents: "none" });
  (document.getElementById("root") ?? document.body).append(ghost);
  return ghost;
}
/** The bar's rows swap in 300 ms: going to the switcher the old rises 30 px and fades as the new rises in; coming back, the reverse. */
function swapBar(old: HTMLElement | null, up: boolean) {
  const fresh = document.querySelector<HTMLElement>("nav.tabs:not([aria-hidden]) > .tabs__row, nav.tabs:not([aria-hidden]) > .switcherbar");
  const leaving = old?.querySelector<HTMLElement>(".tabs__row, .switcherbar");
  const dy = up ? 30 : -30;
  if (old && leaving) leaving.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${-dy}px)`, opacity: 0 }], { ...TIMING, fill: "forwards" }).finished.catch(() => {}).finally(() => old.remove());
  else old?.remove();
  fresh?.animate([{ transform: `translateY(${dy}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], TIMING);
}

/**
 * Bible Strong's minimize and expand (useTabAnimations), and the tab slide:
 * - To the switcher, the tab's live content goes at once and its card, at full screen, resizes
 *   into its place in the grid over 500 ms while its title bar and ✕ fade in.
 * - To a tab, the card resizes to full screen as its title bar and ✕ fade out, then the tab
 *   fades in over 300 ms.
 * - Under reduced motion it is immediate, as Reanimated's animations are.
 * dir: for a slide, the side the new tab comes from (1 from the right, -1 from the left, 0 rising in place).
 */
export function moveTab(update: () => void | false, mode: Mode, id = currentTab()?.id ?? "", dir = 0) {
  cancelMotion?.(); cancelRestore?.();
  // Going to a tab leaves any page that was over the workspace (put back if nothing moves).
  const overIdx = historyIdx(), wasOver = isOver(overIdx);
  clearOver(overIdx);
  rememberTabPosition();
  const root = document.documentElement;
  let canceled = false;
  const running: Animation[] = [];
  const cleanups: (() => void)[] = [];
  const clean = () => {
    if (cancelMotion !== cancel) return;
    for (const c of cleanups.splice(0)) c();
    delete root.dataset.tabMotion;
    cancelMotion = undefined;
  };
  const cancel = () => { canceled = true; for (const a of running.splice(0)) a.cancel(); clean(); };
  cancelMotion = cancel;
  root.dataset.tabMotion = mode;
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => { const a = el.animate(frames, options); running.push(a); return a.finished.catch(() => {}); };
  const commit = async () => {
    let changed = true;
    flushSync(() => { changed = update() !== false; });
    if (!changed) { if (wasOver) markOver(overIdx); return false; }
    await routeCommitted();
    if (canceled) return false;
    const route = document.querySelector<HTMLElement>(".route");
    if (route) route.dataset.tabAnimated = "";
    if (mode === "overview") {
      // The grid is already where Bible Strong keeps it: the active card 200 px from the top.
      const el = card(id), page = el?.closest<HTMLElement>(".switcher__page");
      if (el && page) page.scrollTop = Math.max(0, el.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop - 200);
    } else restoreTabPosition();
    return true;
  };
  const still = reduced();
  if (mode === "slide") {
    void commit().then((done) => {
      const target = document.querySelector<HTMLElement>(".route");
      if (!done || still || !target) { clean(); return; }
      void animate(target, [{ opacity: 0, transform: dir ? `translateX(${dir * 24}px)` : "translateY(12px) scale(.985)" }, { opacity: 1, transform: "none" }], timing(4)).then(clean);
    });
    return;
  }
  if (still) { void commit().then(clean); return; }
  const bar = barGhost();
  if (bar) cleanups.push(() => bar.remove());
  if (mode === "overview") {
    void commit().then(async (done) => {
      const el = card(id);
      if (!done || !el) { bar?.remove(); clean(); return; }
      swapBar(bar, true);
      const r = el.getBoundingClientRect(), ghost = cardGhost(el, screen());
      el.style.visibility = "hidden";
      cleanups.push(() => { ghost.remove(); el.style.removeProperty("visibility"); });
      const chrome = ghost.querySelectorAll(".tabcard__title, .tabcard__close");
      chrome.forEach((c) => void animate(c, [{ opacity: 0 }, { opacity: 1 }], EXPAND));
      await animate(ghost, [frame(screen()), frame(r)], EXPAND);
      clean();
    });
    return;
  }
  // expand: the card grows from where it is, then the tab fades in.
  const el = card(id), from = el?.getBoundingClientRect();
  const ghost = el && from?.width ? cardGhost(el, from) : null;
  if (ghost) cleanups.push(() => ghost.remove());
  void commit().then(async (done) => {
    if (!done) { clean(); return; }
    swapBar(bar, false);
    const route = document.querySelector<HTMLElement>(".route");
    if (!ghost || !from) { clean(); return; }
    if (route) { route.style.opacity = "0"; cleanups.push(() => route.style.removeProperty("opacity")); }
    ghost.querySelectorAll(".tabcard__title, .tabcard__close").forEach((c) => void animate(c, [{ opacity: 1 }, { opacity: 0 }], { ...EXPAND, fill: "forwards" }));
    await animate(ghost, [frame(from), frame(screen())], { ...EXPAND, fill: "forwards" });
    if (canceled) return;
    // Two frames, then the tab fades in under the full-size card, which goes once it has.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    ghost.remove();
    if (route) { route.style.removeProperty("opacity"); await animate(route, [{ opacity: 0 }, { opacity: 1 }], TIMING); }
    clean();
  });
}

/** Retained cards settle into their new places when a neighboring tab closes. */
/** Reanimated's LinearTransition and ZoomOut defaults: 300 ms, ease in-out quad. */
const LAYOUT = { duration: 300, easing: "cubic-bezier(0.455, 0.03, 0.515, 0.955)" };
export function reflowTabs(update: () => void) {
  const motionTiming = LAYOUT;
  const before = new Map([...document.querySelectorAll<HTMLElement>(".tabcard")].map(el => [el.dataset.tabId, el.getBoundingClientRect()]));
  flushSync(update);
  if (reduced()) return;
  for (const el of document.querySelectorAll<HTMLElement>(".tabcard")) {
    const old = before.get(el.dataset.tabId); if (!old) continue;
    const next = el.getBoundingClientRect(), x = old.x - next.x, y = old.y - next.y;
    if (x || y) el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], motionTiming);
  }
}

/**
 * Bible Strong's closing card (TabPreview, useTabPreview): it shrinks away about its centre
 * (ZoomOut) while the others slide into their new places (LinearTransition).
 */
export function closeTabCard(id: string, update: () => void) {
  const el = document.querySelector<HTMLElement>(`.tabcard[data-tab-id="${CSS.escape(id)}"]`);
  const ghost = el && !reduced() ? (el.cloneNode(true) as HTMLElement) : null;
  if (el && ghost) {
    const r = el.getBoundingClientRect();
    ghost.removeAttribute("data-tab-id"); ghost.removeAttribute("data-current");
    ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
    // The pager's translated track is the containing block of a fixed element inside it.
    const box = el.closest<HTMLElement>(".switcher__track")?.getBoundingClientRect() ?? { left: 0, top: 0 };
    Object.assign(ghost.style, { position: "fixed", left: `${r.left - box.left}px`, top: `${r.top - box.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", zIndex: "2", pointerEvents: "none" });
    el.parentElement!.append(ghost);
    ghost.animate([{ transform: "scale(1)" }, { transform: "scale(0)" }], { ...LAYOUT, fill: "forwards" }).finished.catch(() => {}).finally(() => ghost.remove());
  }
  reflowTabs(update);
}
