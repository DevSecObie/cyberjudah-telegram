import { Hono } from "hono";
import { Api, webhookCallback } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import type { Env, Sub } from "./env";
import { validateInitData, type InitData } from "./initdata.mjs";
import { createBot, todaysVerse } from "./bot";
import { chapter, dataJson, escapeHtml, openLink } from "./data";
import { runSearch } from "./search";
import { loadTranscript, searchTeachings, taughtIn, transcriptAround } from "./teachings";
import { findVisuals } from "./visuals.mjs";
import { liveNow, recentVideos } from "./live";
import { ask, askStream, similar, speakVerse } from "./ai";
import { VOICES } from "./ai.mjs";
import { verseCard } from "./card";
import { sendDaily } from "./daily";
import { reportHealth, selfCheck } from "./health";
import { bookLabel } from "./verse-of-day.mjs";
import { dictionary } from "./dictionary";
import { canEdit, commitEdit, isAdmin, readSource, type NoteEdit } from "./edit";
import { CHAT_ID, deleteChat, getChat, listChats } from "./chats";
import { notePdf, pdfName } from "./pdf.mjs";
import { billingOn, invoiceFor, prices, pruneBilling, standing, usageDay, SUPPORT_STARS } from "./billing";
import { InputFile } from "grammy";
import { board, publicBoard, sheet, warmFrames, warmVideo } from "./frames";

type App = { Bindings: Env; Variables: { tma: InitData } };
const app = new Hono<App>();
const SAFE_PARAM = /^[A-Za-z0-9_-]{1,512}$/;

/**
 * Every API call but the verse of the day carries the Mini App's initData; the bot token
 * proves it came from Telegram and names the person. Nothing else is trusted.
 */
app.use("/api/*", async (c, next) => {
  // JSON only: no MIME sniffing on anything the API serves.
  c.header("x-content-type-options", "nosniff");
  // The frames' geometry is public like the sheets themselves: the library's build reads it to place frames in the notes.
  // A note's PDF is fetched by Telegram's downloader, which carries no launch data: its link is signed instead.
  if (c.req.method === "GET" && c.req.path.startsWith("/api/pdf/")) return next();
  if (c.req.path === "/api/verse-of-day" || c.req.path === "/api/health" || c.req.path.startsWith("/api/dictionary") || (c.req.method === "GET" && /^\/api\/frames\/[A-Za-z0-9_-]{11}$/.test(c.req.path))) return next();
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  // Thirty days: Telegram keeps a Mini App open in the background for weeks, and its launch
  // data is only made afresh when it is opened again, so a short window turned every Search
  // and Ask into "not answering" for a reader who never closed the app. The signature still
  // proves who is asking; the age check only bounds a replay.
  const data = m ? await validateInitData(m[1], c.env.BOT_TOKEN, 30 * 86400) : null;
  if (!data?.user) {
    const stale = m ? !!(await validateInitData(m[1], c.env.BOT_TOKEN, 10 * 365 * 86400))?.user : false;
    return c.json({ error: "unauthorized", reason: stale ? "stale" : m ? "invalid" : "missing" }, 401);
  }
  c.set("tma", data);
  await next();
});

app.post("/webhook", async (c) => {
  // The secret is checked before the bot is built: a stray request must not cost a getMe call.
  if (c.req.header("x-telegram-bot-api-secret-token") !== c.env.WEBHOOK_SECRET) return c.text("unauthorized", 401);
  const bot = await createBot(c.env, new URL(c.req.url).origin, c.executionCtx);
  return webhookCallback(bot, "hono", { secretToken: c.env.WEBHOOK_SECRET })(c);
});

