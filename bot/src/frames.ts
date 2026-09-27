import type { Env, Exec } from "./env";
import { extractStoryboard, parseStoryboard, publicLevel, type PublicLevel, type StoryboardLevel } from "./frames.mjs";

/**
 * Frames of a recording: YouTube's storyboard sheets, fetched once and kept in R2 under
 * frames/<video>/<level>/<sheet>.jpg, with the spec in KV for a day (its signed URLs are
 * needed only to fill the bucket). The app never sees the signed URLs: it reads the levels
 * from /api/frames/<video> and the sheets from /frames/<video>/<level>/<n>.jpg. The hourly
 * cron warms a few recordings at a time until every class in the archive is in the bucket.
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
type Board = { duration: number; levels: (PublicLevel & { template: string })[] };
export type PublicBoard = { duration: number; levels: PublicLevel[] };

const kvKey = (video: string) => `frames:${video}`;
const doneKey = (video: string) => `frames-done:${video}`;
const objKey = (video: string, level: number, n: number) => `frames/${video}/${level}/${n}.jpg`;

async function fetchBoard(video: string): Promise<Board | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${video}&hl=en`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" } });
    if (!res.ok) return null;
    const got = extractStoryboard(await res.text());
    if (!got) return null;
    const levels = parseStoryboard(got.spec, got.duration).map((l: StoryboardLevel) => ({ ...publicLevel(l), template: l.url(-1).replace("M-1", "M$M") }));
    return { duration: got.duration, levels };
  } catch { return null; }
}

/** The board of a recording: from KV, else from YouTube (kept a day in KV). */
export async function board(env: Env, video: string): Promise<Board | null> {
  if (!VIDEO.test(video)) return null;
  const kept = await env.SUBS.get(kvKey(video), "json") as Board | null;
  if (kept) return kept;
  const fresh = await fetchBoard(video);
  if (fresh && fresh.levels.length) await env.SUBS.put(kvKey(video), JSON.stringify(fresh), { expirationTtl: 86400 });
  return fresh;
}

export const publicBoard = (b: Board): PublicBoard => ({ duration: b.duration, levels: b.levels.map(publicLevel) });

/** One sheet: from R2, else fetched from YouTube and kept. */
export async function sheet(env: Env, video: string, level: number, n: number, ctx?: Exec): Promise<Response | null> {
  if (!VIDEO.test(video) || !Number.isInteger(level) || !Number.isInteger(n) || level < 0 || n < 0) return null;
  const kept = await env.AUDIO.get(objKey(video, level, n));
  if (kept) return new Response(kept.body, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
  const b = await board(env, video);
  const l = b?.levels.find((x) => x.level === level);
  if (!l || n >= l.sheets) return null;
  const bytes = await fetchSheet(l.template.replace("$M", String(n)));
  if (!bytes) return null;
  const put = env.AUDIO.put(objKey(video, level, n), bytes, { httpMetadata: { contentType: "image/jpeg" } });
  if (ctx) ctx.waitUntil(put); else await put;
  return new Response(bytes, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" } });
}

async function fetchSheet(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, referer: "https://www.youtube.com/" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return res.arrayBuffer();
  } catch { return null; }
}

/** Every sheet of every level of one recording into the bucket; true when all are there. */
export async function warmVideo(env: Env, video: string): Promise<boolean> {
  const b = await board(env, video);
  if (!b) return false;
  let ok = true;
  for (const l of b.levels) for (let n = 0; n < l.sheets; n++) {
    if (await env.AUDIO.head(objKey(video, l.level, n))) continue;
    const bytes = await fetchSheet(l.template.replace("$M", String(n)));
    if (!bytes) { ok = false; continue; }
    await env.AUDIO.put(objKey(video, l.level, n), bytes, { httpMetadata: { contentType: "image/jpeg" } });
  }
  if (ok) await env.SUBS.put(doneKey(video), "1");
  return ok;
}

/** The archive's recordings, newest first, from the library's channel list. */
async function archive(env: Env): Promise<string[]> {
  const repo = env.TRANSCRIPTS_REPO ?? "DevSecObie/cyberjudah";
  const ids: string[] = [];
  for (const dir of ["blog", "captains", "history"]) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/${dir}/channel-meta.tsv`);
      if (!res.ok) continue;
      const rows = (await res.text()).split("\n").map((l) => l.split("\t")).filter((r) => VIDEO.test(r[0] ?? ""));
      rows.sort((a, b) => (b[1] ?? "").localeCompare(a[1] ?? ""));
      ids.push(...rows.map((r) => r[0]));
    } catch { /* next feed */ }
  }
  return [...new Set(ids)];
}

/** The hourly warm: a few recordings not yet in the bucket, newest first. */
export async function warmFrames(env: Env, limit = 12): Promise<{ warmed: string[]; failed: string[] }> {
  const warmed: string[] = [], failed: string[] = [];
  for (const video of await archive(env)) {
    if (warmed.length + failed.length >= limit) break;
    if (await env.SUBS.get(doneKey(video))) continue;
    (await warmVideo(env, video) ? warmed : failed).push(video);
  }
  return { warmed, failed };
}
