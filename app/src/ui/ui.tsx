import { Children, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Cell, Chip as TgChip, Input, Placeholder, Section as TgSection, SegmentedControl, Skeleton as TgSkeleton } from "@telegram-apps/telegram-ui";

import { toAppPath } from "@shared/links.mjs";
import { haptic } from "@/tg/sdk";
import { usePageActions } from "@/tg/hooks";
import { adjacentTab, askTabPath, bibleTabPath, searchTabPath, useTabs } from "@/lib/tabs";
import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { expandBar, useBarMini, useBarScroll } from "@/lib/barscroll";
import { SwitcherBar } from "@/screens/Tabs";
import { NAV_ITEMS, navItem, useNav, type NavId } from "@/lib/nav";

import { Icon, type IconName } from "./icons";
export { Icon, type IconName } from "./icons";

/**
 * Bible Strong's bottom bar (app-switcher/BottomTabBar): a full-width row of icons, 48 high, no
 * labels. Here the reader picks and orders the buttons (lib/nav); Menu and then Search end the row.
 * Search, the Bible and Ask go to their tab (or open one); the tabs button shows how many are
 * open and opens the switcher. A long press on the bar opens its editor.
 */
export function tabOf(path: string): string {
  if (path.startsWith("/more") || path.startsWith("/settings")) return "more";
  return NAV_ITEMS.find((i) => i.match.test(path))?.id ?? "";
}

const navPath = (id: NavId) => id === "search" ? searchTabPath() : id === "bible" ? bibleTabPath() : id === "ask" ? askTabPath() : navItem(id).path;