// What is answering right now: the search index, the teachings index, the answering model.
// Public, so the app can say which part is resting instead of "not answering".
app.get("/api/health", async (c) => {
  const probe = async (f: () => Promise<unknown>) => { const t0 = Date.now(); try { await f(); return { ok: true, ms: Date.now() - t0 }; } catch (e) { return { ok: false, ms: Date.now() - t0, error: (e as Error).message?.slice(0, 80) }; } };
  const [search, teachings] = await Promise.all([
    probe(() => c.env.DB.prepare("SELECT count(*) AS n FROM search_docs LIMIT 1").first()),
    probe(() => c.env.TEACH.prepare("SELECT count(*) AS n FROM teaching_passages LIMIT 1").first()),
  ]);
  return c.json({ ok: search.ok && teachings.ok, search, teachings, ask: { model: c.env.ANTHROPIC_API_KEY ? c.env.CLAUDE_MODEL : "workers-ai" }, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
});
app.get("/api/me", async (c) => {
  const { user } = c.get("tma");
  const sub = await c.env.SUBS.get(`sub:${user!.id}`);
  return c.json({ user: { id: user!.id, first_name: user!.first_name, username: user!.username }, subscribed: Boolean(sub), premium: Boolean(user!.is_premium), admin: isAdmin(c.env, user!.id), canEdit: isAdmin(c.env, user!.id) && canEdit(c.env) });
});

// An admin's edit to a note (teacher, title, a spelling, or the text): one commit to the
// cyberjudah repository; the site and the app pick it up on the next build.
// The note's markdown as it is in the repository, for editing the text itself.
app.get("/api/notes/source", async (c) => {
  const { user } = c.get("tma");
  if (!isAdmin(c.env, user!.id)) return c.json({ ok: false, error: "Only an admin can edit notes." }, 403);
  const res = await readSource(c.env, c.req.query("file") ?? "").catch((e: Error) => ({ ok: false as const, error: e.message }));
  return c.json(res, res.ok ? 200 : 400);
});

app.post("/api/notes/edit", async (c) => {
  const { user } = c.get("tma");
  if (!isAdmin(c.env, user!.id)) return c.json({ ok: false, error: "Only an admin can edit notes." }, 403);
  const edit = (await c.req.json().catch(() => null)) as NoteEdit | null;
  if (!edit?.file) return c.json({ ok: false, error: "No note given." }, 400);
  try {
    const res = await commitEdit(c.env, edit, user!.username ? `@${user!.username}` : user!.first_name);
    return c.json(res, res.ok ? 200 : 400);
  } catch (e) {
    // Whatever goes wrong, the sheet gets a plain reason as JSON, never a bare error page —
    // and never the server's own error text.
    console.error(JSON.stringify({ event: "note_edit_failed", message: (e as Error).message?.slice(0, 200) }));
    return c.json({ ok: false, error: "The save failed on the server." }, 400);
  }
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const only = c.req.query("only") || undefined;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 8, 1), 100);
  const res = await runSearch(c.env.DB, q, only, limit);
  return c.json(res, res.ok ? 200 : 503);
});

