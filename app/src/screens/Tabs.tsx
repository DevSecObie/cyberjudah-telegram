import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { data } from "@/api/data";
import { useNavigate } from "react-router";

import { closeTab, currentGroup, groupsNow, isDefaultGroup, newTab, selectTab, switchGroup, tabKind, tabTitle, useTabs, type Group } from "@/lib/tabs";
import { assetUrl } from "@/lib/asset";
import { groupPager } from "@/ui/group-pager";
import { CreateGroupPage, GroupActions, groupLabel } from "./tab-groups";
import { SCOPES, SearchPicker, type Scope } from "./new-tab-search";
import { useBackButton } from "@/tg/hooks";
import { Feather } from "@/bible/icons";
import { Icon, Screen, type IconName } from "@/ui/ui";
import { closeTabCard, moveTab, reflowTabs } from "@/ui/tab-motion";

/**
 * Bible Strong's New Tab page (TabScreen/NewTab/NewTabContent): the heading, then Read and explore
 * (the Bible card, then the reading cards), Studies and notes, and the Library, each card opening
 * in this tab. Our own resources follow Bible Strong's in each section.
 */
type Item = [to: string, title: string, description: string];
const READ: Item[] = [
  ["/plans", "Reading plan", "Follow a reading plan"],
  ["/timeline", "Timeline", "Explore biblical history"],
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter"],
  ["/classes?feed=history", "Our Hidden History", "Explore our history, episode by episode"],
];
const PERSONAL: Item[] = [
  ["/studies", "Studies", "Find your studies"],
  ["/bookmarks", "Kept", "Your highlights, notes and bookmarks"],
  ["/classes", "Classes", "Every Sabbath class, with its notes"],
  ["/ask", "Ask CyberJudah", "Answers from the teachings, with their sources"],
];
const LIBRARY: Item[] = [
  ["/lexicon", "Strong", "Explore Greek and Hebrew words"],
  ["/topics", "Topics", "Explore what the classes taught, by theme"],
  ["/dictionary", "Dictionary", "Look up definitions"],
  ["/concordance", "Concordance", "Who cites each chapter, book by book"],
  ["/precepts", "Precepts", "Every subject scripture speaks to"],
  ["/people", "People", "Everyone named in the Bible"],
  ["/books", "Library", "The books the classes read from"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book"],
  ["/glossary", "Glossary", "The words the classes use, defined"],
  ["/law", "The Law", "Every law with its scripture"],
  ["/cases", "Case studies", "Judgments, and those who were blessed"],
];

/** Bible Strong's SectionHeading: 23 px, with our picture standing on the cards below. */
function SectionHeading({ title, image }: { title: string; image?: string }) {
  return (
    <div className="ntsection" data-image={image ? "" : undefined}>
      <h2>{title}</h2>
      {image ? <img className="ntsection__art" src={assetUrl(`art/new-tab/${image}.svg`)} alt="" aria-hidden="true" /> : null}
    </div>
  );
}

export function NewTab() {
  useBackButton(() => true, false, true);
  const navigate = useNavigate();
  // A card of a kind Bible Strong searches opens the Search sheet for that kind (useLaunchSearch);
  // the others open their page in this tab.
  const [scope, setScope] = useState<Scope | null>(null);
  const open = (to: string) => { if (SCOPES[to]) setScope(SCOPES[to]); else navigate(to, { replace: true }); };
  /** Bible Strong's NewTabItem: the kind's icon, the title over its description, a chevron; dims while pressed. */
  const Card = ({ item: [to, title, description], library }: { item: Item; library?: boolean }) => (
    <button type="button" className="ntcard" aria-label={title} aria-description={description} onClick={() => open(to)}>
      <span className="ntcard__row">
        <TabIcon path={to} size={library ? 34 : 28} />
        <span className="ntcard__body"><b>{title}</b><small>{description}</small></span>
      </span>
      <Feather name="chevron-right" size={18} raw />
    </button>
  );
  return (
    <Screen className="newtab">
      <div className="newtab__content">
        <h1 className="nt-heading">What would you like to explore?</h1>
        <SectionHeading title="Read and explore" />
        <button type="button" className="ntcard ntcard--hero" aria-label="Bible" aria-description="Open the Bible and start reading" onClick={() => open("/bible")}>
          <span className="ntcard__row">
            <TabIcon path="/bible" size={40} />
            <span className="ntcard__body"><b>Bible</b><small>Open the Bible and start reading</small></span>
          </span>
          <img className="ntcard__art" src={assetUrl("art/new-tab/bible.svg")} alt="" aria-hidden="true" />
          <Feather name="chevron-right" size={22} raw />
        </button>
        <div className="ntgrid ntgrid--read">{READ.map((i) => <Card key={i[0]} item={i} />)}</div>
        <div className="newtab__more">
          <section>
            <SectionHeading title="Studies and notes" image="notes" />
            <div className="ntgrid ntgrid--personal">{PERSONAL.map((i) => <Card key={i[0]} item={i} />)}</div>
          </section>
          <section>
            <SectionHeading title="Library" image="library" />
            <div className="ntgrid ntgrid--library">{LIBRARY.map((i) => <Card key={i[0]} item={i} library />)}</div>
          </section>
        </div>
      </div>
      <SearchPicker scope={scope} onClose={() => setScope(null)} onPick={(path) => { setScope(null); navigate(path, { replace: true }); }} />
    </Screen>
  );
}

/** Bible Strong's default group: it has no name of its own, only its count. */
const isDefault = isDefaultGroup;

/**
 * The bottom bar while the switcher is open (Bible Strong's BottomTabBar in list mode): a new
 * tab, the group's name (the default group shows its count) which opens the group's actions, and OK.
 */
export function SwitcherBar() {
  const navigate = useNavigate();
  const { tabs, current, group } = useTabs();
  const add = useAddTab();
  const named = !isDefault(group);
  // Bible Strong's useBottomTabBar: the current card is scrolled into view, if it is not, before it opens.
  const ok = () => {
    const t = tabs.find((x) => x.id === current); if (!t) return;
    const card = document.querySelector<HTMLElement>(`.tabcard[data-tab-id="${CSS.escape(t.id)}"]`), r = card?.getBoundingClientRect();
    if (card && r && (r.bottom <= 0 || r.top >= innerHeight)) card.scrollIntoView({ block: "start", behavior: "instant" });
    moveTab(() => { navigate(selectTab(t.id), { replace: true }); }, "expand", t.id);
  };
  return (
    <div className="switcherbar" role="toolbar" aria-label="Tabs">
      <button type="button" className="switcherbar__add" aria-label="Add a tab" onClick={add}><Icon name="plus" size={23} /></button>
      <GroupActions label={groupLabel(group)} style={named ? { ["--group" as string]: group.color, ["--group-ink" as string]: contrastInk(group.color) } : undefined}>
        <span>{groupLabel(group)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </GroupActions>
      <button type="button" className="switcherbar__ok" aria-label="Open selected tab" onClick={ok}>OK</button>
    </div>
  );
}

/** Reanimated 4's default withSpring (stiffness 900, damping 120, mass 4): critically damped, about half a second. */
function spring(from: number, to: number, frame: (x: number) => void, done: () => void): () => void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { frame(to); done(); return () => {}; }
  let x = from, v = 0, last = performance.now(), id = 0;
  const step = (now: number) => {
    let dt = Math.min(0.064, (now - last) / 1000); last = now;
    while (dt > 0) { const h = Math.min(dt, 1 / 240); v += ((-900 * (x - to) - 120 * v) / 4) * h; x += v * h; dt -= h; }
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 5) { frame(to); done(); return; }
    frame(x); id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
/** Bible Strong's rubberBand: 0.3 of the pull past either end, at most 100 px. */
const rubberBand = (v: number, min: number, max: number) => (v < min ? min - Math.min((min - v) * 0.3, 100) : v > max ? max + Math.min((v - max) * 0.3, 100) : v);

/**
 * Bible Strong's tab switcher (CompactAppSwitcherScreen, TabGroupPager, TabGroupPage): each group
 * a page of its own, side by side, with the create page after the last. The pages follow the
 * finger (after 10 px across, given up after 10 px up or down), resist past either end, and on
 * release spring to the nearest page, or on past it with a flick over 500 px/s. A group's tabs are
 * two to a row, 20 px apart, each a card with a 40 px title bar (icon, title, ✕) over a round icon.
 */
export function Tabs() {
  const navigate = useNavigate();
  const { groups, group } = useTabs();
  const go = (id: string) => { moveTab(() => { navigate(selectTab(id), { replace: true }); }, "expand", id); };
  // Bible Strong's switcher has no Back: it closes with OK or a card.
  useBackButton(() => true, false, true);
  // Card size: two per row with 20 px margins and gap; height from the screen's proportions x 0.7.
  const [size, setSize] = useState(() => cardSize());
  const [width, setWidth] = useState(() => innerWidth);
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = container.current!;
    const measure = () => {
      const next = cardSize(element.clientWidth);
      setWidth(element.clientWidth);
      setSize(previous => previous.w === next.w && previous.h === next.h && previous.perRow === next.perRow ? previous : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  // The pager: x is the track's translation; the create page is page groups.length.
  const index = Math.max(0, groups.findIndex((g) => g.id === group.id));
  const track = useRef<HTMLDivElement>(null);
  const pages = useRef(new Map<string, HTMLElement>());
  const createPage = useRef<HTMLElement>(null);
  const x = useRef(-index * width);
  const [createShown, setCreateShown] = useState(false);
  const stop = useRef<() => void>(() => {});
  const springing = useRef(false);
  const live = useRef(width);
  const laidOut = useRef(width);
  live.current = width;
  const apply = (v: number) => {
    const gs = groupsNow(), w = live.current, n = gs.length;
    x.current = v;
    if (track.current) track.current.style.transform = `translate3d(${v}px, 0, 0)`;
    // The last group fades to .3 as the create page comes in (TabGroupPage), which grows from .8 held in place (CreateGroupPage).
    const scrollX = -v, start = n * w, p = Math.min(1, Math.max(0, (scrollX - (start - w)) / w));
    const lastId = gs[n - 1]?.id;
    for (const [id, el] of pages.current) el.style.opacity = id === lastId ? String(1 - 0.7 * p) : "";
    const cp = createPage.current;
    if (cp) { cp.style.opacity = String(p); cp.style.transform = `translateX(${-w + p * w}px) scale(${0.8 + 0.2 * p})`; }
  };
  /** Bible Strong's navigateToPage: springs to a page; a group's page makes it the current group, and the one left scrolls back to its top. */
  const navigateToPage = (page: number) => {
    const gs = groupsNow(), w = live.current;
    stop.current();
    springing.current = true;
    stop.current = spring(x.current, -page * w, apply, () => { springing.current = false; });
    setCreateShown(page >= gs.length);
    const target = gs[page];
    if (target && target.id !== currentGroup().id) {
      pages.current.get(currentGroup().id)?.scrollTo({ top: 0, behavior: "smooth" });
      switchGroup(target.id);
    }
  };
  useEffect(() => groupPager.subscribe(navigateToPage), []); // eslint-disable-line react-hooks/exhaustive-deps
  // A group chosen elsewhere, or a new width: the pager is put on it at once (useProviderEffects).
  useLayoutEffect(() => {
    const resized = laidOut.current !== width;
    laidOut.current = width;
    // A new width puts the page shown, the create page too, back on its edge, ending any spring.
    if (resized && !drag.current?.active) { stop.current(); springing.current = false; apply(-(createShown ? groups.length : index) * width); return; }
    if (springing.current || drag.current?.active || createShown) return;
    stop.current(); apply(-index * width);
  }, [index, width, groups.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useRef<{ x: number; y: number; start: number; active: boolean; failed: boolean; id: number; samples: [number, number][] } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    // A second pointer is refused; the same pointer pressing again means its last release was missed
    // (a mouse let go outside the switcher before the drag began).
    if (e.button !== 0 || (drag.current && drag.current.id !== e.pointerId)) return;
    drag.current = { x: e.clientX, y: e.clientY, start: x.current, active: false, failed: false, id: e.pointerId, samples: [[performance.now(), e.clientX]] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.failed || d.id !== e.pointerId) return;
    // A mouse moving with no button down let go outside the switcher before its drag began.
    if (e.buttons === 0 && !d.active) { drag.current = null; return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) > 10) { d.failed = true; return; }
      if (Math.abs(dx) <= 10) return;
      d.active = true; stop.current(); d.start = x.current;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const n = groupsNow().length, w = live.current;
    apply(rubberBand(d.start + dx, -n * w, 0));
    d.samples.push([performance.now(), e.clientX]); if (d.samples.length > 6) d.samples.shift();
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const n = groupsNow().length, w = live.current;
    const [t0, x0] = d.samples[0], [t1, x1] = d.samples[d.samples.length - 1];
    const velocity = performance.now() - t1 > 80 || t1 === t0 ? 0 : ((x1 - x0) / (t1 - t0)) * 1000;
    const at = -x.current / w;
    let page = Math.abs(velocity) > 500 ? (velocity > 0 ? Math.floor(at) : Math.ceil(at)) : Math.round(at);
    page = Math.max(0, Math.min(page, n));
    navigateToPage(page);
  };

  return (
    <main ref={container} className="switcher" aria-label="Your tabs" data-creating={createShown ? "" : undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
      <div ref={track} className="switcher__track" style={{ width: (groups.length + 1) * width, transform: `translate3d(${x.current}px, 0, 0)` }}>
        {groups.map((g) => (
          <section key={g.id} ref={(el) => { if (el) pages.current.set(g.id, el); else pages.current.delete(g.id); }} className="switcher__page"
            data-group-id={g.id} data-active={g.id === group.id ? "" : undefined} data-empty={g.tabs.length ? undefined : ""} style={{ width }}
            aria-hidden={g.id === group.id ? undefined : true} inert={g.id !== group.id}>
            {!g.tabs.length ? <EmptyGroup /> : isDefault(g) ? null : <GroupHeader group={g} width={width} />}
            <div className="switcher__grid" style={{ gridTemplateColumns: `repeat(${size.perRow}, ${size.w}px)` }}>
              {g.tabs.map((t) => {
                const title = tabTitle(t.path);
                return (
                  <div key={t.id} className="tabcard" data-tab-id={t.id} data-current={t.id === g.current ? "" : undefined} style={{ width: size.w, height: size.h }}>
                    <button type="button" className="tabcard__open" onClick={() => go(t.id)} aria-label={`Open ${title}`}>
                      <TabPreview path={t.path} />
                      <span className="tabcard__icon"><TabIcon path={t.path} size={30} /></span>
                    </button>
                    <span className="tabcard__title"><TabIcon path={t.path} size={16} /><MiddleText text={title} /></span>
                    <button type="button" className="tabcard__close" aria-label={`Close ${title}`} onClick={() => closeTabCard(t.id, () => closeTab(t.id))}>
                      <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <CreateGroupPage pageRef={createPage} shown={createShown} onCancel={() => navigateToPage(Math.max(0, groups.length - 1))} />
      </div>
    </main>
  );
}
/**
 * Bible Strong's GroupHeader (TabGroupPage), over a named group's tabs: its count on a 24 px
 * square of its colour, then its name at 30 px, made smaller to fit 70% of the screen, never under 20.
 */
function GroupHeader({ group, width }: { group: Group; width: number }) {
  const name = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(30);
  useLayoutEffect(() => {
    const el = name.current; if (!el) return;
    el.style.fontSize = "30px";
    // The text's own line, as React Native's onTextLayout gives it, not the row it sits in.
    const range = document.createRange(); range.selectNodeContents(el);
    const text = range.getBoundingClientRect().width, max = width * 0.7;
    const next = text > max ? Math.max(30 * (max / text), 20) : 30;
    // Written back at once: React leaves the style alone when the size it holds has not changed.
    el.style.fontSize = `${next}px`;
    setSize(next);
  }, [group.name, width]);
  return (
    <header key={group.id} className="switcher__group">
      <span className="switcher__badge" style={{ background: group.color, color: contrastInk(group.color) }}>{group.tabs.length}</span>
      <span ref={name} className="switcher__name" style={{ fontSize: size }}>{group.name}</span>
    </header>
  );
}

/**
 * Our tab icons for the kinds Bible Strong draws one for (getIconByTabType), in their universe's
 * colour (themes/universeColors); our other kinds keep their own icon, in the tertiary colour.
 */
const TAB_ART: [RegExp, string, string][] = [
  [/^\/new/, "plus", "grey"], [/^\/(bible|read)/, "bible", "tertiary"], [/^\/search/, "search", "tertiary"], [/^\/lexicon/, "lexicon", "primary"],
  [/^\/dictionary/, "dictionary", "secondary"], [/^\/topics/, "topics", "quint"], [/^\/studies/, "study", "tertiary"], [/^\/(bookmarks|tags)/, "note", "color2"],
];
const MATERIAL: [RegExp, string][] = [
  [/^\/(plans?|study)(\/|\?|$)/, "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z"],
  [/^\/timeline/, "M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z"],
];
/** `plain`: in the theme's own ink, as View my groups shows them. */
export function TabIcon({ path, size, plain }: { path: string; size: number; plain?: boolean }) {
  const art = TAB_ART.find(([re]) => re.test(path));
  if (art) return <span className={`tabicon tabicon--${plain ? "default" : art[2]}`} aria-hidden="true" style={{ width: size, height: size, ["--icon" as string]: `url("${assetUrl(`art/tab/${art[1]}.svg`)}")` }} />;
  const material = MATERIAL.find(([re]) => re.test(path));
  if (material) return <svg className={plain ? "tabicon--default" : "tabicon--tertiary"} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={material[1]} /></svg>;
  return <span className={plain ? "tabicon--default" : "tabicon--tertiary"} style={{ display: "contents" }}><Icon name={tabKind(path).icon as IconName} size={size} /></span>;
}

/** One line cut in the middle when it does not fit (React Native's ellipsizeMode="middle"). */
function MiddleText({ text }: { text: string }) {
  const el = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const node = el.current; if (!node) return;
    node.textContent = text;
    if (node.scrollWidth <= node.clientWidth) return;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      node.textContent = `${text.slice(0, Math.ceil(mid / 2))}…${text.slice(text.length - Math.floor(mid / 2))}`;
      if (node.scrollWidth <= node.clientWidth) lo = mid; else hi = mid - 1;
    }
    node.textContent = `${text.slice(0, Math.ceil(lo / 2))}…${text.slice(text.length - Math.floor(lo / 2))}`;
  });
  return <b ref={el}>{text}</b>;
}

/** Bible Strong's empty group (TabGroupPage): the tabs picture, faint, and a Create a tab button that opens a new tab. */
function EmptyGroup() {
  const add = useAddTab();
  return (
    <div className="switcher__empty">
      <span className="switcher__empty-art" aria-hidden="true" style={{ ["--art" as string]: `url("${assetUrl("art/tabs.svg")}")` }} />
      <button type="button" className="switcher__create" onClick={add}><Icon name="plus" size={20} /><b>Create a tab</b></button>
    </div>
  );
}
/** Bible Strong's AddTabButton: a new tab at the end of the group, opened from its card. */
function useAddTab() {
  const navigate = useNavigate();
  return () => {
    const group = currentGroup().id;
    reflowTabs(() => newTab());
    const added = currentGroup().current;
    // Bible Strong's useExpandNewTab: to the end of the list, a 300 ms pause, then the new card opens.
    // Each group's page scrolls on its own.
    const page = document.querySelector<HTMLElement>(".switcher__page[data-active]");
    page?.scrollTo({ top: page.scrollHeight, behavior: "instant" });
    window.setTimeout(() => {
      // Left for another tab or group, the new tab closed, or the create page opened in the meantime: they keep their place.
      if (!location.pathname.startsWith("/tabs") || currentGroup().id !== group || currentGroup().current !== added || document.querySelector(".switcher[data-creating]")) return;
      moveTab(() => { navigate("/new", { replace: true }); }, "expand");
    }, 300);
  };
}
/** The group's name on its colour (getContrastTextColor): in dark, black on a light colour; in light, white on a dark one. */
export function contrastInk(hex: string) {
  const rgb = hex.replace("#", "");
  const luminance = 0.2126 * (parseInt(rgb.slice(0, 2), 16) / 255) + 0.7152 * (parseInt(rgb.slice(2, 4), 16) / 255) + 0.0722 * (parseInt(rgb.slice(4, 6), 16) / 255);
  if (document.documentElement.dataset.theme === "dark") return luminance > 0.5 ? "#000000" : undefined;
  return luminance < 0.6 ? "#FFFFFF" : undefined;
}
function cardSize(width = window.innerWidth) {
  const W = width, H = window.innerHeight, perRow = W > 600 ? 4 : 2;
  const w = Math.floor((W - 20 * 2 - (perRow - 1) * 20) / perRow);
  return { perRow, w, h: Math.round(((w * H) / W) * (W > 600 ? 1 : 0.7)) };
}

/** Reuse the chapter cache: the faded text is our own KJV, with no snapshot of private UI. */
function TabPreview({ path }: { path: string }) {
  const passage = /^\/(?:read|bible)\/([^/?]+)\/(\d+)/.exec(path);
  const slug = passage?.[1] ?? "", chapter = Number(passage?.[2]);
  const text = useQuery({ queryKey: ["chapter", slug, chapter], queryFn: () => data.chapter(slug, chapter), enabled: !!passage, staleTime: Infinity });
  const item = [...READ, ...PERSONAL, ...LIBRARY].find(([to]) => path.split(/[?#]/)[0] === to);
  return <span className="tabcard__preview" aria-hidden="true">
    <b>{tabTitle(path)}</b>
    {passage ? text.data?.verses.slice(0, 6).map((v) => <span key={v.verse}><sup>{v.verse}</sup> {v.text}</span>) : <span>{item?.[2] ?? tabKind(path).kind}</span>}
  </span>;
}
