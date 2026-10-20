import { useSyncExternalStore } from "react";
import { APOCRYPHA } from "@/api/data";

/**
 * Bible Strong's tabs (features/app-switcher), on our screens: each tab is a place in the app,
 * kept by its path. The Bible, the lexicon, a class, a topic: each opens in the current tab,
 * a new tab starts on the New Tab page, and the tab switcher shows them all. Home, the menu
 * (More) and the switcher itself are not tabs, as in Bible Strong where Home and the menu are
 * drawers over the tabs. Kept on the device, per reader.
 */
export type Tab = { id: string; path: string };
/**
 * A tab group (Bible Strong's TabGroup): its own tabs and its own current tab ("" while it has
 * none), a name and a colour. The default group has no colour, is never renamed or deleted, and
 * shows its count instead of its name.
 */
export type Group = { id: string; name: string; color: string; tabs: Tab[]; current: string; isDefault?: boolean; createdAt?: number };
type State = { groups: Group[]; group: string };

const KEY = "cj:tabgroups";
const OLD_KEY = "cj:tabs";
const NOT_TABS = /^\/(|more|tabs)(\?|$)/;
/** Bible Strong allows a handful of groups; so do we. */
export const MAX_GROUPS = 8;
/** The first group's name: Bible Strong's default group, shown by its count, never renamed. */
export const DEFAULT_GROUP = "My tabs";
/** Bible Strong's GROUP_COLORS; a new group starts on the first. */
export const GROUP_COLORS = ["#636e72", "#81ecec", "#74b9ff", "#a29bfe", "#fd79a8", "#ff7675", "#fdcb6e", "#55efc4", "#ffeaa7"];
/** Bible Strong's DEFAULT_GROUP_ID. */
export const DEFAULT_GROUP_ID = "default-group";
const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** Bible Strong's createDefaultGroup: one Bible tab, no colour. */
const defaultGroup = (): Group => { const t = { id: uid(), path: "/bible" }; return { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP, color: "", isDefault: true, tabs: [t], current: t.id, createdAt: 0 }; };
const valid = (g: Group) => !!g && typeof g.id === "string" && Array.isArray(g.tabs);
/**
 * A group may have no tabs (Bible Strong's empty group); a current tab that is gone falls back to
 * the first, as Bible Strong clamps its active index. The first group is the default one when
 * none is marked, and the default group has no colour.
 */
function normalize(s: State): State {
  const marked = s.groups.some((g) => g.isDefault);
  const groups = s.groups.map((g, i) => {
    const current = g.tabs.some((t) => t.id === g.current) ? g.current : g.tabs[0]?.id ?? "";
    const isDefault = marked ? !!g.isDefault : i === 0;
    return { ...g, current, isDefault, color: isDefault ? "" : g.color };
  });
  return { groups, group: groups.some((g) => g.id === s.group) ? s.group : groups[0].id };
}

