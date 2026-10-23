import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ElementType, type PointerEvent, type ReactNode } from "react";
import { stoppingScroll } from "./fling";
import { Link, useLocation, useNavigate } from "react-router";

import { toAppPath } from "@shared/links.mjs";
import { app, haptic } from "@/tg/sdk";
import { assetUrl } from "@/lib/asset";
import { goBack, isRootPath, usePageActions } from "@/tg/hooks";
import { askTabPath, bibleTabPath, classesTabPath, currentTab, kindTabIndex, searchTabPath, selectTab, settleTabFloor, useTabs } from "@/lib/tabs";
import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { useReaderFullscreen } from "@/bible/session";
import { contrastInk, SwitcherBar } from "@/screens/Tabs";
import { NAV_ITEMS } from "@/lib/nav";

import { Feather } from "@/bible/icons";
import { Icon, type IconName } from "./icons";
import { useSheetRoute } from "./sheetRoute";
import { moveTab } from "./tab-motion";
import { historyIdx, isOver } from "@/lib/over-page";
import { useAvailableUpdatesIndicator } from "@/resources/updates";
import { useTabScrub } from "./TabScrub";
export { Icon, type IconName } from "./icons";

/**
 * Bible Strong's bottom bar (app-switcher/BottomTabBar): a flat full-width row of 48 px icon
 * buttons on the page colour with a line above it: Home, Search, the Bible, the tabs and Menu,
 * with our Classes and Ask before the tabs. Search, the Bible, Classes and Ask go to their tab (or
 * open one); the tabs button shows how many are open and opens the switcher.
 */
export function tabOf(path: string): string {
  if (path.startsWith("/more") || path.startsWith("/settings")) return "more";
  return NAV_ITEMS.find((i) => i.match.test(path))?.id ?? "";
}

/** BottomTabBar's row: HomeButton, SearchButton, BibleButton, TabButton, MenuButton, with Classes and Ask before the tabs. */
const BUTTONS = ["home", "search", "bible", "classes", "ask", "tabs", "more"] as const;
type ButtonId = typeof BUTTONS[number];
const LABELS = { home: "Home", search: "Search", bible: "Bible", classes: "Classes", ask: "Ask" };

