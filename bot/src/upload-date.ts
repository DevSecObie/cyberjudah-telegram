import type { Env } from "./env";

/**
 * A recording's YouTube upload date, for a class whose own date is not known. It is read from the
 * video's watch page (the same page frames.ts reads), so it costs nothing, and kept in KV: a found
 * date for good, a miss for a week. It is the upload date, not the date the class was taught, so
 * every caller labels it as such.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const key = (video: string) => `upload-date:${video}`;

/** The upload date (YYYY-MM-DD) a watch page states, or "" when it states none. */
export function uploadDateIn(html: string): string {
  const m = /"(?:publishDate|uploadDate)":"(\d{4}-\d{2}-\d{2})/.exec(html)
    ?? /itemprop="(?:datePublished|uploadDate)" content="(\d{4}-\d{2}-\d{2})/.exec(html);
  return m ? m[1] : "";
}

export async function uploadDate(env: Env, video: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!VIDEO.test(video)) return "";
  const kept = await Promise.resolve().then(() => env.SUBS.get(key(video))).catch(() => null);
  if (kept !== null) return kept;
  let date = "";
  try {
    const res = await fetcher(`https://www.youtube.com/watch?v=${video}&hl=en`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" }, signal: AbortSignal.timeout(5000) });
    if (res.ok) date = uploadDateIn(await res.text());
  } catch { /* unknown stays unknown */ }
  await Promise.resolve().then(() => env.SUBS.put(key(video), date, date ? {} : { expirationTtl: 7 * 86400 })).catch(() => undefined);
  return date;
}

/** Upload dates for the first `max` of these videos (the rest stay unknown), keyed by video. */
export async function uploadDates(env: Env, videos: string[], max = 12): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all([...new Set(videos)].slice(0, max).map(async (v) => { const d = await uploadDate(env, v).catch(() => ""); if (d) out[v] = d; }));
  return out;
}
