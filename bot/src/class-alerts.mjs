// @ts-check
/** @typedef {import("./live.mjs").RecentVideo} RecentVideo */
/** @typedef {import("./live.mjs").LiveNow} LiveNow */
/** @typedef {{ video: string; title: string; live: boolean }} ClassAlert */

/** Video ids remembered as already announced (the feed holds fifteen; this leaves room for live streams). */
export const SEEN_LIMIT = 100;
/** Alerts one run may send, so a lost memory or a burst of uploads never floods phones. */
export const ALERTS_PER_RUN = 2;
/** A class older than this when first seen is not news. */
export const FRESH_MS = 48 * 3600_000;

/**
 * What to announce this run. A first run (nothing remembered) only remembers. A stream the
 * channel's /live page names as upcoming waits until it starts; the stream on the air is
 * announced even before the feed lists it. Newest first, at most ALERTS_PER_RUN; everything
 * found is remembered either way, so nothing is announced twice.
 * @param {{ videos: RecentVideo[]; live: LiveNow | null; seen: string[] | null; now: number }} input
 * @returns {{ alerts: ClassAlert[]; seen: string[] }}
 */
export function planClassAlerts({ videos, live, seen, now }) {
  const valid = /^[\w-]{11}$/;
  const found = videos.filter((v) => valid.test(v.video));
  const liveId = live && live.video && valid.test(live.video) ? live.video : null;
  const waiting = live && live.upcoming && !live.live ? liveId : null;
  const ids = [...found.map((v) => v.video), ...(liveId && !waiting ? [liveId] : [])];
  if (!seen) return { alerts: [], seen: remember([], ids) };
  const known = new Set(seen);
  /** @type {ClassAlert[]} */
  const alerts = [];
  if (live && live.live && liveId && !known.has(liveId) && live.title)
    alerts.push({ video: liveId, title: clean(live.title), live: true });
  for (const v of found) {
    if (known.has(v.video) || v.video === waiting || (live?.live && v.video === liveId)) continue;
    const at = Date.parse(v.published);
    if (!Number.isFinite(at) || now - at > FRESH_MS || !v.title) continue;
    alerts.push({ video: v.video, title: clean(v.title), live: false });
  }
  return { alerts: alerts.slice(0, ALERTS_PER_RUN), seen: remember(seen, ids.filter((id) => id !== waiting)) };
}

/** @param {string[]} seen @param {string[]} ids */
function remember(seen, ids) {
  const out = [...new Set([...ids, ...seen])];
  return out.slice(0, SEEN_LIMIT);
}

/** @param {string} s */
const clean = (s) => s.replace(/\s+/g, " ").trim().slice(0, 180);

/**
 * The FCM v1 message for one alert, sent to a topic: the server never holds a phone's token.
 * @param {ClassAlert} alert
 * @param {string} topic
 */
export function fcmMessage(alert, topic) {
  return {
    message: {
      topic,
      notification: { title: alert.live ? "Live now" : "New class", body: alert.title },
      data: { kind: "new-class", video: alert.video, title: alert.title },
      android: { priority: "HIGH", notification: { channel_id: "new-classes" } },
      apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
    },
  };
}
