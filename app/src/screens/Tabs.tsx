import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { data } from "@/api/data";
import { useNavigate } from "react-router";

import { adjacentGroup, closeAll, closeTab, deleteGroup, GROUP_COLORS, isDefaultGroup, MAX_GROUPS, newGroup, newTab, renameGroup, selectTab, switchGroup, tabKind, tabTitle, useTabs, type Group } from "@/lib/tabs";
import { assetUrl } from "@/lib/asset";
import { useSheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Icon, Screen, type IconName } from "@/ui/ui";
import { closeTabCard, moveTab, reflowTabs } from "@/ui/tab-motion";

/** Bible Strong's New Tab page (TabScreen/NewTab/NewTabContent): every resource, by section, each opening in this tab. */
type Item = [to: string, title: string, description: string, icon: IconName];
const READ: Item[] = [
  ["/plans", "Reading plans", "Choose a plan or resume your reading", "check"],
  ["/study", "4 Chapters a Day", "The daily reading, a note for every chapter", "book"],
  ["/classes?feed=history", "Our Hidden History", "Explore our history, episode by episode", "history"],
];
const PERSONAL: Item[] = [
  ["/studies", "My studies", "Your writing, scripture and word studies", "compose"],
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
  useBackButton();
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
      <button type="button" className="nt-search" onClick={() => window.dispatchEvent(new Event("cj:commands"))}><Icon name="search" size={20} /><span>A passage, a tab, a tool…</span></button>
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
  const toast = useToast();
  const { group, groups } = useTabs();
  const pickColor = async (title: string, on?: string) => {
    const c = await sheet.open({ title, colors: GROUP_COLORS.map((css, i) => ({ id: css, label: `Colour ${i + 1}`, css, on: css === on })) });
    return c?.id;
  };
  // Bible Strong's CreateGroupPage: a name is required, the first colour is chosen until another is.
  const createGroup = async () => {
    const name = await sheet.open({ title: "New group", text: { label: "Name", placeholder: "Group name", submit: "Next" } });
    if (!name?.value?.trim()) return;
    if (groups.length >= MAX_GROUPS) { toast("Group limit reached", { tone: "error" }); return; }
    const color = (await pickColor("Its colour")) ?? GROUP_COLORS[0];
    newGroup(name.value, color);
  };
  const editGroup = async () => {
    const name = await sheet.open({ title: "Rename the group", text: { label: "Name", value: group.name, submit: "Next" } });
    if (!name) return;
    const color = (await pickColor("Its colour", group.color)) ?? group.color;
    renameGroup(group.id, name.value ?? group.name, color);
  };
  return async () => {
    const a = await sheet.open({
      title: "Groups",
      items: [
        // Bible Strong's GroupActionsPopover: Close all tabs on every group, with no question asked.
        { id: "closeall", text: "Close all tabs", icon: <Icon name="close" size={18} /> },
        ...groups.map((g) => ({ id: `g:${g.id}`, text: `${g.id === group.id ? "✓ " : ""}${groupLabel(g)}`, hint: `${g.tabs.length} ${g.tabs.length === 1 ? "tab" : "tabs"}`, icon: <span className="groupdot" style={{ background: g.color }} /> })),
        { id: "new", text: "New group", icon: <Icon name="plus" size={18} /> },
        ...(isDefault(group) ? [] : [
          { id: "edit", text: `Rename “${group.name}”`, icon: <Icon name="compose" size={18} /> },
          { id: "delete", text: "Delete group", destructive: true, icon: <Icon name="trash" size={18} /> },
        ]),
      ],
    });
    if (!a) return;
    if (a.id === "closeall") { closeAll(group.id); return; }
    if (a.id.startsWith("g:")) { switchGroup(a.id.slice(2)); return; }
    if (a.id === "new") await createGroup();
    else if (a.id === "edit") await editGroup();
    else if (a.id === "delete") { const ok = await sheet.open({ title: "Delete group?", items: [{ id: "yes", text: "All tabs in this group will be closed.", destructive: true }] }); if (ok) deleteGroup(group.id); }
  };
}
/** Bible Strong's default group: it has no name of its own, only its count. */
const isDefault = isDefaultGroup;
const groupLabel = (g: Group) => (isDefault(g) ? `${g.tabs.length} ${g.tabs.length === 1 ? "tab" : "tabs"}` : g.name);

/**
 * The bottom bar while the switcher is open (Bible Strong's BottomTabBar in list mode): a new
 * tab, the group's name (the default group shows its count) which opens the groups, and OK.
 */