// The teachings search as the site has it (the spoken passages of every recording), where a
// chapter was taught, and the captions around a moment of a recording.
app.get("/api/teachings", async (c) => {
  const res = await searchTeachings(c.env, c.req.query("q") ?? "", c.req.query("feed") ?? "", Math.min(1000, Math.max(0, Math.floor(Number(c.req.query("page")) || 0))));
  return c.json(res, res.ok ? 200 : 503);
});
// Whether a class is on the air right now (the channel's live stream), for the Home screen.
app.get("/api/live", async (c) => c.json(await liveNow(c.env, c.executionCtx)));
// The channel's newest recordings, so a class is listed before its notes are written.
app.get("/api/recent", async (c) => c.json({ videos: await recentVideos(c.env, c.executionCtx) }));
app.get("/api/taught/:slug/:chapter", async (c) => {
  const slug = c.req.param("slug"), chapter = Number(c.req.param("chapter"));
  if (!/^[a-z0-9-]{1,40}$/.test(slug) || !(chapter >= 1 && chapter <= 200)) return c.json({ ok: false, reason: "bad-reference" }, 400);
  const verses = (c.req.query("v") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 200).slice(0, 200);
  const res = await taughtIn(c.env, slug, chapter, verses);
  return c.json(res, res.ok ? 200 : 503);
});
// The frames of a recording (YouTube's storyboard): the levels, then the sheets by level and index.
app.get("/api/frames/:video", async (c) => {
  const b = await board(c.env, c.req.param("video"));
  if (!b || !b.levels.length) return c.json({ ok: false, levels: [], duration: 0 }, 404);
  return c.json({ ok: true, ...publicBoard(b) }, 200, { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" });
});
app.post("/api/frames/:video/warm", async (c) => {
  const { user } = c.get("tma");
  if (!isAdmin(c.env, user!.id)) return c.json({ ok: false }, 403);
  return c.json({ ok: await warmVideo(c.env, c.req.param("video")) });
});

// The moments the teacher pointed at something on the screen, from the captions.
app.get("/api/visuals/:video", async (c) => {
  const video = c.req.param("video");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(video)) return c.json({ ok: false, visuals: [] }, 400);
  const got = await loadTranscript(c.env, video, c.executionCtx);
  if ("error" in got) return c.json({ ok: false, visuals: [] }, got.error === "not-found" ? 404 : 503);
  return c.json({ ok: true, visuals: findVisuals(got.file.segments ?? []) }, 200, { "cache-control": "public, max-age=86400" });
});

app.get("/api/transcript/:video", async (c) => {
  const video = c.req.param("video");
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(video)) return c.json({ ok: false, reason: "bad-video" }, 400);
  const res = await transcriptAround(c.env, video, Math.max(0, Number(c.req.query("t")) || 0), c.executionCtx);
  return c.json(res, res.ok ? 200 : res.reason === "not-found" ? 404 : 503);
});

