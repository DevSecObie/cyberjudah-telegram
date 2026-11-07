/**
 * Telegram deep links. A Mini App link carries one `startapp` value, limited by Telegram to
 * A-Z a-z 0-9 _ - and 512 characters, so a page path is written with `_` for `/` (no slug in
 * the library uses an underscore). A Bible chapter may carry its verses as a last segment,
 * ranges joined by `x`, and the `bible_` prefix may be left off, so a person can type
 * `matthew_15_24` or `psalms_23`:
 *
 *   bible_matthew_15_24-26 ->  /bible/matthew/15?v=24-26#v24
 *   matthew_15_24x26     ->  /bible/matthew/15?v=24,26#v24
 *   classes_2026_slug    ->  /classes/2026/slug
 *   (empty)              ->  /
 *
 * startParamToPath gives that page on the website only when the site serves it (SITE_ROUTES);
 * the app has more screens than the site (people, timeline, settings, ...), so a param for one of
 * those has no site page (null) and the caller falls back to the site's home or the app.
 */

const SAFE = /^[A-Za-z0-9_-]{1,512}$/;
const SEGMENT = /^[a-z0-9-]+$/;
const VERSES = /^\d+(-\d+)?(x\d+(-\d+)?)*$/;

/**
 * The website's routes (cyberjudah repo, site/src/routes, TanStack file routes, as of a149538d):
 * ":x" is one path segment. A path the site has no route for 404s there.
 */
export const SITE_ROUTES = [
  "/", "/about", "/api", "/downloads", "/giving-the-sense", "/glossary", "/search", "/teachings", "/truth-shall-make-you-free",
  "/bible", "/bible/:book", "/bible/:book/:chapter",
  "/captains", "/captains/:year/:slug",
  "/cases", "/cases/:era/:slug",
  "/classes", "/classes/:year/:slug",
  "/concordance", "/concordance/:book",
  "/dictionary", "/dictionary/:slug",
  "/doctrine", "/doctrine/:slug",
  "/encyclopedia", "/encyclopedia/:slug",
  "/history", "/history/:year/:slug",
  "/law", "/law/:part", "/law/:part/:section",
  "/precepts", "/precepts/:slug",
  "/shows", "/shows/:slug",
  "/study", "/study/:book", "/study/:book/:chapter",
  "/topics", "/topics/:slug",
];
const ROUTE_SHAPES = SITE_ROUTES.map((r) => r.split("/").filter(Boolean));

/**
 * The app's screens the site doesn't have (app/src/App.tsx, first path segment). A start param that
 * begins with one of these, or with a site section, names that page; anything else is a Bible book.
 * app/tests/site-routes.test.mjs checks this list against App.tsx.
 */
export const APP_SECTIONS = [
  "ask", "bookmarks", "books", "class-books", "class-wikipedia", "credits", "delete-account", "highlights", "lexicon",
  "more", "nave", "new", "note", "notes", "people", "person", "place", "plan", "plans", "privacy", "read", "relations",
  "resources", "sabbath", "settings", "studies", "support", "tabs", "tags", "terms", "timeline", "watch",
];
const SECTIONS = new Set([...ROUTE_SHAPES.map((shape) => shape[0]).filter(Boolean), ...APP_SECTIONS]);