export function TabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { tabs, group, groups } = useTabs();
  const [ids] = useNav();
  // The count takes its group's colour, as Bible Strong's does; the default group stays plain.
  const groupColor = groups.indexOf(group) > 0 ? group.color : undefined;
  const drawer = useDrawer();
  const current = drawer ?? tabOf(pathname);
  const press = useRef<number | undefined>(undefined);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const long = useRef(false);
  const go = (to: string) => { if (long.current) return; haptic("select"); setDrawer(null); if (to === pathname) window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); else navigate(to, { replace: true }); };
  // Home and the menu are drawers, as in Bible Strong; the same button closes its own drawer.
  const toggle = (side: DrawerSide) => { if (long.current) return; haptic("select"); setDrawer(drawer === side ? null : side); };
  // A long press edits the bar; a horizontal swipe along it moves to the next or previous open tab
  // (Bible Strong's useTabBarSwipeGesture).
  //
  // The selection responds to a press and follows a drag. Keep the material behind the labels:
  // distorting the text through a second lens makes navigation harder to read on Chromium and
  // cannot be rendered by Safari. The same interaction runs on every browser.
  const lens = useRef<{ x0: number; y0: number; px: number; py: number; t: number; at: number; moved: boolean; col: boolean; tabs: { el: HTMLElement; start: number; size: number }[] } | null>(null);
  const eatClick = useRef(false);
  const pointer = useRef<number | null>(null);
  const touchTarget = useRef<HTMLButtonElement | null>(null);
  const touchClick = useRef<HTMLButtonElement | null>(null);
  const placePill = useRef<(() => void) | null>(null);
  useEffect(() => () => { window.clearTimeout(press.current); }, []);
  const tabsOf = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLElement>(".tab")].filter((b) => b.offsetWidth > 0);
  const geometryOf = (nav: HTMLElement, el: HTMLElement) => {
    const outer = nav.getBoundingClientRect(), box = el.getBoundingClientRect();
    return { x: box.left - outer.left - nav.clientLeft + nav.scrollLeft, y: box.top - outer.top - nav.clientTop + nav.scrollTop, width: box.width, height: box.height };
  };
  const lensMove = (e: React.PointerEvent) => {
    const L = lens.current, nav = bar.current; if (!L || !nav) return false;
    const d = L.col ? e.clientY - L.y0 : e.clientX - L.x0;
    if (!L.moved && Math.abs(d) < 6) return true;
    if (!L.moved) {
      L.moved = true; window.clearTimeout(press.current); nav.dataset.drag = "";
      // Capture only an actual drag. Capturing a tap here retargets its click to the nav and
      // prevents the selected button from opening its drawer or scrolling back to the top.
      try { nav.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    }
    const all = L.tabs, first = all[0], last = all[all.length - 1];
    const lo = first.start, hi = last.start;
    // Past either end the lens gives a little and resists, like glass held by surface tension.
    let pos = (L.col ? L.py : L.px) + d;
    if (pos < lo) pos = lo - Math.sqrt(lo - pos) * 2; else if (pos > hi) pos = hi + Math.sqrt(pos - hi) * 2;
    nav.style.setProperty(L.col ? "--pill-y" : "--pill-x", `${pos}px`);
    // It stretches along its path with speed and thins across it.
    const now = performance.now(), v = Math.abs(pos - L.at) / Math.max(8, now - L.t);
    L.at = pos; L.t = now;
    const k = Math.min(.08, v * .08);
    nav.style.setProperty("--pill-sx", String(L.col ? 1 - k * .6 : 1 + k));
    nav.style.setProperty("--pill-sy", String(L.col ? 1 + k : 1 - k * .6));
    // The icons under the lens swell; the nearest one is where it will land.
    const size = first.size, mid = pos + size / 2;
    let near = 0, best = Infinity;
    all.forEach((b, i) => {
      const dist = Math.abs(b.start + b.size / 2 - mid);
      b.el.style.setProperty("--mag", String(1 + .06 * Math.max(0, 1 - dist / size)));
      if (dist < best) { best = dist; near = i; }
    });
    if (nav.dataset.near !== String(near)) { if (nav.dataset.near !== undefined) haptic("select"); nav.dataset.near = String(near); }
    return true;
  };
  const lensEnd = (open: boolean, suppressClick = true) => {
    const L = lens.current, nav = bar.current; lens.current = null; if (!L || !nav) return;
    const all = tabsOf(nav), near = Number(nav.dataset.near ?? -1);
    for (const b of all) b.style.removeProperty("--mag");
    nav.style.removeProperty("--pill-sx"); nav.style.removeProperty("--pill-sy");
    delete nav.dataset.drag; delete nav.dataset.near; delete nav.dataset.lift;
    placePill.current?.();
    if (!L.moved) return;
    // The click the browser sends at the end of the drag is the drag's, not a tap: swallow that one.
    eatClick.current = suppressClick;
    const it = open && near >= 0 ? items.find(it => it.id === L.tabs[near]?.el.dataset.nav) : null;
    // Opening the section moves the pill there; otherwise it springs back to where it was.
    if (it && current !== it.id) { long.current = false; it.onClick(); }
    const pill = nav.querySelector<HTMLElement>(".tabs__pill");
    if (pill && !matchMedia("(prefers-reduced-motion: reduce)").matches) pill.dataset.flow = "";
  };
  const cancelPress = () => {
    window.clearTimeout(press.current);
    swipe.current = null; touchTarget.current = null; touchClick.current = null;
    lensEnd(false, false);
    const id = pointer.current; pointer.current = null;
    if (id !== null && bar.current?.hasPointerCapture(id)) bar.current.releasePointerCapture(id);
  };
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || pointer.current !== null) return;
      pointer.current = e.pointerId; touchClick.current = null;
      touchTarget.current = e.pointerType === "touch" ? (e.target as Element).closest<HTMLButtonElement>("button.tab") : null;
      long.current = false; eatClick.current = false; swipe.current = { x: e.clientX, y: e.clientY };
      press.current = window.setTimeout(() => { long.current = true; lensEnd(false, false); haptic("heavy"); setDrawer(null); navigate("/settings/bar"); }, 600);
      const nav = bar.current, on = (e.target as HTMLElement).closest<HTMLElement>(".tab[data-on]");
      const pill = nav?.querySelector<HTMLElement>(".tabs__pill");
      if (pill) delete pill.dataset.flow;
      // An overflowing rail belongs to native touch scrolling. Mouse dragging and the
      // non-scrolling dock keep their selection gesture; taps and long presses still work.
      if (nav && on && !mini && !(nav.hasAttribute("data-scrollable") && e.pointerType !== "mouse")) {
        const col = getComputedStyle(nav).flexDirection === "column";
        // Read all gesture geometry before pointer-move feedback begins.
        const geometry = tabsOf(nav).map(el => { const b = geometryOf(nav, el); return { el, start: col ? b.y : b.x, size: col ? b.height : b.width }; });
        const selected = geometryOf(nav, on);
        lens.current = { x0: e.clientX, y0: e.clientY, px: selected.x, py: selected.y, t: performance.now(), at: col ? selected.y : selected.x, moved: false, col, tabs: geometry };
        nav.dataset.lift = ""; haptic("tap");
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      const s = swipe.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) window.clearTimeout(press.current);
      lensMove(e);
    },
    onPointerCancel: (e: React.PointerEvent) => { if (pointer.current === e.pointerId) cancelPress(); },
    onLostPointerCapture: (e: React.PointerEvent) => { if (e.target === e.currentTarget && pointer.current === e.pointerId && !bar.current?.hasPointerCapture(e.pointerId)) cancelPress(); },
    onPointerUp: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      window.clearTimeout(press.current);
      if (lens.current?.moved) { swipe.current = null; touchTarget.current = null; lensEnd(!long.current); return; }
      if (lens.current) lensEnd(false, false);
      const s = swipe.current; swipe.current = null; if (!s || long.current) return;
      // Finish stationary taps at touchend, where the compatibility click can be canceled.
      // Opening a drawer at pointerup can otherwise retarget that click to its new scrim.
      const target = touchTarget.current; touchTarget.current = null;
      if (target?.isConnected && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && (e.target as Element).closest("button.tab") === target) {
        touchClick.current = target; return;
      }
      if (bar.current?.hasAttribute("data-scrollable")) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const to = adjacentTab(dx < 0 ? 1 : -1);
      if (to) { long.current = true; window.setTimeout(() => { long.current = false; }, 50); haptic("select"); setDrawer(null); navigate(to, { replace: true }); }
    },
    onPointerLeave: (e: React.PointerEvent) => { if (pointer.current === e.pointerId && !bar.current?.hasPointerCapture(e.pointerId)) cancelPress(); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  // The bar follows the reading: a small capsule while scrolling down, the full bar otherwise.
  useBarScroll(pathname);
  // Ask keeps the full bar: its composer sits on it, as a chat app keeps its input in place.
  const mini = useBarMini() && !drawer && pathname !== "/ask";
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = bar.current; if (!nav) return;
    const finishTouch = (event: TouchEvent) => {
      const target = touchClick.current; touchClick.current = null;
      if (!target?.isConnected || !event.cancelable || event.touches.length) return;
      // Only a completed button tap cancels the compatibility mouse events. Native pans
      // keep their touchend, and mouse/keyboard activation follows its normal click path.
      event.preventDefault(); target.click();
    };
    nav.addEventListener("touchend", finishTouch, { passive: false });
    return () => { touchClick.current = null; nav.removeEventListener("touchend", finishTouch); };
  }, [pathname]);
  useLayoutEffect(() => {
    const nav = bar.current, on = nav?.querySelector<HTMLElement>(".tabs__main .tab[data-on]");
    const group = nav?.querySelector<HTMLElement>(".tabs__main");
    if (on && group && getComputedStyle(group).display !== "contents") {
      const item = on.getBoundingClientRect(), bounds = group.getBoundingClientRect();
      if (item.left < bounds.left) group.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) group.scrollLeft += item.right - bounds.right;
    }
  }, [current, mini, ids.join()]);
  // The current section sits on a pill that slides to it (across the dock on phones, down the
  // rail on desktops). Every section keeps its slot, so only the pill moves.
  useLayoutEffect(() => {
    const nav = bar.current; if (!nav) return;
    const place = () => {
      if (lens.current) return; // A data refresh or resize must not pull a held selection away.
      const on = nav.querySelector<HTMLElement>(".tab[data-on]");
      const style = getComputedStyle(nav), last = tabsOf(nav).at(-1), group = nav.querySelector<HTMLElement>(".tabs__main");
      const selected = on ? geometryOf(nav, on) : null, end = last ? geometryOf(nav, last) : null;
      const groupBounds = group?.getBoundingClientRect(), onBounds = on?.getBoundingClientRect();
      const clipped = style.flexDirection !== "column" && on?.parentElement === group && groupBounds && onBounds && (onBounds.left < groupBounds.left - 1 || onBounds.right > groupBounds.right + 1);
      const shown = !!on && on.offsetWidth > 0 && !clipped;
      // Measure the controls, not scrollHeight: the material itself spans this height and
      // must not keep an old overflow measurement alive after the viewport grows.
      const contentHeight = end ? end.y + end.height + parseFloat(style.paddingBottom) : 0;
      const scrollable = style.flexDirection === "column" ? contentHeight > nav.clientHeight + 1 : !!group && group.scrollWidth > group.clientWidth + 1;
      // Translation and a release highlight settle independently, without forcing layout.
      const x = `${shown ? selected!.x : 0}px`, y = `${shown ? selected!.y : 0}px`;
      const was = nav.style.getPropertyValue("--pill-x"), wasY = nav.style.getPropertyValue("--pill-y");
      const pill = nav.querySelector<HTMLElement>(".tabs__pill");
      if (pill && shown && was && (was !== x || wasY !== y) && !matchMedia("(prefers-reduced-motion: reduce)").matches) pill.dataset.flow = "";
      nav.style.setProperty("--pill-x", x);
      nav.style.setProperty("--pill-y", y);
      nav.style.setProperty("--pill-w", `${shown ? on!.offsetWidth : 0}px`);
      nav.style.setProperty("--pill-h", `${shown ? on!.offsetHeight : 0}px`);
      nav.dataset.pill = shown ? "" : "none";
      nav.toggleAttribute("data-scrollable", scrollable);
      nav.style.setProperty("--rail-content-h", `${contentHeight}px`);
    };
    placePill.current = place;
    place();
    const ro = new ResizeObserver(() => { if (lens.current) cancelPress(); place(); }); ro.observe(nav);
    for (const b of nav.querySelectorAll(".tab")) ro.observe(b);
    return () => { ro.disconnect(); placePill.current = null; };
  });
  // While the switcher is open the bar becomes its controls, as in Bible Strong.
  if (pathname.startsWith("/tabs")) return <nav className="tabs tabs--switcher" aria-label="Tabs"><SwitcherBar /><button type="button" className="tab tab--search" aria-label="Search" title="Search" onClick={() => go(searchTabPath())}><Icon name="search" size={22} /></button></nav>;
  const count = tabs.length > 100 ? ":)" : String(tabs.length);
  const items: { id: NavId | "more"; label: string; aria: string; glyph: ReactNode; onClick: () => void }[] = [
    ...ids.filter(id => id !== "search").map((id) => {
      const item = navItem(id);
      return { id, label: id === "tabs" ? "Tabs" : item.label, aria: id === "tabs" ? `Tabs, ${tabs.length} open` : item.label,
        glyph: item.icon === "count" ? <span key={count} className="tab__count" style={{ ["--group" as string]: groupColor }} aria-hidden="true">{count}</span> : <Icon name={item.icon} size={22} />,
        onClick: () => id === "home" ? toggle("home") : go(navPath(id)) };
    }),
    { id: "more", label: "Menu", aria: "Menu", glyph: <Icon name="more" size={24} />, onClick: () => toggle("more") },
    { id: "search", label: "Search", aria: "Search", glyph: <Icon name="search" size={22} />, onClick: () => go(searchTabPath()) },
  ];
  const button = (it: typeof items[number]) => {
    const on = current === it.id;
    const kept = mini && (on || (it.id === "more" && !items.some(x => x.id === current)));
    return <button key={it.id} type="button" className={`tab${it.id === "search" ? " tab--search" : ""}`} data-nav={it.id} data-on={on ? "" : undefined} data-kept={kept ? "" : undefined} aria-current={on ? "page" : undefined}
      aria-label={it.aria} title={it.aria} tabIndex={mini && !kept && it.id !== "search" ? -1 : undefined} onClick={it.onClick}>
      <span className="tab__glyph">{it.glyph}</span><span className="tab__label" aria-hidden="true">{it.label}</span>
    </button>;
  };
  return (
    <nav ref={bar} className="tabs" aria-label="Sections" data-mini={mini ? "" : undefined} data-search-current={current === "search" ? "" : undefined} {...hold}
      onClickCapture={(e) => { if (eatClick.current) { eatClick.current = false; if (e.detail > 0) { e.stopPropagation(); e.preventDefault(); return; } } if (mini) { expandBar(); if (!(e.target as HTMLElement).closest(".tab--search")) { e.stopPropagation(); e.preventDefault(); haptic("select"); } } }}>
      <span className="tabs__pill" aria-hidden="true" onAnimationEnd={(e) => { delete e.currentTarget.dataset.flow; }} />
      <div className="tabs__main" onScroll={() => placePill.current?.()}>{items.slice(0, -1).map(button)}</div>
      {button(items[items.length - 1])}
    </nav>
  );
}

