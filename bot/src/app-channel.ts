import { Hono } from "hono";
import type { Env } from "./env";
import { liveNow, recentVideos } from "./live";

/**
 * The classroom channel's newest uploads and its live stream, for the CyberJudah app, so a class
 * is listed the hour it goes up, before its notes are written, as it is in the Telegram app
 * (/api/recent and /api/live there). Both are the channel's public YouTube listings for one
 * fixed channel, already cached at the edge (live.ts), so they are open to every reader of the
 * app, signed in or not, like the class feeds on data.cyberjudah.io. GET only; nothing is read
 * from the request.
 */
type AppChannel = { Bindings: Env };
export const appChannel = new Hono<AppChannel>();
appChannel.get("/recent", async (c) => {
  const r = await recentVideos(c.env, c.executionCtx);
  c.header("cache-control", `public, max-age=${r.ok ? 300 : 60}`);
  return c.json({ videos: r.videos, feedOk: r.ok });
});
appChannel.get("/live", async (c) => {
  c.header("cache-control", "public, max-age=60");
  return c.json(await liveNow(c.env, c.executionCtx));
});
