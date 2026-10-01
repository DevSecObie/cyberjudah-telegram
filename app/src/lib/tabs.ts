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
/** A tab group (Bible Strong's TabGroup): its own tabs and its own current tab, a name and a colour. */
export type Group = { id: string; name: string; color: string; tabs: Tab[]; current: string };
type State = { groups: Group[]; group: string };

const KEY = "cj:tabgroups";
const OLD_KEY = "cj:tabs";
const NOT_TABS = /^\/(|more|tabs)(\?|$)/;
/** Bible Strong allows a handful of groups; so do we. */
export const MAX_GROUPS = 8;
/** The first group's name: Bible Strong's default group, shown by its count, never renamed. */
export const DEFAULT_GROUP = "My tabs";
export const GROUP_COLORS = ["#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#f87171", "#94a3b8"];
const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const freshGroup = (name: string, color: string, path = "/new"): Group => { const t = { id: uid(), path }; return { id: uid(), name, color, tabs: [t], current: t.id }; };
const valid = (g: Group) => Array.isArray(g.tabs) && g.tabs.length > 0 && g.tabs.some((t) => t.id === g.current);

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (s && Array.isArray(s.groups) && s.groups.length && s.groups.every(valid) && s.groups.some((g) => g.id === s.group)) return s;
    // Tabs kept before groups existed become the first group.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "null") as { tabs: Tab[]; current: string } | null;
    if (old && Array.isArray(old.tabs) && old.tabs.length && old.tabs.some((t) => t.id === old.current)) {
      const g = { id: uid(), name: "My tabs", color: GROUP_COLORS[0], tabs: old.tabs, current: old.current };
      return { groups: [g], group: g.id };
    }
  } catch { /* private mode */ }
  const g = freshGroup("My tabs", GROUP_COLORS[0], "/bible");
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
export const currentTab = () => { const g = group(); return g.tabs.find((t) => t.id === g.current) ?? g.tabs[0]; };

export const isTabPath = (path: string) => !NOT_TABS.test(path);
/**
 * Where the app is now becomes the current tab's place. Coming from Home or the menu (which
 * are not tabs) to somewhere new opens it in a new tab, as Bible Strong's Home does, unless the
 * current tab is still an empty New Tab page.
 */
export function recordPath(path: string, fromOutside: boolean) {
  if (!isTabPath(path)) return;
  const g = group(), cur = currentTab();
  if (cur.path === path) return;
  if (fromOutside && !cur.path.startsWith("/new")) { const found = g.tabs.find((t) => t.path === path); if (found) selectTab(found.id); else newTab(path); return; }
  setGroup({ ...g, tabs: g.tabs.map((t) => (t.id === cur.id ? { ...t, path } : t)) });
}
/** A new tab in the current group, on the New Tab page by default; returns its path. */
export function newTab(path = "/new"): string {
  const g = group(), t = { id: uid(), path };
  setGroup({ ...g, tabs: [...g.tabs, t], current: t.id });
  return path;
}
export function selectTab(id: string): string {
  const g = group(), t = g.tabs.find((x) => x.id === id) ?? g.tabs[0];
  setGroup({ ...g, current: t.id });
  return t.path;
}
/** Close a tab; the last tab of a group is never closed, it goes back to the New Tab page. */
export function closeTab(id: string) {
  const g = group();
  if (g.tabs.length === 1) { setGroup({ ...g, tabs: [{ ...g.tabs[0], path: "/new" }], current: g.tabs[0].id }); return; }
  const tabs = g.tabs.filter((t) => t.id !== id);
  setGroup({ ...g, tabs, current: g.current === id ? tabs[tabs.length - 1].id : g.current });
}
/** Close every tab of the current group. */
export function closeAll() { const g = group(), t = { id: uid(), path: "/new" }; setGroup({ ...g, tabs: [t], current: t.id }); }

/** A new group (Bible Strong's CreateGroupPage), made current, starting on the New Tab page. */
/** The open tab before or after the current one in its group, selected: its path, or null at either end. */
export function adjacentTab(step: 1 | -1): string | null {
  const g = group(), i = g.tabs.findIndex((t) => t.id === g.current), t = g.tabs[i + step];
  return t ? selectTab(t.id) : null;
}