export function TabBar() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { tabs, current: currentTabId, group } = useTabs();
  const { hasUnseenUpdates } = useAvailableUpdatesIndicator();
  // The count takes its group's colour, as Bible Strong's does; the default group stays plain.
  const groupColor = group.isDefault ? undefined : group.color;
  const drawer = useDrawer();
  const current = drawer ?? tabOf(pathname);
  // Bible Strong slides the bar down out of sight while the Bible is full screen.
  const hidden = useReaderFullscreen() && !drawer && current === "bible";
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const long = useRef(false);
  const pointer = useRef<number | null>(null);
  const touchTarget = useRef<HTMLButtonElement | null>(null);
  const touchClick = useRef<HTMLButtonElement | null>(null);
  const go = (to: string | (() => string), overview = false, toId = "") => {
    if (long.current) return;
    // The tab slides in from its side, by its place in the group (Bible Strong's slideToIndex);
    // a button for the tab already showing does nothing.
    const from = tabs.findIndex((t) => t.id === currentTab()?.id);
    const at = toId === "search" || toId === "bible" || toId === "classes" || toId === "ask" ? kindTabIndex(toId) : from;
    const dir = from < 0 || at === from ? 0 : at > from ? 1 : -1;
    setDrawer(null);
    // A page over the tab is left for the tab even when its path is the same.
    const wasOver = isOver(historyIdx());
    moveTab(() => {
      const before = currentTab()?.id;
      const target = typeof to === "function" ? to() : to;
      // Another tab on the same page still starts its own Back here.
      if (target === pathname + search && !wasOver) { settleTabFloor(historyIdx(), currentTab()?.id !== before); return false; }
      navigate(target, { replace: true });
    }, overview ? "overview" : "slide", undefined, dir);
  };
  // Home and the menu are drawers, as in Bible Strong; the same button closes its own drawer.
  const toggle = (side: DrawerSide) => { if (long.current) return; setDrawer(drawer === side ? null : side); };
  // A swipe along the bar scrubs through the open tabs (Bible Strong's useTabBarSwipeGesture).
  // Settling on another tab leaves a page over the tab, as the buttons do; back on its own tab it stays.
  const scrub = useTabScrub(tabs, currentTabId, (id) => {
    setDrawer(null);
    if (id === currentTabId) return;
    moveTab(() => { navigate(selectTab(id), { replace: true }); }, "slide");
  });
  const cancelPress = () => {
    swipe.current = null; touchTarget.current = null; touchClick.current = null; pointer.current = null;
    // A swipe taken away leaves no press behind to swallow the next click.
    long.current = false; scrub.cancel();
  };
  // A horizontal swipe along the bar scrubs through the open tabs (Bible Strong's
  // useTabBarSwipeGesture). Bible Strong's bar has no long press.
  const hold = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || pointer.current !== null) return;
      // A finger that stops a moving page is not a tap on the bar (fling.ts): leave it to the
      // browser, which drops that click, so it does not open a section.
      if (e.pointerType === "touch" && stoppingScroll()) return;
      pointer.current = e.pointerId; touchClick.current = null;
      touchTarget.current = e.pointerType === "touch" ? (e.target as Element).closest<HTMLButtonElement>("button.tab") : null;
      long.current = false; swipe.current = { x: e.clientX, y: e.clientY }; scrub.begin(e.clientX, e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      // Once the swipe has started, the press is no longer a tap on the button it began on.
      // It keeps following the finger off the bar (captured only now, so a tap still reaches its button).
      if (scrub.move(e.clientX, e.clientY)) {
        long.current = true; touchTarget.current = null;
        const bar = e.currentTarget as Element;
        if (!bar.hasPointerCapture(e.pointerId)) bar.setPointerCapture(e.pointerId);
      }
    },
    onPointerCancel: (e: React.PointerEvent) => { if (pointer.current === e.pointerId) cancelPress(); },
    onPointerUp: (e: React.PointerEvent) => {
      if (pointer.current !== e.pointerId) return;
      pointer.current = null;
      const s = swipe.current; swipe.current = null;
      if (scrub.end()) { window.setTimeout(() => { long.current = false; }, 50); return; }
      if (!s || long.current) return;
      // Finish stationary taps at touchend, where the compatibility click can be canceled.
      // Opening a drawer at pointerup can otherwise retarget that click to its new scrim.
      const target = touchTarget.current; touchTarget.current = null;
      if (target?.isConnected && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && (e.target as Element).closest("button.tab") === target) {
        touchClick.current = target;
      }
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
  if (pathname.startsWith("/tabs")) return <nav className="tabs tabs--switcher" aria-label="Tabs"><SwitcherBar /></nav>;
  const count = tabs.length > 100 ? ":)" : String(tabs.length);
  const glyph = (id: ButtonId) => {
    if (id === "more") return <span className="tab__more"><Feather name="more-horizontal" size={28} />{hasUnseenUpdates ? <NotificationDot style={{ top: 2, right: -3 }} /> : null}</span>;
    if (id === "home") return <Feather name="home" size={23} />;
    if (id === "search") return <Feather name="search" size={23} raw />;
    if (id === "bible") return <Feather name="book-open" size={23} />;
    if (id === "classes") return <Feather name="play-circle" size={23} />;
    if (id === "ask") return <Feather name="message-circle" size={23} />;
    return <span ref={countBox} className="tab__count" style={groupColor ? { ["--group" as string]: groupColor, ["--group-ink" as string]: contrastInk(groupColor) } : undefined} aria-hidden="true">{count}</span>;
  };
  const label = (id: ButtonId) => id === "more" ? (hasUnseenUpdates ? "Main menu, updates available" : "Main menu") : id === "tabs" ? `Tabs, ${count} open` : LABELS[id];
  const path = (id: "search" | "bible" | "classes" | "ask" | "tabs") => id === "search" ? searchTabPath() : id === "bible" ? bibleTabPath() : id === "classes" ? classesTabPath() : id === "ask" ? askTabPath() : "/tabs";
  const press1 = (id: ButtonId) => id === "more" ? toggle("more") : id === "home" ? toggle("home") : go(() => path(id), id === "tabs", id);
  return (
    <>{scrub.layer}<nav ref={bar} className="tabs" aria-label="Sections" data-hidden={hidden ? "" : undefined} {...hold}>
      <div className="tabs__row">
        {BUTTONS.map((id) => <button key={id} type="button" className="tab" data-nav={id} aria-label={label(id)} title={label(id)} onClick={() => press1(id)}>{glyph(id)}</button>)}
      </div>
    </nav></>
  );
}

