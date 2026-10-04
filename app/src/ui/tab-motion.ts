import { flushSync } from "react-dom";
import { currentTab } from "@/lib/tabs";

type Position = { page: number; reader?: number };
const positions = new Map<string, Position>();
const path = () => location.pathname + location.search;
const positionKey = () => `${currentTab().id}:${path()}`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const timing = (level: 1 | 3 | 4) => {
  const style = getComputedStyle(document.documentElement);
  return { duration: parseFloat(style.getPropertyValue(`--dur-${level}`)), easing: style.getPropertyValue("--ease-tab").trim() };
};
const card = (id = currentTab().id) => document.querySelector<HTMLElement>(`.tabcard[data-tab-id="${CSS.escape(id)}"]`);
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

/** Bible Strong's collapse/expand flow, using ephemeral browser snapshots where supported. */
export function moveTab(update: () => void | false, mode: Mode, id = currentTab().id) {
  cancelMotion?.(); cancelRestore?.();
  rememberTabPosition();
  const root = document.documentElement;
  const motionTiming = timing(reduced() ? 1 : 4);
  let canceled = false, usingFallback = false, changed: void | false;
  let commitPromise: Promise<void> | undefined;
  let transition: ViewTransition | undefined, animation: Animation | undefined;
  let geometry: HTMLStyleElement | undefined;
  const named = new Set<HTMLElement>();
  const name = (element: HTMLElement | null, value: string) => {
    if (!element) return;
    named.add(element); element.style.viewTransitionName = value;
  };
  const clearNames = () => { for (const element of named) element.style.removeProperty("view-transition-name"); named.clear(); };
  const clean = () => {
    if (cancelMotion !== cancel) return;
    clearNames(); delete root.dataset.tabMotion;
    geometry?.remove();
    cancelMotion = undefined;
  };
  const cancel = () => { canceled = true; transition?.skipTransition(); animation?.cancel(); clean(); };
  cancelMotion = cancel;
  root.dataset.tabMotion = mode;
  const commit = () => {
    if (canceled) return Promise.resolve();
    return commitPromise ??= (async () => {
      clearNames(); flushSync(() => { changed = update(); });
      if (changed === false) return;
      await routeCommitted();
      if (canceled) return;
      const route = document.querySelector<HTMLElement>(".route");
      if (route) route.dataset.tabAnimated = "";
      if (mode === "overview") {
        window.scrollTo({ top: 0, behavior: "instant" });
        card(id)?.scrollIntoView({ block: "nearest", behavior: "instant" });
      } else restoreTabPosition();
    })();
  };
  const fallback = () => {
    if (canceled) return;
    if (changed === false) { clean(); return; }
    const target = document.querySelector<HTMLElement>(mode === "overview" ? ".switcher__grid" : ".route");
    if (!target) { clean(); return; }
    animation = target.animate(
      reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: mode === "overview" ? "translateY(24px) scale(.97)" : "translateY(12px) scale(.985)" }, { opacity: 1, transform: "none" }],
      motionTiming,
    );
    void animation.finished.catch(() => {}).then(clean);
  };
  const fromElement = mode === "expand" ? card(id) : root;
  const from = fromElement === root ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : fromElement?.getBoundingClientRect();
  if (!document.startViewTransition || reduced() || !from || mode === "slide") {
    void commit().then(fallback); return;
  }
  name(fromElement, "tab-surface");
  name(document.querySelector("nav.tabs"), "tab-controls");
  try {
    transition = document.startViewTransition(async () => {
      await commit(); if (canceled) return;
      const next = mode === "overview" ? card(id) : root;
      const to = next === root ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : next?.getBoundingClientRect();
      if (!next || !to?.width || !to.height) return;
      name(next, "tab-surface"); name(document.querySelector("nav.tabs"), "tab-controls");
      // Geometry belongs to the snapshot alone. Inherited root variables invalidate the
      // entire reader/switcher subtree just as the browser is preparing its animation.
      geometry = document.createElement("style");
      geometry.textContent = `::view-transition-group(tab-surface) { --tab-from: translate(${from.x}px, ${from.y}px) scale(${from.width / to.width}, ${from.height / to.height}); --tab-to: translate(${to.x}px, ${to.y}px); }`;
      document.head.append(geometry);
    });
    void transition.ready.catch(() => { usingFallback = true; return commit().then(fallback); });
    void transition.finished.catch(() => {}).then(() => { if (!usingFallback) clean(); });
  } catch {
    clearNames(); void commit().then(fallback);
  }
}

/** Retained cards settle into their new places when a neighboring tab closes. */
export function reflowTabs(update: () => void) {
  const motionTiming = timing(3);
  const before = new Map([...document.querySelectorAll<HTMLElement>(".tabcard")].map(el => [el.dataset.tabId, el.getBoundingClientRect()]));
  flushSync(update);
  if (reduced()) return;
  for (const el of document.querySelectorAll<HTMLElement>(".tabcard")) {
    const old = before.get(el.dataset.tabId); if (!old) continue;
    const next = el.getBoundingClientRect(), x = old.x - next.x, y = old.y - next.y;
    if (x || y) el.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], motionTiming);
  }
}