export function newGroup(name: string, color: string): string | null {
  if (state.groups.length >= MAX_GROUPS) return null;
  const g = freshGroup(name.trim() || `Group ${state.groups.length + 1}`, color);
  set({ groups: [...state.groups, g], group: g.id });
  return g.tabs[0].path;
}
/** Switch group; returns the path of that group's current tab. */
export function switchGroup(id: string): string {
  const g = state.groups.find((x) => x.id === id) ?? state.groups[0];
  set({ ...state, group: g.id });
  return (g.tabs.find((t) => t.id === g.current) ?? g.tabs[0]).path;
}
export function renameGroup(id: string, name: string, color?: string) {
  set({ ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name, color: color ?? g.color } : g)) });
}
/** Delete a group and its tabs; the last group is never deleted, it is emptied. */
export function deleteGroup(id: string) {
  if (state.groups.length === 1) { closeAll(); return; }
  const groups = state.groups.filter((g) => g.id !== id);
  set({ groups, group: state.group === id ? groups[0].id : state.group });
}
/** The group before or after the current one, for swiping between groups. */
export function adjacentGroup(step: 1 | -1): string | null {
  const i = state.groups.findIndex((g) => g.id === state.group) + step;
  return i >= 0 && i < state.groups.length ? state.groups[i].id : null;
}

/** Bible Strong's Bible and Search buttons: the current tab if it is one, else the latest such tab, else a new one. */
function tabOfKind(test: (p: string) => boolean, fresh: string): string {
  const g = group(), cur = currentTab();
  if (test(cur.path)) return cur.path;
  const t = [...g.tabs].reverse().find((x) => test(x.path));
  if (t) return selectTab(t.id);
  if (cur.path.startsWith("/new")) { setGroup({ ...g, tabs: g.tabs.map((x) => (x.id === cur.id ? { ...x, path: fresh } : x)) }); return fresh; }
  return newTab(fresh);
}
export const bibleTabPath = () => tabOfKind((p) => /^\/(bible|read)(\/|$)/.test(p), "/bible");
export const searchTabPath = () => tabOfKind((p) => /^\/search(\?|$)/.test(p), "/search");
/** Ask CyberJudah, the same way: its tab if one is open, else a new one. */
export const askTabPath = () => tabOfKind((p) => /^\/ask(\/|\?|$)/.test(p), "/ask");

/** A tab's name and kind from its path, for the switcher's cards. */
const KINDS: [RegExp, string, string][] = [
  [/^\/new/, "New tab", "compose"], [/^\/(bible|read)/, "Bible", "book-open"], [/^\/search/, "Search", "search"], [/^\/lexicon/, "Strong", "spark"],
  [/^\/dictionary/, "Dictionary", "type"], [/^\/topics/, "Topics", "tag"], [/^\/(person|people)/, "People", "star"], [/^\/(classes|note|watch)/, "Classes", "play"],
  [/^\/history/, "Our Hidden History", "history"], [/^\/books/, "Library", "layers"], [/^\/encyclopedia/, "Encyclopedia", "book"], [/^\/law/, "The Law", "law"],
  [/^\/precepts/, "Precepts", "quote"], [/^\/cases/, "Case studies", "folder"], [/^\/plan/, "Reading plan", "check"], [/^\/study/, "4 Chapters a Day", "book"],
  [/^\/(bookmarks|tags)/, "Kept", "bookmark"], [/^\/ask/, "Ask CyberJudah", "chat"], [/^\/relations/, "Relations", "merge"], [/^\/sabbath/, "Sabbath", "sun"], [/^\/settings/, "Settings", "gear"],
];
export function tabKind(path: string): { kind: string; icon: string } {
  const k = KINDS.find(([re]) => re.test(path));
  return { kind: k?.[1] ?? "Page", icon: k?.[2] ?? "layers" };
}
/** The place itself: "Genesis 1", "H430", a class title's slug, in words. */
export function tabPlace(path: string): string {
  const p = path.split(/[?#]/)[0].split("/").filter(Boolean);
  const words = (s: string) => decodeURIComponent(s).replace(/[-_]+/g, " ").replace(/^\d{4} \d{2} \d{2} /, "").replace(/\b\w/g, (c) => c.toUpperCase());
  if ((p[0] === "bible" || p[0] === "read") && p[1]) return `${APOCRYPHA.find(([slug]) => slug === p[1])?.[1] ?? words(p[1])}${p[2] ? ` ${p[2]}` : ""}`;
  if (p[0] === "lexicon" && p[1]) return p[1].toUpperCase();
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