// Whether tabs were kept from an earlier visit; a first launch, or a kept state too damaged to read, has none to reopen.
let kept = false;
function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (s && Array.isArray(s.groups) && s.groups.length && s.groups.every(valid)) { kept = true; return normalize(s); }
    // Tabs kept before groups existed become the first group.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null") as { tabs: Tab[]; current: string } | null;
    if (old && Array.isArray(old.tabs) && old.tabs.length && old.tabs.some((t) => t.id === old.current)) {
      const g: Group = { id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP, color: "", isDefault: true, tabs: old.tabs, current: old.current, createdAt: 0 };
      kept = true;
      return { groups: [g], group: g.id };
    }
  } catch { /* private mode */ }
  const g = defaultGroup();
  return { groups: [g], group: g.id };
}
let state = load();
const listeners = new Set<() => void>();
const set = (next: State) => { state = next; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const group = () => state.groups.find((g) => g.id === state.group) ?? state.groups[0];
/** Replace the current group, keeping the others. */
const setGroup = (g: Group) => set({ ...state, groups: state.groups.map((x) => (x.id === g.id ? g : x)) });

/** The current group's tabs and current tab (as before groups), and every group. */
export const useTabs = () => {
  const s = useSyncExternalStore(subscribe, () => state);
  const g = s.groups.find((x) => x.id === s.group) ?? s.groups[0];
  return { tabs: g.tabs, current: g.current, group: g, groups: s.groups };
};
/** The current group's current tab; none while the group is empty. */
export const currentTab = (): Tab | undefined => { const g = group(); return g.tabs.find((t) => t.id === g.current) ?? g.tabs[0]; };
/** Where to reopen at launch: the current tab if tabs were kept, or the switcher when its group is empty (Bible Strong's useBottomTabBar). */
export const keptPath = () => (kept ? currentTab()?.path ?? "/tabs" : undefined);
export const isDefaultGroup = (g: Group) => !!g.isDefault;
/** The current group and every group as they are now, outside React. */
export const currentGroup = () => group();
export const groupsNow = () => state.groups;

export const isTabPath = (path: string) => !NOT_TABS.test(path);

/**
 * Where the current tab's own history starts. In Bible Strong, Back never leaves the tab you are
 * in: changing tab is not a step you can go back over. A tab change (the bar, a swipe, the
 * switcher, a new tab) replaces the page in the browser's history, so the pages under it belong
 * to the tab you came from; Back stops at the page this tab was entered on.
 */
let floor = 0, entering = false;
const floorListeners = new Set<() => void>();
/** A tab change is under way: the next page shown is the first of the tab's own history. */
export const enterTab = () => { entering = true; };
/**
 * After a page is shown at a history index: a tab just entered starts its history there. A page
 * pushed, or a tab change that showed nothing new (`entered` false), leaves the start where it was.
 */
export function settleTabFloor(idx: number, entered = true) {
  const next = (entering && entered) || idx < floor ? idx : floor;
  entering = false;
  if (next !== floor) { floor = next; floorListeners.forEach((l) => l()); }
}
/** The history index Back may not go below. */
export const useTabFloor = () => useSyncExternalStore((l) => { floorListeners.add(l); return () => floorListeners.delete(l); }, () => floor);
/** Where the app is now becomes the current tab's place. */
export function recordPath(path: string) {
  if (!isTabPath(path)) return;
  const g = group(), cur = currentTab();
  // A group left with no tabs takes the place it is shown in as its first.
  if (!cur) { newTab(path); return; }
  if (cur.path === path) return;
  setGroup({ ...g, tabs: g.tabs.map((t) => (t.id === cur.id ? { ...t, path } : t)) });
}
/** A new tab in the current group, on the New Tab page by default; returns its path. */
export function newTab(path = "/new"): string {
  const g = group(), t = { id: uid(), path };
  setGroup({ ...g, tabs: [...g.tabs, t], current: t.id });
  enterTab();
  return path;
}
/** Select a tab of the current group; its path, or the switcher when the group has none. */
export function selectTab(id: string): string {
  const g = group(), t = g.tabs.find((x) => x.id === id) ?? g.tabs[0];
  if (!t) return "/tabs";
  setGroup({ ...g, current: t.id });
  enterTab();
  return t.path;
}
/**
 * Close a tab, the last one too (Bible Strong's useTabPreview): the group keeps the position of
 * its current tab, so the tab that slides into it becomes current, or the one before when the
 * last was closed.
 */
export function closeTab(id: string) {
  const g = group();
  if (!g.tabs.some((t) => t.id === id)) return;
  const at = Math.max(0, g.tabs.findIndex((t) => t.id === g.current));
  const tabs = g.tabs.filter((t) => t.id !== id);
  setGroup({ ...g, tabs, current: tabs[Math.min(at, tabs.length - 1)]?.id ?? "" });
  // Closing the tab you are in moves you into another.
  if (id === g.current) enterTab();
}
/** Close every tab of a group, leaving it empty (Bible Strong's closeAllTabsAtom). */
export function closeAll(id = state.group) {
  set({ ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, tabs: [], current: "" } : g)) });
}

/** The open tab before or after the current one in its group, selected: its path, or null at either end. */
export function adjacentTab(step: 1 | -1): string | null {
  const g = group(), i = g.tabs.findIndex((t) => t.id === g.current), t = g.tabs[i + step];
  return t ? selectTab(t.id) : null;
}

/** A new group (Bible Strong's createGroup): named, empty, made current; its id, or null at the limit or without a name. */
export function newGroup(name: string, color: string): string | null {
  if (state.groups.length >= MAX_GROUPS || !name.trim()) return null;
  const g: Group = { id: uid(), name: name.trim(), color, tabs: [], current: "", createdAt: Date.now() };
  set({ groups: [...state.groups, g], group: g.id });
  enterTab();
  return g.id;
}
/** Switch group; returns the path of that group's current tab, or the switcher when it has none. */
export function switchGroup(id: string): string {
  const g = state.groups.find((x) => x.id === id) ?? state.groups[0];
  set({ ...state, group: g.id });
  enterTab();
  return (g.tabs.find((t) => t.id === g.current) ?? g.tabs[0])?.path ?? "/tabs";
}
export function renameGroup(id: string, name: string, color?: string) {
  set({ ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name, color: color ?? g.color } : g)) });
}
/** Delete a group and its tabs; never the default group. The group before it becomes current (Bible Strong's GroupActionsPopover). */
export function deleteGroup(id: string) {
  const i = state.groups.findIndex((g) => g.id === id);
  if (i < 0 || state.groups[i].isDefault) return;
  const groups = state.groups.filter((g) => g.id !== id);
  set({ groups, group: state.group === id ? groups[Math.max(0, i - 1)].id : state.group });
}
/** The group before or after the current one, for swiping between groups. */
export function adjacentGroup(step: 1 | -1): string | null {
  const i = state.groups.findIndex((g) => g.id === state.group) + step;
  return i >= 0 && i < state.groups.length ? state.groups[i].id : null;
}