/** Does the website have a route for this path (its query and fragment aside)? */
export function siteServes(path) {
  const parts = String(path).replace(/[?#].*$/, "").split("/").filter(Boolean);
  return ROUTE_SHAPES.some((shape) => shape.length === parts.length && shape.every((s, i) => s.startsWith(":") || s === parts[i]));
}

/** The page a start param names, in the paths the site and the app share ("/" when it names none). */
export function startParamTarget(param) {
  if (typeof param !== "string" || !SAFE.test(param)) return "/";
  // A video id keeps its case and may hold "_": everything after "watch_" is the id.
  const video = /^watch_([A-Za-z0-9_-]+)$/i.exec(param);
  if (video) return `/watch/${video[1]}`;
  const parts = param.toLowerCase().split("_").filter(Boolean);
  if (!parts.length || !parts.every((p) => SEGMENT.test(p))) return "/";
  // The app's reader and note screens are the site's Bible chapter and note pages.
  if (parts[0] === "read") parts[0] = "bible";
  else if (parts[0] === "note" && SECTIONS.has(parts[1])) parts.shift();
  if (!SECTIONS.has(parts[0])) parts.unshift("bible");
  if (parts[0] === "bible" && parts.length === 4 && /^\d+$/.test(parts[2]) && VERSES.test(parts[3])) {
    const v = parts[3].replace(/x/g, ",");
    return `/bible/${parts[1]}/${parts[2]}?v=${v}#v${v.match(/^\d+/)[0]}`;
  }
  return `/${parts.join("/")}`;
}

/** The website page for a start param, or null when the site has no route for it (the caller
 *  falls back to the site's home or the app). An empty or malformed param is the home page. */
export function startParamToPath(param) {
  const path = startParamTarget(param);
  return siteServes(path) ? path : null;
}

export function pathToStartParam(pathname, verses) {
  const parts = String(pathname).split("/").filter(Boolean);
  if (parts[0] === "watch" && parts.length === 2 && /^[A-Za-z0-9_-]{1,500}$/.test(parts[1])) return `watch_${parts[1]}`;
  if (!parts.every((p) => SEGMENT.test(p))) return "";
  if (parts[0] === "bible" && parts.length === 3 && verses && /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(verses)) parts.push(verses.replace(/,/g, "x"));
  const param = parts.join("_");
  return param.length <= 512 ? param : "";
}

/** The t.me link that opens this page in the Mini App, or the plain site URL when none is configured. */
export function appLink(appUrl, siteUrl, pathname, verses) {
  if (!appUrl) return `${siteUrl}${pathname === "/" ? "" : pathname}${verses ? `?v=${verses}` : ""}`;
  const param = pathToStartParam(pathname, verses);
  return param ? `${appUrl}?startapp=${param}` : appUrl;
}

/**
 * The app's screen for a site path (routes in app/src/App.tsx). Every site path has one, so
 * links inside the notes and the law never leave the app.
 */
export function toAppPath(href) {
  let url;
  try { url = new URL(String(href), "https://app.invalid"); } catch { return "/"; }
  if (url.origin !== "https://app.invalid") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const [top] = parts;
  const q = url.search, h = url.hash;
  if (!top) return "/";
  if (top === "bible") {
    if (parts.length === 2) return `/bible?book=${parts[1]}`;
    if (parts.length === 3 && /^\d+$/.test(parts[2])) return `/read/${parts[1]}/${parts[2]}${q}${h}`;
    return "/bible";
  }
  if (["classes", "captains", "history", "study", "encyclopedia"].includes(top) && parts.length > 1) return `/note${url.pathname}${h}`;
  if (top === "truth-shall-make-you-free") return "/classes?feed=truth";
  if (top === "giving-the-sense") return "/classes?feed=sense";
  if (top === "shows") return parts.length === 2 ? `/classes?feed=shows&show=${parts[1]}` : "/classes?feed=shows";
  if (top === "captains" || top === "history") return `/classes?feed=${top}`;
  if (top === "teachings") return `/search?mode=said${q.replace("?", "&")}`;
  return url.pathname + q + h;
}

/** The site page each Classes feed is (toAppPath turns these pages into their feed). */
const FEED_PAGES = { sense: "/giving-the-sense", truth: "/truth-shall-make-you-free", captains: "/captains", history: "/history", shows: "/shows" };

/** The website page an app screen shows, for share links and "open in browser". A Classes feed
 *  with its own site page (?feed=sense, ?feed=truth, ...) gives that page; any other feed or
 *  filter, the site's /classes. */
export function sitePathOf(pathname) {
  const feedPage = classesFeedPage(String(pathname));
  if (feedPage) return feedPage;
  const bibleQuery = /^\/bible\/?\?([^#]*)/.exec(String(pathname));
  const book = bibleQuery && new URLSearchParams(bibleQuery[1]).get("book")?.toLowerCase();
  if (book && SEGMENT.test(book)) return `/bible/${book}`;
  const parts = String(pathname).split("/").filter(Boolean);
  if (parts[0] === "read" && parts.length === 3) return `/bible/${parts[1]}/${parts[2]}`;
  if (parts[0] === "note" && parts.length > 1) return `/${parts.slice(1).join("/")}`;
  if (["bible", "search", "classes", "law", "precepts", "doctrine", "cases", "topics", "encyclopedia", "glossary", "concordance", "study", "about"].includes(parts[0]?.replace(/[?#].*$/, ""))) return `/${parts.join("/")}`;
  return "/";
}

function classesFeedPage(pathname) {
  const m = /^\/classes\/?\?([^#]*)/.exec(pathname);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const page = FEED_PAGES[q.get("feed")];
  if (!page) return "/classes";
  const show = q.get("show");
  return page === "/shows" && show && SEGMENT.test(show) ? `/shows/${show}` : page;
}

/** Where a Telegram launch lands: the app screen for the start param. */
export function launchPath(param) {
  // The app has screens the site doesn't (people, timeline, settings): it reads the named page itself.
  return toAppPath(startParamTarget(param).split("#")[0]) ?? "/";
}