/** Bible Strong's NotificationDot: a small green dot signalling something new, outlined so it stays legible over an icon. */
export function NotificationDot({ size = 10, style }: { size?: number; style?: React.CSSProperties }) {
  return <span className="notify-dot" aria-hidden="true" style={{ width: size, height: size, ...style }} />;
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

export function Screen({ title, kicker, action, headerChildren, children, className }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; headerChildren?: ReactNode; children: ReactNode; className?: string }) {
  const sheet = useSheetRoute();
  if (sheet) return <SheetScreen title={title} kicker={kicker} action={action} headerChildren={headerChildren} className={className} sheet={sheet}>{children}</SheetScreen>;
  return <PageScreen title={title} kicker={kicker} action={action} headerChildren={headerChildren} className={className}>{children}</PageScreen>;
}

/**
 * A screen in a route sheet, under Bible Strong's route Header (common/Header.tsx): 54 px, the
 * title in 14 px bold with the subtitle in 12 px grey under it, a back arrow only when the sheet
 * has a screen before this one, the screen's actions on the right, and a line under it.
 */
function SheetScreen({ title, kicker, action, headerChildren, children, className, sheet }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; headerChildren?: ReactNode; children: ReactNode; className?: string; sheet: { depth: number; back: () => void } }) {
  const heading = <>
    {sheet.depth > 1 ? <button type="button" className="sheet-head__back" aria-label="Back" title="Back" onClick={sheet.back}><Icon name="back" size={20} /></button> : <span className="sheet-head__pad" />}
    <div className="sheet-head__titles"><h1>{title}</h1>{kicker ? <p>{kicker}</p> : null}</div>
    {action}
  </>;
  return (
    <div className={`screen screen--sheet${className ? ` ${className}` : ""}`}>
      {title ? <header className={`sheet-head${headerChildren ? " head--children" : ""}`}>{headerChildren ? <><div className="head__row">{heading}</div><div className="head__children">{headerChildren}</div></> : heading}</header> : null}
      {children}
    </div>
  );
}

/**
 * A page under Bible Strong's Header (common/Header.tsx): 54 px with a line under it, the ← in a
 * 54 px square on every page but the main places (the same Back as Telegram's), the title in 14 px
 * bold with the subtitle in 12 px grey under it, and the page's actions on the right.
 */
function PageScreen({ title, kicker, action, headerChildren, children, className }: { title?: ReactNode; kicker?: ReactNode; action?: ReactNode; headerChildren?: ReactNode; children: ReactNode; className?: string }) {
  const back = !isRootPath(useLocation().pathname);
  const heading = <>{back ? <button type="button" className="head__back" aria-label="Back" title="Back" onClick={goBack}><Icon name="arrow-left" size={20} /></button> : null}<div className="head__titles"><h1 className="title">{title}</h1>{kicker ? <p className="kicker">{kicker}</p> : null}</div>{action}</>;
  return (
    <main className={`screen${className ? ` ${className}` : ""}`}>
      {title ? <header className={`head${headerChildren ? " head--children" : ""}`}>{headerChildren ? <><div className="head__row">{heading}</div><div className="head__children">{headerChildren}</div></> : heading}</header> : null}
      {children}
    </main>
  );
}

