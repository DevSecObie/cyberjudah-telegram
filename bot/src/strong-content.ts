import { Hono } from "hono";
import { orderTeachings } from "../../shared/teaching-order.mjs";
import { seriesLabel, seriesOf, showOf } from "../../shared/teaching-series";
import type { StrongTeaching, StrongTeachings } from "../../shared/strong-teachings";
import { dataJson } from "./data";
import type { Env } from "./env";
import { recentVideos, type RecentVideo } from "./live";

type SourceRow = {
  url: string; title: string; date?: string; teacher?: string; thumb?: string;
  videoId?: string; episode?: number;
};
type Broadcasts = Record<string, { date: string; broadcastAt: string }>;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const LABEL = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };

const videoOf = (row: SourceRow) => {
  const id = row.videoId || /(?:\/vi(?:_webp)?\/|\/img\/[a-z]+\/)([A-Za-z0-9_-]{11})(?=[/.])/.exec(row.thumb ?? "")?.[1];
  return id && VIDEO.test(id) ? id : undefined;
};

/** Same broadcast ordering, series labels and pending uploads as the existing Home. */
export function buildTeachings(
  sources: { classes: SourceRow[]; captains: SourceRow[]; history: SourceRow[] },
  recent: RecentVideo[], broadcasts: Broadcasts, origin: string, timeZone: string,
): StrongTeaching[] {
  const row = (kind: StrongTeaching["kind"]) => (source: SourceRow): StrongTeaching => {
    const video = videoOf(source);
    const thumb = source.thumb?.startsWith("/img/") ? `${origin}${source.thumb}` : source.thumb ?? "";
    return {
      kind, url: source.url, title: source.title, date: source.date ?? "", teacher: source.teacher ?? "",
      thumb, video, label: LABEL[kind],
      ...(kind === "history" && source.episode ? { sub: `Episode ${source.episode}` } : {}),
    };
  };
  const noted = [...sources.classes.map(row("class")), ...sources.captains.map(row("captains")), ...sources.history.map(row("history"))];
  const have = new Set(noted.map(t => t.video).filter(Boolean));
  const pending: StrongTeaching[] = [];
  for (const upload of recent) {
    if (!VIDEO.test(upload.video) || have.has(upload.video)) continue;
    have.add(upload.video);
    pending.push({
      kind: "class", url: `/watch/${upload.video}`, title: upload.title,
      date: upload.published.slice(0, 10), teacher: "", video: upload.video, pending: true,
      thumb: `https://i.ytimg.com/vi/${upload.video}/mqdefault.jpg`, label: LABEL.class,
    });
  }
  const ordered = orderTeachings([...noted, ...pending], broadcasts, timeZone);
  const series = seriesOf(ordered.filter(t => t.kind === "class").map(t => t.title));
  return ordered.map(t => {
    const named = series.get(t.title);
    return t.kind === "class" ? { ...t, label: named ? seriesLabel(named) : showOf(t.title) ?? t.label } : t;
  });
}

export const strongContent = new Hono<{ Bindings: Env }>();

strongContent.get("/teachings", async c => {
  const timeZone = c.req.query("timeZone") || "UTC";
  try {
    if (timeZone.length > 100) throw new Error("Invalid time zone");
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch { return c.json({ error: "Choose a valid time zone." }, 400); }
  const load = <T>(path: string) => dataJson<T>(c.env, path, c.executionCtx).catch(() => null);
  const [classes, captains, history, broadcasts, recent] = await Promise.all([
    load<SourceRow[]>("/search/classes.json"), load<SourceRow[]>("/search/captains.json"),
    load<SourceRow[]>("/api/history/index.json"), load<Broadcasts>("/api/classes/broadcasts.json"),
    recentVideos(c.env, c.executionCtx).catch(() => ({ videos: [], ok: false })),
  ]);
  // An origin failure must not become an apparently successful empty class list.
  if (!Array.isArray(classes)) return c.json({ error: "Classes could not be loaded. Please try again." }, 503);
  const unavailable = [!Array.isArray(captains) && "Captains", !Array.isArray(history) && "Our Hidden History", !broadcasts && "Broadcast dates"].filter((x): x is string => !!x);
  const body: StrongTeachings = {
    teachings: buildTeachings({ classes, captains: Array.isArray(captains) ? captains : [], history: Array.isArray(history) ? history : [] }, recent.videos, broadcasts ?? {}, c.env.DATA_ORIGIN, timeZone),
    feedOk: recent.ok, unavailable,
  };
  return c.json(body, 200, { "cache-control": `public, max-age=${recent.ok && !unavailable.length ? 600 : 60}`, "x-content-type-options": "nosniff" });
});
