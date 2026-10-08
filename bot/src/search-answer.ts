import { Hono } from "hono";
import type { Env } from "./env";
import type { InitData } from "./initdata.mjs";
import { answerSearch, searchModel, takeQuota } from "./ai";
import { isAdmin } from "./edit";

/** Mounted after the Worker's Telegram authentication middleware. */
export const searchAnswers = new Hono<{ Bindings: Env; Variables: { tma: InitData } }>();

searchAnswers.get("/", async (c) => {
  // Consent must be checked on every request, even when an edge answer already exists.
  // Browsers must not reuse a response after the reader withdraws their agreement.
  c.header("cache-control", "private, no-store");
  const uid = c.get("tma")?.user?.id;
  if (!uid) return c.json({ ok: false, error: "unauthorized" }, 401);
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  if (q.length < 2) return c.json({ ok: false, error: "too-short" }, 400);
  const model = searchModel(c.env);
  if (!model) return c.json({ ok: false, error: "unavailable" }, 503);
  const consent = (c.req.header("x-ai-consent") ?? "").split(",").map((s) => s.trim());
  if (!model.id.startsWith("@cf/") && !consent.includes(model.provider)) {
    return c.json({ ok: false, error: "consent", provider: model.provider }, 428);
  }

  // Version and model isolate cached answers from old releases and configuration changes.
  const key = new URL(c.req.url);
  key.search = new URLSearchParams({ q, model: model.id, version: "library-answer-v2" }).toString();
  const cache = caches.default;
  const hit = await cache.match(key.toString()).catch(() => undefined);
  if (hit) return new Response(hit.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  const limit = Math.max(1, Math.floor(Number(c.env.SEARCH_AI_DAILY_LIMIT ?? 20)));
  if (!isAdmin(c.env, uid) && !(await takeQuota(c.env, "search_ai", uid, limit))) return c.json({ ok: false, error: "limit" }, 429);
  const r = await answerSearch(c.env, q, uid, consent);
  if (!r.ok) return c.json({ ok: false, error: r.reason }, r.reason === "too-short" ? 400 : r.reason === "consent" ? 428 : r.reason === "free-paused" ? 429 : 503);
  const res = c.json(r);
  const cached = new Response(JSON.stringify(r), { headers: { "content-type": "application/json", "cache-control": "public, max-age=120" } });
  c.executionCtx.waitUntil(cache.put(key.toString(), cached).catch(() => undefined));
  return res;
});
