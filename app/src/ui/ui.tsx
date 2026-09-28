import { Children, useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, Cell, Chip as TgChip, Input, Placeholder, Section as TgSection, SegmentedControl, Skeleton as TgSkeleton, Tabbar } from "@telegram-apps/telegram-ui";

import { toAppPath } from "@shared/links.mjs";
import { haptic } from "@/tg/sdk";

export type IconName = "home" | "search" | "play" | "book" | "more" | "chevron" | "back" | "share" | "clock" | "bookmark" | "bookmarkFill" | "sun" | "star" | "check" | "copy" | "qr" | "bell" | "link" | "note" | "law" | "list" | "merge" | "gear" | "type" | "layers" | "tag" | "quote" | "folder" | "compose" | "spark" | "arrowUp" | "retry" | "history" | "trash" | "chat";
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const p: Record<IconName, ReactNode> = {
    home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></>,
    play: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>,
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
    merge: <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
    type: <><path d="M4 7V5h16v2M9 19h6M12 5v14" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
    tag: <><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="8" cy="8" r="1.5" /></>,
    quote: <><path d="M7 7h4v4c0 3-2 5-4 6M14 7h4v4c0 3-2 5-4 6" /></>,
    compose: <><path d="M12 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M17.5 2.5a2.1 2.1 0 0 1 3 3L12 14l-4 1 1-4z" /></>,
    spark: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7z" fill="currentColor" stroke="none" />,
    arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
    history: <><path d="M4 6h16M4 12h10M4 18h7" /><circle cx="18" cy="17" r="3" /><path d="M18 15.6V17l1 .8" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    retry: <><path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" /></>,
    folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p[name]}</svg>;
}

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Home", icon: "home" },
  { to: "/classes", label: "Classes", icon: "play" },
  { to: "/ask", label: "Ask", icon: "chat" },
  { to: "/bible", label: "Bible", icon: "book" },
  { to: "/more", label: "More", icon: "more" },
];

/** Which tab a screen belongs to, so the tab stays lit on everything opened from it. */
export function tabOf(path: string): string {
  if (path === "/" || path.startsWith("/search")) return "/";
  if (/^\/(classes|note|watch|topics)(\/|$)/.test(path)) return "/classes";
  if (path.startsWith("/ask")) return "/ask";
  if (/^\/(bible|read)(\/|$)/.test(path)) return "/bible";
  return "/more";
}
const LAST = "cj:tab:";

/**
 * Telegram's own tab bar (TelegramUI's Tabbar), kept on every screen but the player, the
 * way an iOS app keeps it. Each tab remembers the screen it was left on and returns there;
 * tapping the tab you are on goes back to its first screen, or to the top when already there.
 * Tabs replace instead of push, so Telegram's back button never walks through tab taps.
 */
export function TabBar() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const current = tabOf(pathname);
  useEffect(() => { try { sessionStorage.setItem(LAST + current, pathname + search); } catch { /* private mode */ } }, [current, pathname, search]);
  const go = (to: string) => {
    haptic("select");
    if (to !== current) {
      let last: string | null = null;
      try { last = sessionStorage.getItem(LAST + to); } catch { /* private mode */ }
      navigate(last ?? to, { replace: true });
    } else if (pathname !== to) navigate(to, { replace: true });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <Tabbar className="tabs" aria-label="Sections">
      {TABS.map((t) => (
        <Tabbar.Item key={t.to} className="tab" text={t.label} selected={current === t.to} aria-current={current === t.to ? "page" : undefined} onClick={() => go(t.to)}>
          <Icon name={t.icon} size={24} />
        </Tabbar.Item>
      ))}
    </Tabbar>
  );
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
export function Row({ href, onClick, title, sub, meta, thumb, trailing, icon }: { href?: string; onClick?: () => void; title: ReactNode; sub?: ReactNode; meta?: ReactNode; thumb?: string; trailing?: ReactNode; icon?: IconName }) {
  const slots = {
    className: "row",
    multiline: true,
    before: thumb !== undefined ? <span className="row__thumb">{thumb ? <Img src={thumb} /> : null}</span> : icon ? <span className="row__icon"><Icon name={icon} size={20} /></span> : undefined,
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
  return (
    <TgSection className="list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <TgSkeleton key={i} visible>
          <Cell className="row row--skel" multiline before={thumb ? <span className="row__thumb" /> : undefined} subtitle={<span className="skel" style={{ width: `${70 + ((i * 13) % 25)}%` }} />}><span className="skel" style={{ width: "40%" }} /></Cell>
        </TgSkeleton>
      ))}
    </TgSection>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <Placeholder className="empty" header={title} description={children} />;
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