// The AI: a question answered from the teachings with citations, search by meaning, and
// the reading voices (a verse at a time, cached).
app.post("/api/ask", async (c) => {
  const body = await c.req.json<{ q?: string; history?: { role?: string; content?: string }[]; stream?: boolean; chat?: string }>().catch(() => null);
  const history = (Array.isArray(body?.history) ? body!.history! : []).filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string").slice(-8).map((t) => ({ role: t.role as "user" | "assistant", content: t.content! }));
  if (body?.stream) return askStream(c.env, String(body?.q ?? ""), c.get("tma").user!.id, c.executionCtx, history, typeof body?.chat === "string" && CHAT_ID.test(body.chat) ? body.chat : undefined);
  const res = await ask(c.env, String(body?.q ?? ""), c.get("tma").user!.id, c.executionCtx, history);
  return c.json(res, res.ok ? 200 : res.reason === "limit" ? 429 : res.reason === "too-short" ? 400 : 503);
});
// A note as a PDF: a signed link the app hands to Telegram's downloader, or the file sent to the
// person's chat with the bot. The link names the note and an expiry, signed with the bot token.
const NOTE_PATH = /^\/(classes|captains|history|study|encyclopedia)\/[A-Za-z0-9_-][A-Za-z0-9._/-]{0,160}$/;
const okNotePath = (p: string) => NOTE_PATH.test(p) && !p.includes("..");
async function pdfSig(env: Env, path: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`pdf:${env.BOT_TOKEN}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${path}|${exp}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
type NoteJson = { kind?: string; title?: string; date?: string; teacher?: string; url?: string; body?: string };
app.post("/api/notes/pdf", async (c) => {
  const body = await c.req.json<{ path?: string; send?: boolean }>().catch(() => null);
  const path = String(body?.path ?? "");
  if (!okNotePath(path)) return c.json({ ok: false, error: "Not a note." }, 400);
  const note = await dataJson<NoteJson>(c.env, `/api/notes${path}.json`, c.executionCtx);
  if (!note?.body) return c.json({ ok: false, error: "This note could not be found." }, 404);
  if (body?.send) {
    const bytes = await notePdf(note, { site: c.env.SITE_URL });
    try { await new Api(c.env.BOT_TOKEN).sendDocument(c.get("tma").user!.id, new InputFile(bytes, pdfName(note)), { caption: note.title }); }
    catch { return c.json({ ok: false, error: "The bot could not send you the file. Open a chat with the bot, press Start, and try again." }, 400); }
    return c.json({ ok: true, sent: true });
  }
  const exp = Math.floor(Date.now() / 1000) + 900;
  const url = `${new URL(c.req.url).origin}/api/pdf${path}?exp=${exp}&sig=${await pdfSig(c.env, path, exp)}`;
  return c.json({ ok: true, url, file: pdfName(note) });
});
// A backup of everything the reader kept (Bible Strong's Backup screen): the app sends its
// CloudStorage keys, the bot sends them back as a JSON file in the reader's chat. Nothing is
// stored on the server; the file goes straight to Telegram.
app.post("/api/backup", async (c) => {
  const body = await c.req.json<{ keys?: Record<string, string> }>().catch(() => null);
  const keys = body?.keys && typeof body.keys === "object" ? body.keys : null;
  if (!keys) return c.json({ ok: false, error: "Nothing to back up." }, 400);
  const entries = Object.entries(keys).filter(([k, v]) => /^[A-Za-z0-9_-]{1,128}$/.test(k) && typeof v === "string" && v.length <= 4096).slice(0, 1024);
  if (!entries.length) return c.json({ ok: false, error: "Nothing to back up." }, 400);
  const date = new Date().toISOString().slice(0, 10);
  const file = JSON.stringify({ app: "cyberjudah", version: 1, date, keys: Object.fromEntries(entries) }, null, 1);
  if (file.length > 2_000_000) return c.json({ ok: false, error: "The backup is too large to send." }, 413);
  try { await new Api(c.env.BOT_TOKEN).sendDocument(c.get("tma").user!.id, new InputFile(new TextEncoder().encode(file), `cyberjudah-backup-${date}.json`), { caption: `Your CyberJudah backup, ${date}: ${entries.length} entries. Restore it from Settings.` }); }
  catch { return c.json({ ok: false, error: "The bot could not send you the file. Open a chat with the bot, press Start, and try again." }, 400); }
  return c.json({ ok: true, entries: entries.length });
});
app.get("/api/pdf/*", async (c) => {
  const path = c.req.path.slice("/api/pdf".length);
  const exp = Number(c.req.query("exp")), sig = c.req.query("sig") ?? "";
  if (!okNotePath(path) || !(exp > Date.now() / 1000) || sig !== (await pdfSig(c.env, path, exp))) return c.text("This link has expired. Ask for the PDF again from the app.", 403);
  const note = await dataJson<NoteJson>(c.env, `/api/notes${path}.json`, c.executionCtx);
  if (!note?.body) return c.text("Not found", 404);
  const bytes = await notePdf(note, { site: c.env.SITE_URL });
  return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdfName(note)}"`, "cache-control": "private, max-age=600" } });
});

