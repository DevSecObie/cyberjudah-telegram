import { Hono } from "hono";
import type { Env } from "./env";
import { IdentityError } from "./account-links";
import { appReader } from "./app-identity";
import { searchTeachings } from "./teachings";

/**
 * "Said in Class" in the CyberJudah app: the search of every recording's spoken words that the site
 * and the Telegram app read (searchTeachings), for any verified app sign-in, linked to Telegram or
 * not. The results are the same public passages for everyone, so they are cached at the edge by
 * the search alone; the sign-in only keeps the search to the app's readers.
 */
type AppTeachings = { Bindings: Env };
export const appTeachings = new Hono<AppTeachings>();
appTeachings.use("*", async (c, next) => {
  try {
    const identity = await appReader(c.req.raw, c.env);
    if (!identity) return c.json({ error: "sign_in_required" }, 401);
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "sign_in_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
  return next();
});
appTeachings.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const feed = c.req.query("feed") ?? "";
  const page = Math.min(1000, Math.max(0, Math.floor(Number(c.req.query("page")) || 0)));
  const url = new URL(c.req.url);
  const key = new Request(`${url.origin}/__app-teachings?${new URLSearchParams({ q, feed, page: String(page) })}`);
  // The Workers edge cache (absent where the route is tested outside a Worker).
  const edge = typeof caches === "undefined" ? undefined : caches.default;
  const cached = await edge?.match(key);
  if (cached) return new Response(cached.body, cached);
  const res = await searchTeachings(c.env, q, feed, page);
  const response = c.json(res, res.ok ? 200 : 503);
  if (res.ok) {
    response.headers.set("cache-control", "private, max-age=300");
    if (edge) c.executionCtx.waitUntil(edge.put(key, new Response(response.clone().body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } })));
  }
  return response;
});
