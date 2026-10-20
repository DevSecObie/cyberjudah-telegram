import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { stoppingScroll } from "./fling";
import { Link, useLocation, useNavigate } from "react-router";
import { Cell, Chip as TgChip, Placeholder, Section as TgSection, SegmentedControl, Skeleton as TgSkeleton } from "@telegram-apps/telegram-ui";

import { toAppPath } from "@shared/links.mjs";
import { haptic } from "@/tg/sdk";
import { goBack, isRootPath, usePageActions } from "@/tg/hooks";
import { adjacentTab, askTabPath, bibleTabPath, searchTabPath, useTabs } from "@/lib/tabs";
import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { useReaderFullscreen } from "@/bible/session";
import { SwitcherBar } from "@/screens/Tabs";
import { NAV_ITEMS, navItem, useNav, type NavId } from "@/lib/nav";

import { Feather } from "@/bible/icons";
import { Icon, type IconName } from "./icons";
import { useSheetRoute } from "./sheetRoute";
import { moveTab } from "./tab-motion";
export { Icon, type IconName } from "./icons";

/**
 * Bible Strong's bottom bar (app-switcher/BottomTabBar): a flat full-width row of 48 px icon
 * buttons on the page colour with a line above it. Here the reader picks and orders the buttons
 * (lib/nav) and Menu ends the row. Search, the Bible and Ask go to their tab (or open one); the
 * tabs button shows how many are open and opens the switcher. A long press on the bar opens its
 * editor.
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
  // Bible Strong slides the bar down out of sight while the Bible is full screen.
  const hidden = useReaderFullscreen() && !drawer && current === "bible";
  const press = useRef<number | undefined>(undefined);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const long = useRef(false);
  const pointer = useRef<number | null>(null);
  const touchTarget = useRef<HTMLButtonElement | null>(null);
  const touchClick = useRef<HTMLButtonElement | null>(null);
  const order = buttonOrder(ids);
  const go = (to: string | (() => string), overview = false, toId = "") => {
    if (long.current) return;
    // The new tab slides in from its side of the bar, as Bible Strong's tab carousel does.
    const from = order.indexOf(current as NavId | "more"), at = order.indexOf(toId as NavId | "more");
    const dir = from < 0 || at < 0 || at === from ? 0 : at > from ? 1 : -1;
    haptic("select"); setDrawer(null);
    moveTab(() => {
      const target = typeof to === "function" ? to() : to;
      if (target === pathname) { window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); return false; }
      else navigate(target, { replace: true });
    }, overview ? "overview" : "slide", undefined, dir);
  };
  // Home and the menu are drawers, as in Bible Strong; the same button closes its own drawer.
  const toggle = (side: DrawerSide) => { if (long.current) return; haptic("select"); setDrawer(drawer === side ? null : side); };
  useEffect(() => () => { window.clearTimeout(press.current); }, []);
  const cancelPress = () => {
    window.clearTimeout(press.current);
    swipe.current = null; touchTarget.current = null; touchClick.current = null; pointer.current = null;
  };
  // A long press edits the bar; a horizontal swipe along it moves to the next or previous open tab
  // (Bible Strong's useTabBarSwipeGesture).
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || pointer.current !== null) return;
      // A finger that stops a moving page is not a tap on the bar (fling.ts): leave it to the
      // browser, which drops that click, so it neither opens a section nor starts a long press.
      if (e.pointerType === "touch" && stoppingScroll()) return;
      pointer.current = e.pointerId; touchClick.current = null;
      touchTarget.current = e.pointerType === "touch" ? (e.target as Element).closest<HTMLButtonElement>("button.tab") : null;
      long.current = false; swipe.current = { x: e.clientX, y: e.clientY };
      press.current = window.setTimeout(() => { long.current = true; haptic("heavy"); setDrawer(null); navigate("/settings/bar"); }, 600);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      const s = swipe.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) window.clearTimeout(press.current);
    },
    onPointerCancel: (e: React.PointerEvent) => { if (pointer.current === e.pointerId) cancelPress(); },
    onPointerUp: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      window.clearTimeout(press.current);
      const s = swipe.current; swipe.current = null; if (!s || long.current) return;
      // Finish stationary taps at touchend, where the compatibility click can be canceled.
      // Opening a drawer at pointerup can otherwise retarget that click to its new scrim.
      const target = touchTarget.current; touchTarget.current = null;
      if (target?.isConnected && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && (e.target as Element).closest("button.tab") === target) {
        touchClick.current = target; return;
      }
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      moveTab(() => {
        const to = adjacentTab(dx < 0 ? 1 : -1); if (!to) return false;
        long.current = true; window.setTimeout(() => { long.current = false; }, 50); haptic("select"); setDrawer(null); navigate(to, { replace: true });
      }, "slide", undefined, dx < 0 ? 1 : -1);
    },
    onPointerLeave: (e: React.PointerEvent) => { if (pointer.current === e.pointerId) cancelPress(); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  const bar = useRef<HTMLElement>(null);
  // Bible Strong's tab count grows and settles whenever a tab is opened or closed (useTabButtonPress):
  // 300 ms after, to 1.2 over 500 ms and back over 500 ms.
  const countBox = useRef<HTMLSpanElement>(null);
  const counted = useRef(false);
  useEffect(() => {
    if (!counted.current) { counted.current = true; return; }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = "cubic-bezier(0.455, 0.03, 0.515, 0.955)";
    countBox.current?.animate([{ transform: "scale(1)", easing: ease }, { transform: "scale(1.2)", easing: ease }, { transform: "scale(1)" }], { duration: 1000, delay: 300 });
  }, [tabs.length]);
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
  // While the switcher is open the bar becomes its controls, as in Bible Strong.
  if (pathname.startsWith("/tabs")) return <nav className="tabs tabs--switcher" aria-label="Tabs"><SwitcherBar /><button type="button" className="tab tab--search" aria-label="Search" title="Search" onClick={() => go(searchTabPath, false, "search")}><Feather name="search" size={23} raw /></button></nav>;
  const count = tabs.length > 100 ? ":)" : String(tabs.length);
  const glyph = (id: NavId | "more") => {
    if (id === "more") return <Feather name="more-horizontal" size={28} />;
    if (id === "home") return <Feather name="home" size={23} />;
    if (id === "search") return <Feather name="search" size={23} raw />;
    if (id === "bible") return <Feather name="book-open" size={23} />;
    const item = navItem(id);
    return item.icon === "count" ? <span ref={countBox} className="tab__count" style={{ ["--group" as string]: groupColor }} aria-hidden="true">{count}</span> : <Icon name={item.icon} size={23} />;
  };
  const label = (id: NavId | "more") => id === "more" ? "Menu" : id === "tabs" ? `${count} Tabs open` : navItem(id).label;
  const press1 = (id: NavId | "more") => id === "more" ? toggle("more") : id === "home" ? toggle("home") : go(() => navPath(id), id === "tabs", id);
  return (
    <nav ref={bar} className="tabs" aria-label="Sections" data-hidden={hidden ? "" : undefined} {...hold}>
      {order.map((id) => {
        const on = current === id;
        return <button key={id} type="button" className="tab" data-nav={id} data-on={on ? "" : undefined} aria-current={on ? "page" : undefined}
          aria-label={label(id)} title={label(id)} onClick={() => press1(id)}>{glyph(id)}</button>;
      })}
    </nav>
  );
}

/** Bible Strong's row: the reader's buttons in their order, Search among them (second, as Bible Strong has it, if left out), and Menu last. */
export function buttonOrder(ids: NavId[]): (NavId | "more")[] {
  const row: (NavId | "more")[] = ids.includes("search") ? [...ids] : [...ids.slice(0, 1), "search", ...ids.slice(1)];
  return [...row, "more"];
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
  const sheet = useSheetRoute();
  if (sheet) return <SheetScreen title={title} kicker={kicker} action={action} className={className} sheet={sheet}>{children}</SheetScreen>;
  return <PageScreen title={title} kicker={kicker} action={action} className={className}>{children}</PageScreen>;
}

