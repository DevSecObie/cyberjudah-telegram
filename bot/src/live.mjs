// @ts-check
/** @typedef {{ live: boolean; upcoming: boolean; video: string | null; title: string | null; starts: string | null; checked: string }} LiveNow */

/**
 * The stream named on a channel's /live page: on the air, or scheduled, or neither. The page
 * carries the player response of that stream; nothing else in the app needs an API key for it.
 * @param {string} html
 * @param {string} checked
 * @returns {LiveNow}
 */
export function parseLive(html, checked) {
  const none = { live: false, upcoming: false, video: null, title: null, starts: null, checked };
  const details = /"videoDetails":\{(.*?)\},"(?:playerConfig|annotations|storyboards|microformat)/s.exec(html)?.[1] ?? "";
  const video = /"videoId":"([\w-]{11})"/.exec(details)?.[1] ?? null;
  if (!video) return none;
  const title = /"title":"((?:[^"\\]|\\.)*)"/.exec(details)?.[1]?.replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/\\\\/g, "\\") ?? null;
  const live = /"isLiveNow":true/.test(html) || (/"isLive":true/.test(details) && !/"isUpcoming":true/.test(details));
  const upcoming = !live && /"isUpcoming":true/.test(details);
  const starts = /"scheduledStartTime":"(\d+)"/.exec(html)?.[1];
  return { live, upcoming, video, title, starts: starts ? new Date(Number(starts) * 1000).toISOString() : null, checked };
}

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
/**
 * A recording's title as the notes spell it: an all-caps YouTube title in title case, small
 * words down, the rest untouched.
 * @param {string} raw
 */
export function cleanTitle(raw) {
  const t = raw.replace(/\s*#\w+/g, "").replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(" ").map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/^(\(?)([a-z])/, (_m, p, c) => p + c.toUpperCase()))).join(" ");
}

/** @typedef {{ video: string; title: string; published: string; views: number | null }} RecentVideo */

/**
 * The channel's latest uploads from its public RSS feed (the fifteen newest), newest first.
 * @param {string} xml
 * @returns {RecentVideo[]}
 */
export function parseFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const video = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(e)?.[1];
    const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") ?? "";
    const published = /<published>([^<]+)<\/published>/.exec(e)?.[1] ?? "";
    const views = /<media:statistics views="(\d+)"/.exec(e)?.[1];
    if (video && published) out.push({ video, title: cleanTitle(title), published, views: views ? Number(views) : null });
  }
  return out.sort((a, b) => b.published.localeCompare(a.published));
}
