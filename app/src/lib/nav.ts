import { readerRouteAllowed } from "@/native/platform";
import type { IconName } from "@/ui/ui";

/** The app's main sections, each with the paths it covers. */
export type NavId = "home" | "search" | "bible" | "classes" | "ask" | "tabs" | "library" | "plan" | "bookmarks" | "sabbath" | "precepts" | "law" | "people" | "lexicon" | "history";
export type NavItem = { id: NavId; label: string; icon: IconName | "count"; path: string; match: RegExp };

const ALL_NAV_ITEMS: NavItem[] = [
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

export const NAV_ITEMS = ALL_NAV_ITEMS.filter(item => readerRouteAllowed(item.path));
