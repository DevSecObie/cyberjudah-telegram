import { Children, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Cell, Chip as TgChip, Input, Placeholder, Section as TgSection, SegmentedControl, Skeleton as TgSkeleton } from "@telegram-apps/telegram-ui";

import { toAppPath } from "@shared/links.mjs";
import { haptic } from "@/tg/sdk";
import { usePageActions } from "@/tg/hooks";
import { adjacentTab, askTabPath, bibleTabPath, searchTabPath, useTabs } from "@/lib/tabs";
import { setDrawer, useDrawer, type DrawerSide } from "@/lib/drawer";
import { expandBar, useBarMini, useBarScroll } from "@/lib/barscroll";
import { SwitcherBar } from "@/screens/Tabs";
import { NAV_ITEMS, navItem, useNav, type NavId } from "@/lib/nav";

export type IconName = "home" | "search" | "play" | "book" | "book-open" | "more" | "chevron" | "back" | "share" | "clock" | "bookmark" | "bookmarkFill" | "sun" | "star" | "check" | "copy" | "qr" | "bell" | "link" | "note" | "law" | "list" | "merge" | "precepts" | "gear" | "type" | "layers" | "tag" | "quote" | "folder" | "compose" | "spark" | "arrowUp" | "retry" | "history" | "trash" | "chat" | "download" | "plus" | "close" | "image" | "alert" | "info";
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const p: Record<IconName, ReactNode> = {
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></>,
    play: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
    "book-open": <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
    more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    share: <><path d="M12 3v13" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
    bookmarkFill: <path d="M6 3h12v18l-6-4-6 4z" fill="currentColor" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    star: <path d="m12 3 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.5l-5.7 3 1.2-6.4L2.8 9.7l6.4-.8z" />,
    check: <path d="m5 12 5 5 9-10" />,
    copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
    qr: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v3M17 20h3M14 20h0" /></>,
    bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></>,
    link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></>,
    note: <><path d="M6 3h9l5 5v13H6z" /><path d="M14 3v6h6M9 13h7M9 17h7" /></>,
    law: <><path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
    precepts: <><rect x="2.5" y="3" width="8" height="11" rx="1.5" /><rect x="13.5" y="10" width="8" height="11" rx="1.5" /><path d="M5 7h3M5 10h3M16 14h3M16 17h3" /><path d="M10.5 8.5c3 0 4 1 4 1.5" /></>,
    merge: <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    type: <><path d="M4 7V5h16v2M9 19h6M12 5v14" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
    tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>,
    quote: <><path d="M7 7h4v4c0 3-2 5-4 6M14 7h4v4c0 3-2 5-4 6" /></>,
    compose: <><path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M17.5 2.5a2.1 2.1 0 0 1 3 3L12 14l-4 1 1-4z" /></>,
    spark: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" fill="currentColor" stroke="none" />,
    arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
    download: <><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>,
    history: <><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="17" r="3" /><path d="M18 15.6V17l1 .8" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    retry: <><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></>,
    folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

/**
 * Bible Strong's bottom bar (app-switcher/BottomTabBar): a full-width row of icons, 48 high, no
 * labels. Here the reader picks and orders the buttons (lib/nav); the menu always ends the row.
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
  const go = (to: string) => { if (long.current) return; haptic("select"); setDrawer(null); if (to === pathname) window.scrollTo({ top: 0, behavior: "smooth" }); else navigate(to, { replace: true }); };
  // Home and the menu are drawers, as in Bible Strong; the same button closes its own drawer.
  const toggle = (side: DrawerSide) => { if (long.current) return; haptic("select"); setDrawer(drawer === side ? null : side); };
  // A long press edits the bar; a horizontal swipe along it moves to the next or previous open tab
  // (Bible Strong's useTabBarSwipeGesture).
  const hold = {
    onPointerDown: (e: React.PointerEvent) => { long.current = false; swipe.current = { x: e.clientX, y: e.clientY }; press.current = window.setTimeout(() => { long.current = true; haptic("heavy"); setDrawer(null); navigate("/settings/bar"); }, 600); },
    onPointerMove: (e: React.PointerEvent) => { const s = swipe.current; if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) window.clearTimeout(press.current); },
    onPointerUp: (e: React.PointerEvent) => {
      window.clearTimeout(press.current);
      const s = swipe.current; swipe.current = null; if (!s || long.current) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const to = adjacentTab(dx < 0 ? 1 : -1);
      if (to) { long.current = true; window.setTimeout(() => { long.current = false; }, 50); haptic("select"); setDrawer(null); navigate(to, { replace: true }); }
    },
    onPointerLeave: () => window.clearTimeout(press.current),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
  // The bar follows the reading: a small capsule while scrolling down, the full bar otherwise.
  useBarScroll(pathname);
  // Ask keeps the full bar: its composer sits on it, as a chat app keeps its input in place.
  const mini = useBarMini() && !drawer && pathname !== "/ask";
  const bar = useRef<HTMLElement>(null);
  // The current section sits on a pill that slides to it (across the dock on phones, down the
  // rail on desktops). Every section keeps its slot, so only the pill moves.
  useLayoutEffect(() => {
    const nav = bar.current; if (!nav) return;
    const place = () => {
      const on = nav.querySelector<HTMLElement>(".tab[data-on]");
      const shown = !!on && on.offsetWidth > 0;
      nav.style.setProperty("--pill-x", `${shown ? on!.offsetLeft : 0}px`);
      nav.style.setProperty("--pill-y", `${shown ? on!.offsetTop : 0}px`);
      nav.style.setProperty("--pill-w", `${shown ? on!.offsetWidth : 0}px`);
      nav.style.setProperty("--pill-h", `${shown ? on!.offsetHeight : 0}px`);
      nav.dataset.pill = shown ? "" : "none";
    };
    place();
    const ro = new ResizeObserver(place); ro.observe(nav);
    for (const b of nav.querySelectorAll(".tab")) ro.observe(b);
    return () => ro.disconnect();
  });
  // While the switcher is open the bar becomes its controls, as in Bible Strong.
  if (pathname.startsWith("/tabs")) return <nav className="tabs tabs--switcher" aria-label="Tabs"><SwitcherBar /></nav>;
  const count = tabs.length > 100 ? ":)" : String(tabs.length);
  const items: { id: NavId | "more"; label: string; aria: string; glyph: ReactNode; onClick: () => void }[] = [
    ...ids.map((id) => {
      const item = navItem(id);
      return { id, label: id === "tabs" ? "Tabs" : item.label, aria: id === "tabs" ? `Tabs, ${tabs.length} open` : item.label,
        glyph: item.icon === "count" ? <span key={count} className="tab__count" style={{ ["--group" as string]: groupColor }} aria-hidden="true">{count}</span> : <Icon name={item.icon} size={22} />,
        onClick: () => id === "home" ? toggle("home") : go(navPath(id)) };
    }),
    { id: "more", label: "Menu", aria: "Menu", glyph: <Icon name="more" size={24} />, onClick: () => toggle("more") },
  ];
  return (
    <nav ref={bar} className="tabs" aria-label="Sections" data-mini={mini ? "" : undefined} {...hold}
      onClickCapture={(e) => { if (mini) { e.stopPropagation(); e.preventDefault(); haptic("select"); expandBar(); } }}>
      <span className="tabs__pill" aria-hidden="true" />
      {items.map((it) => {
        const on = current === it.id;
        // Collapsed, the capsule shows the current section, or the Menu where the screen is not one of them.
        const kept = mini && (on || (it.id === "more" && !items.some((x) => x.id === current)));
        return (
          <button key={it.id} type="button" className="tab" data-on={on ? "" : undefined} data-kept={kept ? "" : undefined} aria-current={on ? "page" : undefined}
            aria-label={it.aria} tabIndex={mini && !kept ? -1 : undefined} onClick={it.onClick}>
            <span className="tab__glyph">{it.glyph}</span>
            <span className="tab__label" aria-hidden="true">{it.label}</span>
          </button>
        );
      })}
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
    <button type="button" className={`pageaction${quiet || a.quiet ? " pageaction--quiet" : ""}`} disabled={a.disabled || a.progress} aria-busy={a.progress || undefined} onClick={a.onClick}>
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

export function SearchField({ value, onChange, onSubmit, placeholder, autoFocus, id, trailing }: { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder: string; autoFocus?: boolean; id: string; trailing?: ReactNode }) {
  return (
    <form className="field" role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur(); onSubmit?.(); }}>
      <Input id={id} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} aria-label={placeholder}
        before={<Icon name="search" size={18} />} after={value ? <button type="button" className="field__clear" aria-label="Clear" onClick={() => onChange("")}>×</button> : trailing} />
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

export { Button };

export function Card({ children, glow, href, onClick, className }: { children: ReactNode; glow?: boolean; href?: string; onClick?: () => void; className?: string }) {
  const cls = `card${glow ? " card--glow" : ""}${className ? ` ${className}` : ""}`;
  if (href) return <Link className={cls} to={toAppPath(href) ?? href} onClick={() => haptic("select")}>{children}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={() => { haptic("select"); onClick(); }}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export const timestamp = (s: number) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`; };
export const youtube = (id: string, start = 0) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${start > 0 ? `&t=${Math.floor(start)}s` : ""}`;
export const thumbOf = (id: string, big = false) => `https://img.youtube.com/vi/${encodeURIComponent(id)}/${big ? "hqdefault" : "mqdefault"}.jpg`;