/**
 * The screen's actions, as glass buttons floating just above the tab bar (see useBottomButtons):
 * the main one in the accent colour, a second one quiet beside it.
 */
export function PageActions() {
  const { main, secondary } = usePageActions();
  useEffect(() => {
    if (main || secondary) document.documentElement.dataset.actions = ""; else delete document.documentElement.dataset.actions;
    return () => { delete document.documentElement.dataset.actions; };
  }, [main, secondary]);
  if (!main && !secondary) return null;
  const button = (a: NonNullable<typeof main>, quiet: boolean) => (
    <button type="button" className={`btn ${quiet || a.quiet ? "btn--glass" : "btn--prominent"} pageaction${quiet || a.quiet ? " pageaction--quiet" : ""}`} disabled={a.disabled || a.progress} aria-busy={a.progress || undefined} onClick={a.onClick}>
      {a.progress ? <span className="pageaction__spin" aria-hidden="true" /> : null}{a.text}
    </button>
  );
  return <div className="pageactions" role="toolbar" aria-label="Actions">{secondary ? button(secondary, true) : null}{main ? button(main, false) : null}</div>;
}

export function Screen({ title, kicker, action, children, className }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <main className={`screen${className ? ` ${className}` : ""}`}>
      {title ? <header className="head"><div>{kicker ? <p className="kicker">{kicker}</p> : null}<h1 className="title">{title}</h1></div>{action}</header> : null}
      {children}
    </main>
  );
}

