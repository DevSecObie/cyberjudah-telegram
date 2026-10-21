// Speed measurements (Core Web Vitals) the app sends once per visit, and the server's check of
// them before they are written to Analytics Engine. Nothing in them identifies a reader: the
// screen area the visit started in, the platform, how the page was opened, the connection type
// the browser reports, and the timings. docs/PRIVACY.md, "Speed measurements".

/** Each measurement and its largest believable value (milliseconds; CLS is a unitless score). */
export const METRICS = { TTFB: 60_000, FCP: 60_000, LCP: 60_000, INP: 60_000, CLS: 50 };
export const PLATFORMS = ["telegram", "ios", "android", "web"];
export const NAVIGATIONS = ["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"];
export const CONNECTIONS = ["slow-2g", "2g", "3g", "4g"];
const AREAS = ["read", "bible", "search", "classes", "watch", "ask", "note", "more", "settings", "plans", "plan", "history", "dictionary", "lexicon", "people", "person", "tags", "books", "timeline", "new", "tabs", "resources", "privacy"];

/** The screen area of an app path ("/app/read/genesis/1" → "read"), never the rest of the path. */
export function area(path) {
  const first = String(path).replace(/^\/app(?=\/|$)/, "").split("/")[1] ?? "";
  return first === "" ? "home" : AREAS.includes(first) ? first : "other";
}

/** The Analytics Engine data points for a report the app sends, or null for anything else. */
export function vitalsPoints(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { area: where, platform, nav, conn, metrics } = body;
  if (!(where === "home" || where === "other" || AREAS.includes(where))) return null;
  if (!PLATFORMS.includes(platform) || !NAVIGATIONS.includes(nav)) return null;
  if (conn !== undefined && !CONNECTIONS.includes(conn)) return null;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return null;
  const names = Object.keys(metrics);
  if (names.length === 0 || names.some((n) => !Object.hasOwn(METRICS, n))) return null;
  const points = [];
  for (const name of names) {
    const value = metrics[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > METRICS[name]) return null;
    points.push({ indexes: [name], blobs: [name, where, platform, nav, conn ?? "unknown"], doubles: [value] });
  }
  return points;
}
