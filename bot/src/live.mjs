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
  const starts = /"scheduledStartTime":"(\d+)"/.exec(html)?.[1];
  const at = starts ? Number(starts) * 1000 : null;
  // A stream scheduled for a time already an hour gone never went live (the channel page keeps
  // such placeholders for years); it is nothing to announce.
  const stale = at !== null && at < Date.parse(checked) - 3600_000;
  const upcoming = !live && !stale && /"isUpcoming":true/.test(details);
  if (!live && !upcoming) return none;
  return { live, upcoming, video, title, starts: at !== null ? new Date(at).toISOString() : null, checked };
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
    if (video && title && Number.isFinite(Date.parse(published))) out.push({ video, title: cleanTitle(title), published, views: views ? Number(views) : null });
  }
  return out.sort((a, b) => b.published.localeCompare(a.published));
}

/** Read a JSON assignment without evaluating page scripts or cutting at braces in titles.
 * @param {string} html
 * @returns {any}
 */
function initialData(html) {
  const assignment = /(?:\b(?:var\s+)?ytInitialData|window\["ytInitialData"\])\s*=\s*(?=\{)/g;
  for (const match of html.matchAll(assignment)) {
    const start = match.index + match[0].length;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

/** YouTube's English channel cards expose relative publication dates, not precise timestamps.
 * @param {string} text
 * @param {number} now
 * @returns {string | null}
 */
function cardDate(text, now) {
  const relative = /^(?:(?:Streamed|Premiered)\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text.trim());
  if (relative) {
    const units = /** @type {Record<string, number>} */ ({ second: 1000, minute: 60_000, hour: 3600_000, day: 86400_000, week: 7 * 86400_000, month: 30 * 86400_000, year: 365 * 86400_000 });
    const date = new Date(now - Number(relative[1]) * units[relative[2].toLowerCase()]);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  // Also accept dated premiere cards, but never treat a missing date as a new upload.
  const dated = text.replace(/^(?:Streamed live on|Premiered)\s+/i, "");
  if (!/^(?:[A-Z][a-z]{2,8} \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})$/.test(dated)) return null;
  // These labels contain a calendar date, not a local time. Use UTC explicitly so
  // the same card keeps its date on the Worker and on non-UTC development machines.
  const time = Date.parse(/^\d{4}-/.test(dated) ? `${dated}T00:00:00Z` : `${dated} 00:00:00 GMT`);
  return Number.isFinite(time) && time <= now ? new Date(time).toISOString() : null;
}

/**
 * RSS-outage fallback: recordings in the selected Videos/Live tab only. Avoid unrelated
 * recommendations, Shorts, live streams and scheduled broadcasts. No API key is required.
 * @param {string} html
 * @param {number} [now]
 * @returns {RecentVideo[]}
 */
export function parseChannelVideos(html, now = Date.now()) {
  const data = initialData(html);
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return [];
  const selected = tabs.find((tab) => tab?.tabRenderer?.selected)?.tabRenderer?.content;
  const out = new Map();
  /** @param {any} text */
  const label = (text) => typeof text?.simpleText === "string" ? text.simpleText : Array.isArray(text?.runs) ? text.runs.map((/** @type {any} */ r) => typeof r?.text === "string" ? r.text : "").join("") : "";
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const card = node.videoRenderer ?? node.gridVideoRenderer;
    if (card) {
      if (card.upcomingEventData || (Array.isArray(card.badges) && card.badges.some((/** @type {any} */ b) => /LIVE_NOW|UPCOMING/.test(b?.metadataBadgeRenderer?.style ?? ""))) ||
          (Array.isArray(card.thumbnailOverlays) && card.thumbnailOverlays.some((/** @type {any} */ o) => /LIVE|UPCOMING/.test(o?.thumbnailOverlayTimeStatusRenderer?.style ?? "")))) return;
      const video = card.videoId, title = cleanTitle(label(card.title));
      const published = cardDate(label(card.publishedTimeText), now);
      if (typeof video === "string" && /^[\w-]{11}$/.test(video) && title && published) {
        const count = label(card.viewCountText).replace(/,/g, "");
        const views = /^(\d+) views?$/.exec(count);
        out.set(video, { video, title, published, views: views ? Number(views[1]) : null });
      }
      return;
    }
    // YouTube's current channel layout nests recordings in lockupViewModel instead of
    // videoRenderer/gridVideoRenderer. Only regular videos; Shorts use another content type.
    const lockup = node.lockupViewModel;
    if (lockup && lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      const meta = lockup.metadata?.lockupMetadataViewModel;
      const title = cleanTitle(typeof meta?.title?.content === "string" ? meta.title.content : "");
      let published = null, views = null, skip = false;
      const parts = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const text = part?.text;
          const label = typeof part?.accessibilityLabel === "string" ? part.accessibilityLabel
            : typeof text?.content === "string" ? text.content : "";
          if (!label) continue;
          if (/^\s*(LIVE|UPCOMING|PREMIER)/i.test(label)) { skip = true; break; }
          if (!published) published = cardDate(label, now);
          if (views === null) {
            const count = /^([\d,.]+)\s+views?$/i.exec(label);
            if (count) views = Number(count[1].replace(/,/g, ""));
            else {
              const words = /^([\d,.]+)\s+(thousand|million)\s+views?$/i.exec(label);
              if (words) views = Math.round(Number(words[1].replace(/,/g, "")) * (words[2].toLowerCase() === "million" ? 1e6 : 1e3));
            }
          }
        }
      }
      const overlays = lockup.contentImage?.thumbnailViewModel?.overlays;
      if (Array.isArray(overlays)) {
        for (const o of overlays) {
          const badges = o?.thumbnailBottomOverlayViewModel?.badges ?? o?.thumbnailTopOverlayViewModel?.badges ?? [];
          for (const b of badges) {
            const t = b?.thumbnailBadgeViewModel?.text;
            if (typeof t === "string" && /^\s*(LIVE|UPCOMING)/i.test(t)) { skip = true; break; }
          }
          if (skip) break;
        }
      }
      const video = lockup.contentId;
      if (!skip && typeof video === "string" && /^[\w-]{11}$/.test(video) && title && published) {
        out.set(video, { video, title, published, views });
      }
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(selected);
  return [...out.values()].sort((a, b) => b.published.localeCompare(a.published)).slice(0, 15);
}