// Ask CyberJudah's allowance: what is left, what the plan and the packs give, and buying them with Stars.
app.get("/api/ask/account", async (c) => {
  const uid = c.get("tma").user!.id;
  const p = prices(c.env);
  const st = await standing(c.env, uid);
  return c.json({ ok: true, metered: billingOn(c.env), unlimited: st.unlimited, balance: st.balance, perQuestion: st.perQuestion, freeDaily: p.freeDaily, plan: p.plan, packs: p.packs });
});
app.post("/api/ask/buy", async (c) => {
  const item = String(((await c.req.json<{ item?: string }>().catch(() => null)) ?? {}).item ?? "");
  if (!/^(plan|pack:\d{1,6})$/.test(item)) return c.json({ ok: false, error: "Not an item." }, 400);
  if (!billingOn(c.env)) return c.json({ ok: false, error: "Plans are not on sale yet." }, 409);
  try { return c.json({ ok: true, link: await invoiceFor(c.env, c.get("tma").user!.id, item) }); }
  catch (e) { console.error(JSON.stringify({ event: "ask_invoice_failed", message: (e as Error).message?.slice(0, 160) })); return c.json({ ok: false, error: "The invoice could not be made." }, 502); }
});
// The admins' view of what Ask costs: questions and units a day, and what that comes to.
app.get("/api/admin/usage", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  const p = prices(c.env);
  const days = await Promise.all(Array.from({ length: 14 }, (_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)).map(async (day) => {
    const d = await usageDay(c.env, day);
    return { day, questions: d.questions, people: d.people, units: d.units, usd: Math.round((d.units / 1e6) * p.usdPerMtok * 100) / 100 };
  }));
  return c.json({ ok: true, usdPerMtok: p.usdPerMtok, usdPerStar: p.usdPerStar, margin: p.margin, days });
});

// The person's saved conversations with Ask CyberJudah: the list, one to reopen, one to delete.
app.get("/api/chats", async (c) => c.json({ ok: true, chats: await listChats(c.env, c.get("tma").user!.id) }));
app.get("/api/chats/:id", async (c) => {
  const chat = await getChat(c.env, c.get("tma").user!.id, c.req.param("id"));
  return chat ? c.json({ ok: true, chat }) : c.json({ ok: false, error: "not-found" }, 404);
});
app.delete("/api/chats/:id", async (c) => c.json({ ok: await deleteChat(c.env, c.get("tma").user!.id, c.req.param("id")) }));
app.get("/api/similar", async (c) => {
  const res = await similar(c.env, c.req.query("q") ?? "", Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 40));
  return c.json(res, res.ok ? 200 : 503);
});
app.get("/api/voices", (c) => c.json({ voices: VOICES }));
app.get("/api/tts/:slug/:ch/:verse", (c) => {
  const slug = c.req.param("slug"), ch = Number(c.req.param("ch")), verse = Number(c.req.param("verse"));
  if (!/^[a-z0-9-]{2,40}$/.test(slug) || !(ch >= 1 && ch <= 200) || !(verse >= 1 && verse <= 200)) return c.json({ ok: false, reason: "bad-reference" }, 400);
  return speakVerse(c.env, slug, ch, verse, c.req.query("voice") ?? "asteria", c.get("tma").user!.id, c.executionCtx);
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
  if (!SUPPORT_STARS.includes(stars)) return c.json({ error: "bad-amount" }, 400);
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

// A storyboard sheet, public like the thumbnails it stands in for; a year at the edge.
app.get("/frames/:video/:level/:file", async (c) => {
  const n = Number(c.req.param("file").match(/^(\d+)\.jpg$/)?.[1]);
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;
  const res = await sheet(c.env, c.req.param("video"), Number(c.req.param("level")), n, c.executionCtx);
  if (!res) return c.notFound();
  c.executionCtx.waitUntil(cache.put(c.req.raw, res.clone()));
  return res;
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
    // The hourly self-check pages the admins over Telegram when something breaks.
    ctx.waitUntil(selfCheck(env).then((r) => reportHealth(env, r)));
    // Old usage rows are pruned; the tables stay small.
    ctx.waitUntil(pruneBilling(env).catch((e) => console.error(JSON.stringify({ event: "prune_failed", message: (e as Error).message?.slice(0, 120) }))));
    // A few recordings' frames an hour, until the whole archive is in the bucket.
    ctx.waitUntil(warmFrames(env).then((r) => console.log(`frames: warmed ${r.warmed.length}, failed ${r.failed.length}`)));
  },
} satisfies ExportedHandler<Env>;
