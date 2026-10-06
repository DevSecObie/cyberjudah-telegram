import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { data } from "@/api/data";
import { useNavigate } from "react-router";

import { adjacentGroup, closeTab, DEFAULT_GROUP, deleteGroup, GROUP_COLORS, MAX_GROUPS, newGroup, newTab, renameGroup, selectTab, switchGroup, tabKind, tabTitle, useTabs, type Group } from "@/lib/tabs";
import { useSheet } from "@/ui/sheet";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon, Screen, type IconName } from "@/ui/ui";
import { moveTab, reflowTabs } from "@/ui/tab-motion";

/** Bible Strong's New Tab page (TabScreen/NewTab/NewTabContent): every resource, by section, each opening in this tab. */
type Item = [to: string, title: string, description: string, icon: IconName];
const READ: Item[] = [
  ["/plan", "Reading plan", "Follow a reading plan", "check"],
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/classes?feed=history", "Our Hidden History", "Explore our history, episode by episode", "history"],
];
const PERSONAL: Item[] = [
  ["/classes", "Classes", "Every Sabbath class, with its notes", "play"],
  ["/bookmarks", "Kept", "Your highlights, notes and bookmarks", "bookmark"],
  ["/ask", "Ask CyberJudah", "Answers from the teachings, with their sources", "chat"],
];
const LIBRARY: Item[] = [
  ["/lexicon", "Strong", "Explore Greek and Hebrew words", "spark"],
  ["/topics", "Topics", "Explore what the classes taught, by theme", "tag"],
  ["/concordance", "Concordance", "Who cites each chapter, book by book", "list"],
  ["/dictionary", "Dictionary", "Look up definitions", "type"],
  ["/precepts", "Precepts", "Every subject scripture speaks to", "quote"],
  ["/people", "People", "Everyone named in the Bible", "star"],
  ["/books", "Library", "The books the classes read from", "layers"],
  ["/encyclopedia", "Encyclopedia", "Standing subjects, book by book", "book"],
  ["/glossary", "Glossary", "The words the classes use, defined", "type"],
  ["/law", "The Law", "Every law with its scripture", "law"],
  ["/cases", "Case studies", "Judgments, and those who were blessed", "folder"],
  ["/timeline", "Bible timeline", "Periods and events by year", "clock"],
];

export function NewTab() {
  useBackButton(true);
  const navigate = useNavigate();
  const open = (to: string) => { haptic("select"); navigate(to, { replace: true }); };
  const Row = ({ item: [to, title, description, icon] }: { item: Item }) => (
    <button type="button" className="nt-item" onClick={() => open(to)}>
      <span className="nt-item__icon"><Icon name={icon} size={22} /></span>
      <span className="nt-item__body"><b>{title}</b><small>{description}</small></span>
      <Icon name="chevron" size={18} />
    </button>
  );
  return (
    <Screen className="newtab">
      <h1 className="nt-heading">What would you like to explore?</h1>
      <button type="button" className="nt-search" onClick={() => open("/search")}><Icon name="search" size={20} /><span>A passage, a tab, a tool…</span></button>
      <h2 className="shelf">Read and explore</h2>
      <button type="button" className="nt-hero" onClick={() => open("/bible")}>
        <span className="nt-hero__icon"><Icon name="book-open" size={64} /></span>
        <span className="nt-hero__body"><b>Bible</b><small>Open the Bible and start reading</small></span>
        <Icon name="chevron" size={22} />
      </button>
      <div className="nt-list">{READ.map((i) => <Row key={i[0]} item={i} />)}</div>
      <h2 className="shelf">Classes and notes</h2>
      <div className="nt-list">{PERSONAL.map((i) => <Row key={i[0]} item={i} />)}</div>
      <h2 className="shelf">Library</h2>
      <div className="nt-list">{LIBRARY.map((i) => <Row key={i[0]} item={i} />)}</div>
    </Screen>
  );
}

/** The groups: switch, create, rename or delete (Bible Strong's GroupActionsPopover and ViewGroupsModal). */
function useGroupActions() {
  const sheet = useSheet();
  const { group, groups } = useTabs();
  const pickColor = async (title: string, on?: string) => {
    const c = await sheet.open({ title, colors: GROUP_COLORS.map((css, i) => ({ id: css, label: `Colour ${i + 1}`, css, on: css === on })) });
    return c?.id;
  };
  const createGroup = async () => {
    if (groups.length >= MAX_GROUPS) { await sheet.open({ title: `You can keep ${MAX_GROUPS} groups. Delete one to make another.` }); return; }
    const name = await sheet.open({ title: "New group", text: { label: "Name", placeholder: `Group ${groups.length + 1}`, submit: "Next" } });
    if (!name) return;
    const color = (await pickColor("Its colour")) ?? GROUP_COLORS[groups.length % GROUP_COLORS.length];
    if (newGroup(name.value ?? "", color)) haptic("success");
  };
  const editGroup = async () => {
    const name = await sheet.open({ title: "Rename the group", text: { label: "Name", value: group.name, submit: "Next" } });
    if (!name) return;
    const color = (await pickColor("Its colour", group.color)) ?? group.color;
    renameGroup(group.id, name.value ?? group.name, color);
  };
  return async () => {
    haptic("select");
    const a = await sheet.open({
      title: "Groups",
      items: [
        ...groups.map((g) => ({ id: `g:${g.id}`, text: `${g.id === group.id ? "✓ " : ""}${groupLabel(g)}`, hint: `${g.tabs.length} ${g.tabs.length === 1 ? "tab" : "tabs"}`, icon: <span className="groupdot" style={{ background: g.color }} /> })),
        { id: "new", text: "New group", icon: <Icon name="plus" size={18} /> },
        ...(isDefault(group) ? [] : [{ id: "edit", text: `Rename “${group.name}”`, icon: <Icon name="compose" size={18} /> }]),
        { id: "delete", text: isDefault(group) ? "Close every tab" : `Delete “${group.name}” and its tabs`, destructive: true, icon: <Icon name="trash" size={18} /> },
      ],
    });
    if (!a) return;
    if (a.id.startsWith("g:")) { switchGroup(a.id.slice(2)); haptic("select"); return; }
    if (a.id === "new") await createGroup();
    else if (a.id === "edit") await editGroup();
    else if (a.id === "delete") { const ok = await sheet.open({ title: isDefault(group) ? "Close every tab?" : `Delete “${group.name}”?`, items: [{ id: "yes", text: isDefault(group) ? "Close them all" : "Delete the group", destructive: true }] }); if (ok) { deleteGroup(group.id); haptic("success"); } }
  };
}
/** The first group is Bible Strong's default group: it has no name of its own, only its count. */
const isDefault = (g: Group) => g.name === DEFAULT_GROUP;
const groupLabel = (g: Group) => (isDefault(g) ? `${g.tabs.length} ${g.tabs.length === 1 ? "tab" : "tabs"}` : g.name);

