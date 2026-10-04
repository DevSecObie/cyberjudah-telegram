import { useStored } from "@/tg/hooks";
import type { IconName } from "@/ui/ui";

/**
 * What the bottom bar can hold. Bible Strong's bar is Home, Search, Bible, the tabs and the menu;
 * ours lets each reader choose and order up to MAX_NAV buttons. Menu follows those choices;
 * Search is derived as a fixed trailing control without migrating the saved array.
 */
export type NavId = "home" | "search" | "bible" | "classes" | "ask" | "tabs" | "library" | "plan" | "bookmarks" | "sabbath" | "precepts" | "law" | "people" | "lexicon" | "history";
export type NavItem = { id: NavId; label: string; icon: IconName | "count"; path: string; match: RegExp };

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: "home", path: "/", match: /^\/$/ },
  { id: "search", label: "Search", icon: "search", path: "/search", match: /^\/search/ },
  { id: "bible", label: "Bible", icon: "book-open", path: "/bible", match: /^\/(bible|read)(\/|$)/ },
  { id: "classes", label: "Classes", icon: "play", path: "/classes", match: /^\/(classes|note|watch)(\/|$)/ },
  { id: "ask", label: "Ask", icon: "chat", path: "/ask", match: /^\/ask(\/|\?|$)/ },
  { id: "tabs", label: "Tabs", icon: "count", path: "/tabs", match: /^\/tabs/ },
  { id: "library", label: "Library", icon: "layers", path: "/books", match: /^\/books/ },
  { id: "plan", label: "Reading plan", icon: "check", path: "/plan", match: /^\/plan/ },
  { id: "bookmarks", label: "Bookmarks", icon: "bookmark", path: "/bookmarks", match: /^\/bookmarks/ },
  { id: "sabbath", label: "Sabbath", icon: "sun", path: "/sabbath", match: /^\/sabbath/ },
  { id: "precepts", label: "Precepts", icon: "quote", path: "/precepts", match: /^\/precepts/ },
  { id: "law", label: "The Law", icon: "law", path: "/law", match: /^\/law/ },
  { id: "people", label: "People", icon: "star", path: "/people", match: /^\/(people|person)(\/|$)/ },
  { id: "lexicon", label: "Lexicon", icon: "spark", path: "/lexicon", match: /^\/lexicon/ },
  { id: "history", label: "History", icon: "clock", path: "/history", match: /^\/history/ },
];

export const MAX_NAV = 6;
export const DEFAULT_NAV: NavId[] = ["home", "search", "bible", "classes", "ask", "tabs"];
const KNOWN = new Set<string>(NAV_ITEMS.map((i) => i.id));

/** A stored choice, cleaned: known ids only, no repeats, at most MAX_NAV, never empty. */
export function cleanNav(ids: unknown): NavId[] {
  if (!Array.isArray(ids)) return DEFAULT_NAV;
  const out: NavId[] = [];
  for (const id of ids) if (typeof id === "string" && KNOWN.has(id) && !out.includes(id as NavId)) out.push(id as NavId);
  return out.length ? out.slice(0, MAX_NAV) : DEFAULT_NAV;
}

export const navItem = (id: NavId) => NAV_ITEMS.find((i) => i.id === id)!;

export function useNav(): [NavId[], (ids: NavId[]) => void] {
  const [ids, setIds] = useStored<NavId[]>("nav", DEFAULT_NAV);
  return [cleanNav(ids), (next) => setIds(cleanNav(next))];
}