export function SwitcherBar() {
  const navigate = useNavigate();
  const { tabs, current, group } = useTabs();
  const openGroups = useGroupActions();
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
      <button type="button" className="switcherbar__group" aria-label={`${groupLabel(group)}. Groups`} onClick={() => void openGroups()}
        style={named ? { ["--group" as string]: group.color, ["--group-ink" as string]: contrastInk(group.color) } : undefined}>
        <span>{groupLabel(group)}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <button type="button" className="switcherbar__ok" aria-label="Open selected tab" onClick={ok}>OK</button>
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
  const { tabs, current, group } = useTabs();
  const go = (id: string) => { moveTab(() => { navigate(selectTab(id), { replace: true }); }, "expand", id); };
  // Bible Strong's switcher has no Back: it closes with OK or a card.
  useBackButton(() => true, false, true);
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
    if (id) switchGroup(id);
  };

  return (
    <main ref={container} className="switcher" aria-label="Your tabs" onTouchStart={onStart} onTouchEnd={onEnd} onTouchCancel={() => { start.current = null; }}>
      {!tabs.length ? <EmptyGroup /> : isDefault(group) ? null : <GroupHeader group={group} />}
      <div className="switcher__grid" style={{ gridTemplateColumns: `repeat(${size.perRow}, ${size.w}px)` }}>
        {tabs.map((t) => {
          const title = tabTitle(t.path);
          return (
            <div key={t.id} className="tabcard" data-tab-id={t.id} data-current={t.id === current ? "" : undefined} style={{ width: size.w, height: size.h }}>
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
    </main>
  );
}
/**
 * Bible Strong's GroupHeader (TabGroupPage), over a named group's tabs: its count on a 24 px
 * square of its colour, then its name at 30 px, made smaller to fit 70% of the screen, never under 20.
 */
function GroupHeader({ group }: { group: Group }) {
  const name = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(30);
  useLayoutEffect(() => {
    const el = name.current; if (!el) return;
    el.style.fontSize = "30px";
    // The text's own line, as React Native's onTextLayout gives it, not the row it sits in.
    const range = document.createRange(); range.selectNodeContents(el);
    const width = range.getBoundingClientRect().width, max = innerWidth * 0.7;
    setSize(width > max ? Math.max(30 * (max / width), 20) : 30);
  }, [group.name]);
  return (
    <header key={group.id} className="switcher__group">
      <span className="switcher__badge" style={{ background: group.color, color: contrastInk(group.color) }}>{group.tabs.length}</span>
      <span ref={name} className="switcher__name" style={{ fontSize: size }}>{group.name}</span>
    </header>
  );
}

/**
 * Bible Strong's tab icons (getIconByTabType) for the kinds we share, in their universe's colour
 * (themes/universeColors); our other kinds keep their own icon, in the tertiary colour.
 */
const BS_ICONS: [RegExp, string, string][] = [
  [/^\/new/, "plus", "grey"], [/^\/(bible|read)/, "book-open", "tertiary"], [/^\/search/, "search", "tertiary"], [/^\/lexicon/, "lexique", "primary"],
  [/^\/dictionary/, "dictionary", "secondary"], [/^\/topics/, "nave", "quint"], [/^\/studies/, "feather", "tertiary"], [/^\/(bookmarks|tags)/, "file-text", "color2"],
];
const MATERIAL: [RegExp, string][] = [
  [/^\/(plans?|study)(\/|\?|$)/, "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z"],
  [/^\/timeline/, "M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z"],
];
export function TabIcon({ path, size }: { path: string; size: number }) {
  const art = BS_ICONS.find(([re]) => re.test(path));
  if (art) return <span className={`tabicon tabicon--${art[2]}`} aria-hidden="true" style={{ width: size, height: size, ["--icon" as string]: `url("${assetUrl(`bs/tab-icons/${art[1]}.svg`)}")` }} />;
  const material = MATERIAL.find(([re]) => re.test(path));
  if (material) return <svg className="tabicon--tertiary" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={material[1]} /></svg>;
  return <span className="tabicon--tertiary" style={{ display: "contents" }}><Icon name={tabKind(path).icon as IconName} size={size} /></span>;
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
      <span className="switcher__empty-art" aria-hidden="true" style={{ ["--art" as string]: `url("${assetUrl("bs/tabs.svg")}")` }} />
      <button type="button" className="switcher__create" onClick={add}><Icon name="plus" size={20} /><b>Create a tab</b></button>
    </div>
  );
}
/** Bible Strong's AddTabButton: a new tab at the end of the group, opened from its card. */
function useAddTab() {
  const navigate = useNavigate();
  return () => {
    reflowTabs(() => newTab());
    // Bible Strong's useExpandNewTab: to the end of the list, a 300 ms pause, then the new card opens.
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    window.setTimeout(() => moveTab(() => { navigate("/new", { replace: true }); }, "expand"), 300);
  };
}
/** The group's name on its colour (getContrastTextColor): in dark, black on a light colour; in light, white on a dark one. */
function contrastInk(hex: string) {
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