export function Section({ title, action, children }: { title?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return <section className="section">{title ? <div className="section__head"><h2>{title}</h2>{action}</div> : null}{children}</section>;
}

/** The blocks below take Telegram's iOS look on iOS and macOS (blocks.css: the --ios classes) and the Android one elsewhere. */
const IOS = app?.platform === "ios" || app?.platform === "macos";
const has = (n: ReactNode) => n !== undefined && n !== null && n !== false && n !== "";

/** Press feedback: on iOS the target fades (blocks.css); elsewhere a wave spreads from the finger, 70 ms after it lands. */
function useTap() {
  const [waves, setWaves] = useState<{ x: number; y: number; at: number }[]>([]);
  const timers = useRef(new Map<number, number>());
  const clear = useRef(0);
  if (IOS) return { cls: "tap tap--ios", on: {}, ripple: null };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const { top, left } = e.currentTarget.getBoundingClientRect(), x = e.clientX - left, y = e.clientY - top, id = e.pointerId;
    timers.current.set(id, window.setTimeout(() => {
      const now = Date.now();
      setWaves((w) => [...w.filter((v) => v.at + 225 > now), { x, y, at: now }]);
      window.clearTimeout(clear.current); clear.current = window.setTimeout(() => setWaves([]), 225);
      timers.current.delete(id);
    }, 70));
  };
  const onPointerCancel = (e: PointerEvent<HTMLElement>) => { window.clearTimeout(timers.current.get(e.pointerId)); timers.current.delete(e.pointerId); };
  return { cls: "tap", on: { onPointerDown, onPointerCancel }, ripple: <span aria-hidden className="tap__ripple">{waves.map((w) => <span key={w.at} className="tap__wave" style={{ top: w.y, left: w.x }} />)}</span> };
}