/** Bible Strong's Bible and Search buttons (BibleButton, useSearchButton): the group's first such tab, else a new one at the end. */
function tabOfKind(test: (p: string) => boolean, fresh: string): string {
  const t = group().tabs.find((x) => test(x.path));
  return t ? selectTab(t.id) : newTab(fresh);
}
/** A new Bible tab opens at Genesis 1:1 (Bible Strong's getDefaultBibleTab). */
const KIND_PATH = { bible: /^\/(bible|read)(\/|$)/, search: /^\/search(\?|$)/, ask: /^\/ask(\/|\?|$)/ };
export const bibleTabPath = () => tabOfKind((p) => KIND_PATH.bible.test(p), "/read/genesis/1");
export const searchTabPath = () => tabOfKind((p) => KIND_PATH.search.test(p), "/search");
/** Ask CyberJudah, the same way: its tab if one is open, else a new one. */
export const askTabPath = () => tabOfKind((p) => KIND_PATH.ask.test(p), "/ask");
/** Where the bar's button for a kind will land in the group: its first tab, or the end for a new one. */
export function kindTabIndex(kind: keyof typeof KIND_PATH): number {
  const tabs = group().tabs, at = tabs.findIndex((t) => KIND_PATH[kind].test(t.path));
  return at < 0 ? tabs.length : at;
}

/** A tab's name and kind from its path, for the switcher's cards. */
const KINDS: [RegExp, string, string][] = [
  [/^\/new/, "New tab", "compose"], [/^\/(bible|read)/, "Bible", "book-open"], [/^\/search/, "Search", "search"], [/^\/lexicon/, "Strong", "spark"],
  [/^\/dictionary/, "Dictionary", "type"], [/^\/topics/, "Topics", "tag"], [/^\/(person|people)/, "People", "star"], [/^\/(classes|note|watch)/, "Classes", "play"],
  [/^\/history/, "Recently viewed", "history"], [/^\/timeline/, "Bible timeline", "clock"], [/^\/books/, "Library", "layers"], [/^\/encyclopedia/, "Encyclopedia", "book"], [/^\/law/, "The Law", "law"],
  [/^\/precepts/, "Precepts", "quote"], [/^\/cases/, "Case studies", "folder"], [/^\/plans/, "Reading plans", "check"], [/^\/plan/, "Reading plan", "check"], [/^\/studies/, "My studies", "compose"], [/^\/study/, "4 Chapters a Day", "book"],
  [/^\/(bookmarks|tags)/, "Kept", "bookmark"], [/^\/ask/, "Ask CyberJudah", "chat"], [/^\/relations/, "Your precepts", "precepts"], [/^\/sabbath/, "Sabbath", "sun"], [/^\/settings/, "Settings", "gear"],
];
export function tabKind(path: string): { kind: string; icon: string } {
  const k = KINDS.find(([re]) => re.test(path));
  return { kind: k?.[1] ?? "Page", icon: k?.[2] ?? "layers" };
}
/** Settings' own pages, named as the Menu names them. */
const SETTINGS_PAGES: Record<string, string> = { requests: "Note requests", credits: "Credits" };
/** The place itself: "Genesis 1", "H430", a class title's slug, in words. */
export function tabPlace(path: string): string {
  const p = path.split(/[?#]/)[0].split("/").filter(Boolean);
  const words = (s: string) => decodeURIComponent(s).replace(/[-_]+/g, " ").replace(/^\d{4} \d{2} \d{2} /, "").replace(/\b\w/g, (c) => c.toUpperCase());
  if ((p[0] === "bible" || p[0] === "read") && p[1]) return `${APOCRYPHA.find(([slug]) => slug === p[1])?.[1] ?? words(p[1])}${p[2] ? ` ${p[2]}` : ""}`;
  if (p[0] === "lexicon" && p[1]) return p[1].toUpperCase();
  if (p[0] === "settings" && p[1]) return SETTINGS_PAGES[p[1]] ?? words(p[1]);
  if (p.length > 1) return words(p[p.length - 1]);
  return "";
}

/** Use the resource's own title instead of prefixing it with its tab kind. */
export function tabTitle(path: string): string {
  const place = tabPlace(path);
  if (/^\/(bible|read)\//.test(path)) return `${place} - KJV`;
  if (/^\/search(?:\?|$)/.test(path)) return new URLSearchParams(path.split("?")[1] ?? "").get("q")?.trim() || "Search";
  return place || tabKind(path).kind;
}