export function Section({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <section className="section">{title ? <div className="section__head"><h2>{title}</h2>{action}</div> : null}{children}</section>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <SegmentedControl className="seg" role="tablist" aria-label={label}>
      {options.map(([v, text]) => <SegmentedControl.Item key={v} role="tab" aria-selected={v === value} selected={v === value} onClick={() => { if (v !== value) { haptic("select"); onChange(v); } }}>{text}</SegmentedControl.Item>)}
    </SegmentedControl>
  );
}

export function Chips({ children }: { children: ReactNode }) { return <div className="chips">{children}</div>; }
export function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <TgChip Component="button" type="button" className="chip" mode={on ? "mono" : "outline"} aria-pressed={on} onClick={() => { haptic("select"); onClick(); }}>{children}</TgChip>;
}

/** Navigate to a site or app path, preferring the app's own screen. */
export function useGo() {
  const navigate = useNavigate();
  return (href: string, replace = false) => { const to = toAppPath(href); if (to) navigate(to, { replace }); };
}

export function Img({ src, eager }: { src: string; eager?: boolean }) {
  return <img src={src} alt="" loading={eager ? "eager" : "lazy"} decoding="async" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />;
}

/** A tappable list row: TelegramUI's Cell. `href` is a site or app path. */
export function Row({ href, onClick, title, sub, meta, thumb, trailing, icon, leading }: { href?: string; onClick?: () => void; title: ReactNode; sub?: ReactNode; meta?: ReactNode; thumb?: string; trailing?: ReactNode; icon?: IconName; leading?: ReactNode }) {
  const slots = {
    className: "row",
    multiline: true,
    before: leading ?? (thumb !== undefined ? <span className="row__thumb">{thumb ? <Img src={thumb} /> : null}</span> : icon ? <span className="row__icon"><Icon name={icon} size={20} /></span> : undefined),
    subhead: meta ? <span className="row__meta">{meta}</span> : undefined,
    subtitle: sub ? <span className="row__sub">{sub}</span> : undefined,
    after: trailing ?? <span className="row__chev"><Icon name="chevron" size={18} /></span>,
    children: <span className="row__title">{title}</span>,
  };
  if (href) return <Cell Component={Link} {...({ to: toAppPath(href) ?? href } as object)} onClick={() => haptic("select")} {...slots} />;
  return <Cell Component="button" type="button" onClick={() => { haptic("select"); onClick?.(); }} {...slots} />;
}