/** One option of a segmented control: a tab. */
function Segment({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  const tap = useTap();
  return <button type="button" role="tab" aria-selected={selected} className={`${tap.cls} seg__item${IOS ? " seg__item--ios" : ""}`} {...tap.on} onClick={onClick}>{tap.ripple}<span>{children}</span></button>;
}

/** A segmented control: the options as tabs, the selection a thumb that slides under the chosen one. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  const at = options.findIndex(([v]) => v === value);
  return (
    <div role="tablist" className={`seg${IOS ? " seg--ios" : ""}`} aria-label={label}>
      <div className="seg__track">
        {at > -1 ? <div aria-hidden className="seg__thumb" style={{ width: `${100 / options.length}%`, transform: `translateX(${100 * at}%)` }} /> : null}
        {options.map(([v, text]) => <Segment key={v} selected={v === value} onClick={() => { if (v !== value) { haptic("select"); onChange(v); } }}>{text}</Segment>)}
      </div>
    </div>
  );
}

export function Chips({ children }: { children: ReactNode }) { return <div className="chips">{children}</div>; }
export function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="tap tap--fade chip chip--toggle" aria-pressed={on} onClick={() => { haptic("select"); onClick(); }}><span className="chip__label">{children}</span></button>;
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

/** A cell: what goes before, a subhead, the title and a subtitle stacked in the middle, and what goes after. */
function Cell({ as: As = "div", className, before, subhead, subtitle, after, children, ...rest }: { as?: ElementType; className: string; before?: ReactNode; subhead?: ReactNode; subtitle?: ReactNode; after?: ReactNode; children: ReactNode; to?: string; type?: "button"; onClick?: () => void }) {
  const tap = useTap();
  return (
    <As className={`${tap.cls} cell${IOS ? " cell--ios" : ""} ${className}`} {...tap.on} {...rest}>
      {tap.ripple}
      {has(before) ? <div className="cell__before">{before}</div> : null}
      <div className="cell__middle">
        {has(subhead) ? <span className="cell__subhead">{subhead}</span> : null}
        {has(children) ? <span className="cell__title"><span className="cell__text">{children}</span></span> : null}
        {has(subtitle) ? <span className="cell__subtitle">{subtitle}</span> : null}
      </div>
      {has(after) ? <div className="cell__after">{after}</div> : null}
    </As>
  );
}

/** A tappable list row. `href` is a site or app path. */
export function Row({ href, onClick, title, sub, meta, thumb, trailing, icon, leading }: { href?: string; onClick?: () => void; title: ReactNode; sub?: ReactNode; meta?: ReactNode; thumb?: string; trailing?: ReactNode; icon?: IconName; leading?: ReactNode }) {
  const slots = {
    className: "row",
    before: leading ?? (thumb !== undefined ? <span className="row__thumb">{thumb ? <Img src={thumb} /> : null}</span> : icon ? <span className="row__icon"><Icon name={icon} size={20} /></span> : undefined),
    subhead: meta ? <span className="row__meta">{meta}</span> : undefined,
    subtitle: sub ? <span className="row__sub">{sub}</span> : undefined,
    after: trailing ?? <span className="row__chev"><Icon name="chevron" size={18} /></span>,
    children: <span className="row__title">{title}</span>,
  };
  if (href) return <Cell as={Link} to={toAppPath(href) ?? href} onClick={() => haptic("select")} {...slots} />;
  return <Cell as="button" type="button" onClick={() => { haptic("select"); onClick?.(); }} {...slots} />;
}

/** A grouped list, a divider between rows. */
export function List({ children, ...rest }: { children: ReactNode; "aria-busy"?: "true"; "aria-label"?: string }) {
  const items = Children.toArray(children);
  return (
    <section className={`list${IOS ? " list--ios" : ""}`} {...rest}>
      <div className="list__box"><div className="list__body">
        {items.map((c, i) => <Fragment key={isValidElement(c) && c.key !== null ? c.key : i}>{c}{i < items.length - 1 ? <hr className="list__divider" /> : null}</Fragment>)}
      </div></div>
    </section>
  );
}

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

/**
 * Bible Strong's common/Loading: a grey activity indicator centred in the page (at least 300px)
 * while what was asked for arrives, with the message under it where the screen gives one.
 */
export function Loading({ message }: { message?: string }) {
  return (
    <div className="loading" role="progressbar" aria-label={message || "Loading..."} aria-busy="true">
      <span className="loading__spinner" />
      {message ? <p className="loading__message" aria-live="polite">{message}</p> : null}
    </div>
  );
}

/**
 * Bible Strong's common/Empty: the faint 180px illustration (with the kind's icon tilted on it when
 * there is one), one centred grey message (a second line for the detail), and the action as its
 * Button under it.
 */
export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: { label: string; href?: string; onClick?: () => void }; icon?: string }) {
  return (
    <section className="empty">
      <div className="empty__art" aria-hidden="true">
        <img src={assetUrl("art/empty-state-illustration.webp")} alt="" />
        {icon ? <span style={{ ["--icon" as string]: `url("${assetUrl(`bs/empty-state-icons/${icon}.svg`)}")` }} /> : null}
      </div>
      {has(title) || has(children) ? <p className="empty__msg">{has(title) ? title : null}{has(title) && has(children) ? <br /> : null}{has(children) ? children : null}</p> : null}
      {action ? <div className="empty__acts">{action.href ? <Link to={toAppPath(action.href) ?? action.href} className="empty__act" onClick={() => haptic("select")}>{action.label}</Link> : <button type="button" className="empty__act" onClick={() => { haptic("select"); action.onClick?.(); }}>{action.label}</button>}</div> : null}
    </section>
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
