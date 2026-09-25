import { Hono } from "hono";
import { Api, webhookCallback } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import type { Env, Sub } from "./env";
import { validateInitData, type InitData } from "./initdata.mjs";
import { createBot, todaysVerse } from "./bot";
import { chapter, escapeHtml, openLink } from "./data";
import { runSearch } from "./search";
import { verseCard } from "./card";
import { sendDaily } from "./daily";
import { bookLabel } from "./verse-of-day.mjs";
import { dictionary } from "./dictionary";

type App = { Bindings: Env; Variables: { tma: InitData } };
const app = new Hono<App>();
const SAFE_PARAM = /^[A-Za-z0-9_-]{1,512}$/;
const STARS = new Set([50, 100, 500]);

/**
 * Every API call but the verse of the day carries the Mini App's initData; the bot token
 * proves it came from Telegram and names the person. Nothing else is trusted.
 */
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/verse-of-day" || c.req.path.startsWith("/api/dictionary")) return next();
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  const data = m ? await validateInitData(m[1], c.env.BOT_TOKEN, 86400) : null;
  if (!data?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("tma", data);
  await next();
});

app.post("/webhook", async (c) => {
  // The secret is checked before the bot is built: a stray request must not cost a getMe call.
  if (c.req.header("x-telegram-bot-api-secret-token") !== c.env.WEBHOOK_SECRET) return c.text("unauthorized", 401);
  const bot = await createBot(c.env, new URL(c.req.url).origin, c.executionCtx);
  return webhookCallback(bot, "hono", { secretToken: c.env.WEBHOOK_SECRET })(c);
});

app.get("/api/me", async (c) => {
  const { user } = c.get("tma");
  const sub = await c.env.SUBS.get(`sub:${user!.id}`);
  return c.json({ user: { id: user!.id, first_name: user!.first_name, username: user!.username }, subscribed: Boolean(sub), premium: Boolean(user!.is_premium) });
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const only = c.req.query("only") || undefined;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 8, 1), 100);
  const res = await runSearch(c.env.DB, q, only, limit);
  return c.json(res, res.ok ? 200 : 503);
});

app.post("/api/share", async (c) => {
  const { user } = c.get("tma");
  const body = await c.req.json<{ kind?: string; title?: string; text?: string; url?: string; startapp?: string }>().catch(() => null);
  if (!body) return c.json({ error: "bad-json" }, 400);
  const kind = body.kind === "verse" || body.kind === "note" || body.kind === "app" ? body.kind : null;
  const title = String(body.title ?? "").trim().slice(0, 200);
  const text = String(body.text ?? "").trim().slice(0, 3500);
  const startapp = SAFE_PARAM.test(String(body.startapp ?? "")) ? String(body.startapp) : "";
  if (!kind || (!title && !text)) return c.json({ error: "bad-request" }, 400);
  // Only the site is linked as the source: the app cannot make the bot relay other links.
  let site = c.env.SITE_URL;
  try { const u = new URL(String(body.url ?? "/"), c.env.SITE_URL); if (u.origin === new URL(c.env.SITE_URL).origin) site = u.href; } catch { /* keep the site root */ }
  const source = `<a href="${site}">cyberjudah.io</a>`;
  const html = kind === "verse" ? `${escapeHtml(text)}\n\n<b>${escapeHtml(title)}</b> (KJV) · ${source}`
    : kind === "note" ? `<b>${escapeHtml(title)}</b>\n${escapeHtml(text)}\n\n${source}`
    : `<b>${escapeHtml(title || "CyberJudah")}</b>\n${escapeHtml(text)}\n\n${source}`;
  const result: InlineQueryResultArticle = {
    type: "article",
    id: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
    title: title || "CyberJudah",
    description: text.slice(0, 200),
    input_message_content: { message_text: html.slice(0, 4096), parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    reply_markup: { inline_keyboard: [[{ text: "Open in CyberJudah", url: openLink(c.env, startapp) }]] },
  };
  try {
    const prepared = await new Api(c.env.BOT_TOKEN).savePreparedInlineMessage(user!.id, result, { allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true, allow_bot_chats: true });
    return c.json({ id: prepared.id });
  } catch (e) {
    console.error(JSON.stringify({ event: "share_failed", message: e instanceof Error ? e.message : String(e) }));
    return c.json({ error: "share-failed" }, 502);
  }
});

app.post("/api/subscribe", async (c) => {
  const { user } = c.get("tma");
  const body = await c.req.json<{ on?: boolean; hour?: number; tz?: number }>().catch(() => null);
  if (!body) return c.json({ error: "bad-json" }, 400);
  const key = `sub:${user!.id}`;
  if (!body.on) { await c.env.SUBS.delete(key); return c.json({ subscribed: false }); }
  const hour = Number.isInteger(body.hour) && body.hour! >= 0 && body.hour! <= 23 ? body.hour! : 8;
  const tz = Number.isInteger(body.tz) && Math.abs(body.tz!) <= 14 * 60 ? body.tz! : 0;
  // Private chat id equals the user id; the daily message goes there.
  const sub: Sub = { chatId: user!.id, hour, tz };
  await c.env.SUBS.put(key, JSON.stringify(sub));
  return c.json({ subscribed: true });
});

app.post("/api/invoice", async (c) => {
  const { user } = c.get("tma");
  const body = await c.req.json<{ stars?: number }>().catch(() => null);
  const stars = Number(body?.stars);
  if (!STARS.has(stars)) return c.json({ error: "bad-amount" }, 400);
  try {
    const link = await new Api(c.env.BOT_TOKEN).createInvoiceLink("Support CyberJudah", "Keep the library free and the classes online. Thank you.", `support:${user!.id}:${stars}`, "", "XTR", [{ label: "Support CyberJudah", amount: stars }]);
    return c.json({ link });
  } catch (e) {
    console.error(JSON.stringify({ event: "invoice_failed", message: e instanceof Error ? e.message : String(e) }));
    return c.json({ error: "invoice-failed" }, 502);
  }
});

// The dictionary is public: nothing personal in a lookup, and the cache can serve everyone.
app.route("/api/dictionary", dictionary);

app.get("/api/verse-of-day", async (c) => {
  const v = await todaysVerse(c.env, c.executionCtx);
  if (!v.text) return c.json({ error: "unavailable" }, 503);
  c.header("cache-control", "public, max-age=600");
  return c.json({ ref: v.ref, slug: v.slug, chapter: v.chapter, verse: v.verse, text: v.text, startapp: v.param });
});

app.get("/card/:slug/:chapter/:file", async (c) => {
  const slug = c.req.param("slug"), ch = Number(c.req.param("chapter"));
  const verse = Number(c.req.param("file").match(/^(\d+)\.svg$/)?.[1]);
  if (!/^[a-z0-9-]+$/.test(slug) || !Number.isInteger(ch) || ch < 1 || !Number.isInteger(verse) || verse < 1) return c.notFound();
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;
  const data = await chapter(c.env, slug, ch, c.executionCtx);
  const text = data?.verses.find((x) => x.verse === verse)?.text;
  if (!text) return c.notFound();
  const res = new Response(verseCard(text, `${bookLabel(slug)} ${ch}:${verse}`), {
    headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
});

// Anything else is the Mini App (run_worker_first only routes the paths above here).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    ctx.waitUntil(sendDaily(env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
