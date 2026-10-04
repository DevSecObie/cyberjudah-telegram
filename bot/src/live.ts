import type { Env, Exec } from "./env";
import { parseChannelVideos, parseFeed, parseLive } from "./live.mjs";
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
 * Keep classes visible before their notes exist, even during a YouTube RSS outage.
 * Channel pages are a fallback; KV preserves seven days of last-good results across edges.
 * `ok` means at least one source supplied recordings in this refresh, including a fallback.
 */
export async function recentVideos(env: Env, ctx?: Exec): Promise<{ videos: RecentVideo[]; ok: boolean }> {
  const channel = env.LIVE_CHANNEL || CHANNEL;
  // Version the status envelope separately from the retained array snapshot in KV.
  const key = `https://cyberjudah-telegram.internal/recent/v3/${channel}`;
  const savedKey = `recent:v2:${channel}`;
  const cache = caches.default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return hit.json<{ videos: RecentVideo[]; ok: boolean }>();
  const now = Date.now();
  let out = parseFeed(await recentSource(`feeds/videos.xml?channel_id=${channel}`));
  let fresh = out.length > 0;
  if (!fresh) {
    const pages = await Promise.all(["videos", "streams"].map(async (tab) => parseChannelVideos(await recentSource(`channel/${channel}/${tab}?hl=en`), now)));
    out = pages.flat();
    fresh = out.length > 0;
    // Preserve known classes if either tab is unavailable; an outage must not erase them.
    const saved = await env.SUBS.get<{ checked: number; videos: RecentVideo[] }>(savedKey, "json").catch(() => null);
    if (saved && now - saved.checked < 7 * 86400_000 && Array.isArray(saved.videos)) out.unshift(...saved.videos);
    out = [...new Map(out.map((v) => [v.video, v])).values()]
      .sort((a, b) => b.published.localeCompare(a.published)).slice(0, 15);
  }
  const body = { videos: out, ok: fresh };
  // Failed refreshes retry after one minute and never replace/extend the last-good snapshot.
  const res = new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${fresh ? 600 : 60}` } });
  const put = Promise.all([
    cache.put(key, res).catch(() => undefined),
    ...(fresh ? [env.SUBS.put(savedKey, JSON.stringify({ checked: now, videos: out }), { expirationTtl: 7 * 86400 }).catch(() => undefined)] : []),
  ]);
  if (ctx) ctx.waitUntil(put); else await put;
  return body;
}

/** Bound each source so a stalled RSS request still reaches the fallback. */
async function recentSource(path: string): Promise<string> {
  try {
    const res = await fetch(`https://www.youtube.com/${path}`, {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.text() : "";
  } catch { return ""; }
}
