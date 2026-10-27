import { Hono } from "hono";
import type { Env, Exec } from "./env";
import { runSearch } from "./search";
import { loadTranscript, searchTeachings, taughtIn, transcriptAround } from "./teachings";
import { findVisuals } from "./visuals.mjs";
import { liveNow, recentVideos } from "./live";
import { libraryPdf } from "./library-pdf";
import { dataJson } from "./data";

/** Only public library content. This router contains no account, AI, billing or mutation routes. */
export const readerContent = new Hono<{ Bindings: Env }>();
/**
 * GETs whose answers are the same for every reader are cached briefly at the edge, so a
 * surge of identical searches is one D1 read, not thousands. Only successful answers are
 * kept; the URL (with its query) is the key.
 */
async function edgeCached(c: { req: { url: string }; executionCtx: Exec }, ttl: number, compute: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  const hit = await cache.match(c.req.url).catch(() => undefined);
  if (hit) return hit;
  const res = await compute();
  if (res.ok) {
    res.headers.set("cache-control", `public, max-age=${ttl}`);
    c.executionCtx.waitUntil(cache.put(c.req.url, res.clone()).catch(() => undefined));
  }
  return res;
}

readerContent.get("/search", async (c) => {
  return edgeCached(c, 120, async () => {
    const q = (c.req.query("q") ?? "").slice(0, 200);
    const only = c.req.query("only") || undefined;
    const limit = Math.min(Math.max(Math.floor(Number(c.req.query("limit"))) || 8, 1), 100);
    const res = await runSearch(c.env.DB, q, only, limit, false, c.req.query("live") === "1");
    return c.json(res, res.ok ? 200 : 503);
  });
});

// The teachings search as the site has it (the spoken passages of every recording), where a
// chapter was taught, and the captions around a moment of a recording.
readerContent.get("/teachings", async (c) => {
  return edgeCached(c, 300, async () => {
    const res = await searchTeachings(c.env, c.req.query("q") ?? "", c.req.query("feed") ?? "", Math.min(1000, Math.max(0, Math.floor(Number(c.req.query("page")) || 0))));
    return c.json(res, res.ok ? 200 : 503);
  });
});
// Whether a class is on the air right now (the channel's live stream), for the Home screen.
readerContent.get("/live", async (c) => c.json(await liveNow(c.env, c.executionCtx)));
// The channel's newest recordings, so a class is listed before its notes are written.
readerContent.get("/recent", async (c) => { const r = await recentVideos(c.env, c.executionCtx); return c.json({ videos: r.videos, feedOk: r.ok }); });
readerContent.get("/taught/:slug/:chapter", async (c) => {
  const slug = c.req.param("slug"), chapter = Number(c.req.param("chapter"));
  if (!/^[a-z0-9-]{1,40}$/.test(slug) || !(Number.isInteger(chapter) && chapter >= 1 && chapter <= 200)) return c.json({ ok: false, reason: "bad-reference" }, 400);
  const verses = (c.req.query("v") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 200).slice(0, 200);
  const res = await taughtIn(c.env, slug, chapter, verses);
  return c.json(res, res.ok ? 200 : 503);
});
// The moments the teacher pointed at something on the screen, from the captions.
readerContent.get("/visuals/:video", async (c) => {
  const video = c.req.param("video");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(video)) return c.json({ ok: false, visuals: [] }, 400);
  const got = await loadTranscript(c.env, video, c.executionCtx);
  if ("error" in got) return c.json({ ok: false, visuals: [] }, got.error === "not-found" ? 404 : 503);
  return c.json({ ok: true, visuals: findVisuals(got.file.segments ?? []) }, 200, { "cache-control": "public, max-age=86400" });
});

readerContent.get("/transcript/:video", async (c) => {
  const video = c.req.param("video");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(video)) return c.json({ ok: false, reason: "bad-video" }, 400);
  const res = await transcriptAround(c.env, video, Math.max(0, Number(c.req.query("t")) || 0), c.executionCtx);
  return c.json(res, res.ok ? 200 : res.reason === "not-found" ? 404 : 503);
});


/** Anonymous native reading has its own fail-closed budget, independent of private API auth. */
export const publicReader = new Hono<{ Bindings: Env }>();
publicReader.use("*", async (c, next) => {
  c.header("x-content-type-options", "nosniff");
  c.header("cache-control", "no-store");
  if (c.req.method !== "GET") return c.json({ ok: false, reason: "read-only" }, 405, { allow: "GET" });
  if (c.req.url.length > 2048) return c.json({ ok: false, reason: "request-too-long" }, 414);
  if (!c.env.READER_LIMIT) return c.json({ ok: false, reason: "unavailable" }, 503, { "retry-after": "60" });
  try {
    // Cloudflare supplies this header. The limiter keeps a digest, never an account association.
    const ip = (c.req.header("cf-connecting-ip") ?? "unknown").slice(0, 45);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`reader:${ip}`));
    const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    if (!(await c.env.READER_LIMIT.limit({ key })).success) return c.json({ ok: false, reason: "rate-limited" }, 429, { "retry-after": "60" });
  } catch { return c.json({ ok: false, reason: "unavailable" }, 503, { "retry-after": "60" }); }
  await next();
  c.header("x-content-type-options", "nosniff");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});
publicReader.route("/", readerContent);
// Resolve a public-domain book to a short-lived signed download. The fixed body cannot
// request chat delivery; the existing resolver enforces the catalog and Archive allow-list.
publicReader.get("/library/pdf", async c => {
  const query = new URL(c.req.url).searchParams;
  if ([...query.keys()].some(key => !["slug", "item", "printed"].includes(key))) return c.json({ ok: false, reason: "bad-query" }, 400);
  const body = { slug: query.get("slug"), item: query.get("item"), ...(query.has("printed") ? { printed: Number(query.get("printed")) } : {}) };
  const request = new Request(c.req.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return libraryPdf(request, c.env.BOT_TOKEN, path => dataJson(c.env, path, c.executionCtx));
});
// Never fall through to a private route in the parent application.
publicReader.all("*", c => c.json({ ok: false, reason: "not-found" }, 404));