/**
 * The bottom bar while the switcher is open (Bible Strong's BottomTabBar in list mode): a new
 * tab, the group's name (the default group shows its count) which opens the groups, and OK.
 */
export function SwitcherBar() {
  const navigate = useNavigate();
  const { tabs, current, group } = useTabs();
  const openGroups = useGroupActions();
  const go = (resolve: () => string) => { haptic("select"); moveTab(() => { navigate(resolve(), { replace: true }); }, "expand"); };
  const add = () => {
    reflowTabs(() => newTab());
    document.querySelector(".tabcard[data-current]")?.scrollIntoView({ block: "nearest", behavior: "instant" });
    go(() => "/new");
  };
  const named = !isDefault(group);
  return (
    <div className="switcherbar" role="toolbar" aria-label="Tabs">
      <button type="button" className="switcherbar__add" aria-label="Add a tab" title="Add a tab" onClick={add}><Icon name="plus" size={24} /></button>
      <button type="button" className="switcherbar__group" aria-label={`${groupLabel(group)}. Groups`} title={`${groupLabel(group)}. Groups`} onClick={() => void openGroups()}
        style={named ? { ["--group" as string]: group.color } : undefined}>
        <span>{groupLabel(group)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button type="button" className="switcherbar__ok" aria-label="Open the selected tab" title="Open the selected tab" onClick={() => go(() => tabs.find((t) => t.id === current)?.path ?? "/new")}>OK</button>
    </div>
  );
}

/**
 * Bible Strong's tab switcher (AppSwitcherScreen, StaticTabPreview): the current group's tabs,
 * two to a row, 20 px apart, each a card as tall as the screen's proportions allow with a 40 px
 * title bar (icon, title, ✕) over a round icon. A sideways swipe moves between groups.
 */
export function Tabs() {
  const navigate = useNavigate();
  const { tabs, current } = useTabs();
  const go = (id: string) => { haptic("select"); moveTab(() => { navigate(selectTab(id), { replace: true }); }, "expand", id); };
  useBackButton(false, () => { go(current); return true; });
  useEffect(() => {
    const back = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("[data-sheet-open]")) { event.preventDefault(); go(current); }
    };
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [current, navigate]); // eslint-disable-line react-hooks/exhaustive-deps
  // Card size: two per row with 20 px margins and gap; height from the screen's proportions x 0.7.
  const [size, setSize] = useState(() => cardSize());
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = container.current!;
    const measure = () => {
      const next = cardSize(element.clientWidth);
      setSize(previous => previous.w === next.w && previous.h === next.h && previous.perRow === next.perRow ? previous : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const start = useRef<{ x: number; y: number } | null>(null);
  const onStart = (e: React.TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY }; };
  const onEnd = (e: React.TouchEvent) => {
    const s0 = start.current; start.current = null; if (!s0) return;
    const t = e.changedTouches[0], dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const id = adjacentGroup(dx < 0 ? 1 : -1);
    if (id) { switchGroup(id); haptic("select"); }
  };

  return (
    <main ref={container} className="switcher" aria-label="Your tabs" onTouchStart={onStart} onTouchEnd={onEnd} onTouchCancel={() => { start.current = null; }}>
      <div className="switcher__grid" style={{ gridTemplateColumns: `repeat(${size.perRow}, ${size.w}px)` }}>
        {tabs.map((t) => {
          const { icon } = tabKind(t.path);
          const title = tabTitle(t.path);
          return (
            <div key={t.id} className="tabcard" data-tab-id={t.id} data-current={t.id === current ? "" : undefined} style={{ width: size.w, height: size.h }}>
              <button type="button" className="tabcard__open" onClick={() => go(t.id)} aria-label={`Open ${title}`} title={`Open ${title}`}>
                <TabPreview path={t.path} />
                <span className="tabcard__icon"><Icon name={icon as IconName} size={30} /></span>
              </button>
              <span className="tabcard__title"><Icon name={icon as IconName} size={16} /><b>{title}</b></span>
              <button type="button" className="tabcard__close" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={() => {
                haptic("select"); reflowTabs(() => closeTab(t.id));
                document.querySelector<HTMLButtonElement>(".tabcard[data-current] .tabcard__open")?.focus({ preventScroll: true });
              }}>
                <span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></span>
              </button>
            </div>
          );
        })}
      </div>
    </main>
  );
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
