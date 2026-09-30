import { useSyncExternalStore } from "react";

/**
 * Bible Strong's tabs (features/app-switcher), on our screens: each tab is a place in the app,
 * kept by its path. The Bible, the lexicon, a class, a topic: each opens in the current tab,
 * a new tab starts on the New Tab page, and the tab switcher shows them all. Home, the menu
 * (More) and the switcher itself are not tabs, as in Bible Strong where Home and the menu are
 * drawers over the tabs. Kept on the device, per reader.
 */
export type Tab = { id: string; path: string };
type State = { tabs: Tab[]; current: string };

const KEY = "cj:tabs";
const NOT_TABS = /^\/(|more|tabs)(\?|$)/;
const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (s && Array.isArray(s.tabs) && s.tabs.length && s.tabs.some((t) => t.id === s.current)) return s;
  } catch { /* private mode */ }
  const first = { id: uid(), path: "/bible" };
  return { tabs: [first], current: first.id };
}
let state = load();
const listeners = new Set<() => void>();
const set = (next: State) => { state = next; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export const useTabs = () => useSyncExternalStore(subscribe, () => state);
export const currentTab = () => state.tabs.find((t) => t.id === state.current) ?? state.tabs[0];

export const isTabPath = (path: string) => !NOT_TABS.test(path);
/**
 * Where the app is now becomes the current tab's place. Coming from Home or the menu (which
 * are not tabs) to somewhere new opens it in a new tab, as Bible Strong's Home does, unless the
 * current tab is still an empty New Tab page.
 */
export function recordPath(path: string, fromOutside: boolean) {
  if (!isTabPath(path)) return;
  const cur = currentTab();
  if (cur.path === path) return;
  if (fromOutside && !cur.path.startsWith("/new")) { const found = state.tabs.find((t) => t.path === path); if (found) selectTab(found.id); else newTab(path); return; }
  set({ ...state, tabs: state.tabs.map((t) => (t.id === cur.id ? { ...t, path } : t)) });
}
/** A new tab on the New Tab page; returns its path. */
export function newTab(path = "/new"): string {
  const t = { id: uid(), path };
  set({ tabs: [...state.tabs, t], current: t.id });
  return path;
}
export function selectTab(id: string): string {
  const t = state.tabs.find((x) => x.id === id) ?? state.tabs[0];
  set({ ...state, current: t.id });
  return t.path;
}
/** Close a tab; the last tab left is never closed, it goes back to the New Tab page. */
export function closeTab(id: string) {
  if (state.tabs.length === 1) { set({ tabs: [{ ...state.tabs[0], path: "/new" }], current: state.tabs[0].id }); return; }
  const tabs = state.tabs.filter((t) => t.id !== id);
  set({ tabs, current: state.current === id ? tabs[tabs.length - 1].id : state.current });
}
export function closeAll() { const t = { id: uid(), path: "/new" }; set({ tabs: [t], current: t.id }); }
/** Bible Strong's Bible and Search buttons: the current tab if it is one, else the latest such tab, else a new one. */
function tabOfKind(test: (p: string) => boolean, fresh: string): string {
  const cur = currentTab();
  if (test(cur.path)) return cur.path;
  const t = [...state.tabs].reverse().find((x) => test(x.path));
  if (t) return selectTab(t.id);
  if (cur.path.startsWith("/new")) { set({ ...state, tabs: state.tabs.map((x) => (x.id === cur.id ? { ...x, path: fresh } : x)) }); return fresh; }
  return newTab(fresh);
}
export const bibleTabPath = () => tabOfKind((p) => /^\/(bible|read)(\/|$)/.test(p), "/bible");
export const searchTabPath = () => tabOfKind((p) => /^\/search(\?|$)/.test(p), "/search");

/** A tab's name and kind from its path, for the switcher's cards. */
const KINDS: [RegExp, string, string][] = [
  [/^\/new/, "New tab", "compose"], [/^\/(bible|read)/, "Bible", "book"], [/^\/search/, "Search", "search"], [/^\/lexicon/, "Strong", "spark"],
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
  if ((p[0] === "bible" || p[0] === "read") && p[1]) return `${words(p[1])}${p[2] ? ` ${p[2]}` : ""}`;
  if (p[0] === "lexicon" && p[1]) return p[1].toUpperCase();
  if (p.length > 1) return words(p[p.length - 1]);
  return "";
}
