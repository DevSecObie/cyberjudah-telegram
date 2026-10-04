import type { Env, Exec } from "./env";
import { parseFeed, parseLive } from "./live.mjs";
export { parseLive };

export type { LiveNow, RecentVideo } from "./live.mjs";
import type { LiveNow, RecentVideo } from "./live.mjs";

/** The classroom channel's /live page names the stream that is on, or the one scheduled next. */
const CHANNEL = "UC8gdvMmoqFOcx2N8YdjqRxw";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const TTL = 90;

/**
 * Whether a class is streaming right now. YouTube's channel /live page carries the player
 * response of the live (or upcoming) stream; nothing else in the app needs an API key for
 * it. Cached briefly at the edge so a Sabbath's worth of opens is a handful of fetches.
 */
export async function liveNow(env: Env, ctx?: Exec): Promise<LiveNow> {
  const channel = env.LIVE_CHANNEL || CHANNEL;
  const key = `https://cyberjudah-telegram.internal/live/${channel}`;
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.json<LiveNow>();
  const out = await check(channel);
  const res = new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${TTL}` } });
  const put = cache.put(key, res.clone());
  if (ctx) ctx.waitUntil(put); else await put;
  return out;
}

async function check(channel: string): Promise<LiveNow> {
  const checked = new Date().toISOString();
  const none: LiveNow = { live: false, upcoming: false, video: null, title: null, starts: null, checked };
  try {
    const res = await fetch(`https://www.youtube.com/channel/${channel}/live`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" }, redirect: "follow" });
    if (!res.ok) return none;
    const html = await res.text();
    return parseLive(html, checked);
  } catch {
    return none;
  }
}

/**
 * The channel's newest recordings, from its public RSS feed, so a class is in the app the
 * hour it is uploaded, before its captions and notes exist. Cached ten minutes at the edge.
 * `ok` is false when YouTube did not serve the feed, so the app can say so instead of
 * silently showing nothing new.
 */
export async function recentVideos(env: Env, ctx?: Exec): Promise<{ videos: RecentVideo[]; ok: boolean }> {
  const channel = env.LIVE_CHANNEL || CHANNEL;
  const key = `https://cyberjudah-telegram.internal/recent/v2/${channel}`;
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit.json<{ videos: RecentVideo[]; ok: boolean }>();
  let out: RecentVideo[] = [];
  let ok = false;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, { headers: { "user-agent": UA } });
    if (res.ok) { out = parseFeed(await res.text()); ok = true; }
  } catch { /* the feed is a convenience; the notes list still loads */ }
  const body = { videos: out, ok };
  const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
  const put = cache.put(key, res.clone());
  if (ctx) ctx.waitUntil(put); else await put;
  return body;
}