/** A grouped list: TelegramUI's Section body, a divider between rows. */
export function List({ children }: { children: ReactNode }) { return <TgSection className="list">{Children.toArray(children)}</TgSection>; }

/** Autosaved settings still form a named group, without an artificial submit action. */
export function FormSection({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return <fieldset className="section form-section" aria-label={title ? undefined : "Settings"}>
    {title ? <legend className="section__head form-section__legend"><h2>{title}</h2>{action}</legend> : null}
    {children}
  </fieldset>;
}

export function SearchField({ value, onChange, onSubmit, placeholder, autoFocus, id, trailing }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; autoFocus?: boolean; id: string; trailing?: ReactNode }) {
  return (
    <form className="field" role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); onSubmit?.(); }}>
      <Input id={id} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} aria-label={placeholder}
        before={<Icon name="search" size={18} />} after={value ? <button type="button" className="field__clear" aria-label="Clear" title="Clear" onClick={() => onChange("")}>×</button> : trailing} />
    </form>
  );
}

export function Skeleton({ rows = 6, thumb = false }: { rows?: number; thumb?: boolean }) {
  // Shaped like what arrives: a thumbnail card for feeds, a two-line row for lists.
  if (thumb) return (
    <div className="feed" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="feed__card feed__card--skel"><span className="feed__thumb skel" /><span className="feed__body"><span className="skel" style={{ width: `${62 + ((i * 17) % 30)}%`, height: 16 }} /><span className="skel" style={{ width: "44%", height: 12 }} /><span className="skel" style={{ width: "28%", height: 12 }} /></span></div>
      ))}
    </div>
  );
  return (
    <TgSection className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <TgSkeleton key={i} visible>
          <Cell className="row row--skel" multiline subtitle={<span className="skel" style={{ width: `${70 + ((i * 13) % 25)}%` }} />}><span className="skel" style={{ width: `${40 + ((i * 29) % 40)}%` }} /></Cell>
        </TgSkeleton>
      ))}
    </TgSection>
  );
}

/** Nothing here yet, and the next thing to do about it. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: { label: string; href?: string; onClick?: () => void } }) {
  return (
    <Placeholder className="empty" header={title} description={children} action={action ? (action.href ? <Link to={toAppPath(action.href) ?? action.href} className="empty__act" onClick={() => haptic("select")}>{action.label}</Link> : <button type="button" className="empty__act" onClick={() => { haptic("select"); action.onClick?.(); }}>{action.label}</button>) : undefined} />
  );
}

export { Button } from "./Button";

export function Card({ children, glow, href, onClick, className }: { children: ReactNode; glow?: boolean; href?: string; onClick?: () => void; className?: string }) {
  const cls = `card${glow ? " card--glow" : ""}${className ? ` ${className}` : ""}`;
  if (href) return <Link className={cls} to={toAppPath(href) ?? href} onClick={() => haptic("select")}>{children}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={() => { haptic("select"); onClick(); }}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export const timestamp = (s: number) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; };
export const youtube = (id: string, start = 0) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${start > 0 ? `&t=${Math.floor(start)}s` : ""}`;
export const thumbOf = (id: string, big = false) => `https://img.youtube.com/vi/${encodeURIComponent(id)}/${big ? "hqdefault" : "mqdefault"}.jpg`;