/**
 * A screen in a route sheet, under Bible Strong's route Header (common/Header.tsx): 54 px, the
 * title in 14 px bold with the subtitle in 12 px grey under it, a back arrow only when the sheet
 * has a screen before this one, the screen's actions on the right, and a line under it.
 */
function SheetScreen({ title, kicker, action, children, className, sheet }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; sheet: { depth: number; back: () => void } }) {
  return (
    <div className={`screen screen--sheet${className ? ` ${className}` : ""}`}>
      {title ? <header className="sheet-head">
        {sheet.depth > 1 ? <button type="button" className="sheet-head__back" aria-label="Back" title="Back" onClick={sheet.back}><Icon name="back" size={20} /></button> : <span className="sheet-head__pad" />}
        <div className="sheet-head__titles"><h1>{title}</h1>{kicker ? <p>{kicker}</p> : null}</div>
        {action}
      </header> : null}
      {children}
    </div>
  );
}

/**
 * A page under Bible Strong's Header (common/Header.tsx): 54 px with a line under it, the ← in a
 * 54 px square on every page but the main places (the same Back as Telegram's), the title in 14 px
 * bold with the subtitle in 12 px grey under it, and the page's actions on the right.
 */
function PageScreen({ title, kicker, action, children, className }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const back = !isRootPath(useLocation().pathname);
  return (
    <main className={`screen${className ? ` ${className}` : ""}`}>
      {title ? <header className="head">{back ? <button type="button" className="head__back" aria-label="Back" title="Back" onClick={goBack}><Icon name="arrow-left" size={20} /></button> : null}<div className="head__titles"><h1 className="title">{title}</h1>{kicker ? <p className="kicker">{kicker}</p> : null}</div>{action}</header> : null}
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

/** width and height, when the image's size is known (a YouTube thumbnail), hold its box before it loads. */
export function Img({ src, eager, width, height }: { src: string; eager?: boolean; width?: number; height?: number }) {
  return <img src={src} alt="" width={width} height={height} loading={eager ? "eager" : "lazy"} decoding="async" onError={(e) => {
    // The rare video without a WebP thumbnail still has YouTube's JPEG.
    const jpeg = jpegThumb(e.currentTarget.src);
    if (jpeg) e.currentTarget.src = jpeg; else e.currentTarget.style.visibility = "hidden";
  }} />;
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

/**
 * Bible Strong's SearchInput (common/SearchInput.tsx): a 36 px pill on a 10% shade, the search
 * icon at 20 px, the text at 15 px with a grey placeholder, and a ✕ in a 36 px square while there
 * is text.
 */
export function SearchField({ value, onChange, onSubmit, placeholder, autoFocus, id, trailing }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; autoFocus?: boolean; id: string; trailing?: ReactNode }) {
  return (
    <form className="field bs-searchinput" role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); onSubmit?.(); }}>
      <Feather name="search" size={20} raw />
      <input id={id} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      {value ? <button type="button" className="bs-searchinput__clear" aria-label="Clear" title="Clear" onClick={() => onChange("")}><Feather name="x" size={20} /></button> : trailing}
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
/** YouTube's WebP thumbnail of a video: 320 x 180 (mqdefault), or 480 x 360 when big (hqdefault). */
export const thumbOf = (id: string, big = false) => `https://i.ytimg.com/vi_webp/${encodeURIComponent(id)}/${big ? "hqdefault" : "mqdefault"}.webp`;
export const THUMB = { width: 320, height: 180 }, THUMB_BIG = { width: 480, height: 360 };
/** The JPEG of a WebP YouTube thumbnail (every video has one), or null for any other image. */
export const jpegThumb = (src: string) => /^https:\/\/i\.ytimg\.com\/vi_webp\//.test(src) ? src.replace("/vi_webp/", "/vi/").replace(/\.webp$/, ".jpg") : null;
