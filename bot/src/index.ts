import { recordings, recordingAudio } from "./recordings";
import { Hono } from "hono";
import { Api, webhookCallback } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import type { Env, Sub } from "./env";
import { LAUNCH_DATA_MAX_AGE, validateInitData, type InitData } from "./initdata.mjs";
import { createBot, deletedSummary, todaysVerse } from "./bot";
import { chapter, dataJson, escapeHtml, openLink } from "./data";
import { runSearch } from "./search";
import { loadTranscript, searchTeachings, taughtIn, transcriptAround } from "./teachings";
import { findVisuals } from "./visuals.mjs";
import { liveNow, recentVideos } from "./live";
import { approvedSources, DEFAULT_SOURCES, HOST } from "./ask-tools";
import { ask, askStream, creditsOn, defaultModelId, freeModel, similar, speakVerse } from "./ai";
import { normalizeHistory, VOICES } from "./ai.mjs";
import { verseCard } from "./card";
import { sendDaily } from "./daily";
import { push, reminderCounts, reminders, sendReminders } from "./remind";
import { reportHealth, selfCheck } from "./health";
import { bookLabel } from "./verse-of-day.mjs";
import { dictionary } from "./dictionary";
import { bs } from "./bs";
import { buildCatalog, emptyCatalog, SLUGS, type PassageMediaMoment } from "./passage-media.mjs";
import { canEdit, commitEdit, isAdmin, readSource, type NoteEdit } from "./edit";
import { CHAT_ID, deleteChat, getChat, getPending, listChats, moveLegacy, setActionState } from "./chats";
import { askedBy, closeRequest, getRequest, listRequests, requestNotes, validVideo } from "./requests";
import { tellAdmins } from "./health";
import { notePdf, pdfName } from "./pdf.mjs";
import { invoiceFor, pruneBilling, refundStars, SUPPORT_STARS } from "./billing";
import { adjust, creditsConfig, history as creditHistory, ownerOfUser, prepare as prepareCredits, typicalMc, usageDayCredits, wallet as creditWallet } from "./credits";
import { getTopupReminder, sendTopupReminders, setTopupReminder } from "./topup-remind";
import { estimateMc, mcOfUsd } from "../../shared/credits.mjs";
import { pauseMessage, topupPause, zoneOf } from "../../shared/holy-days.mjs";
import { InputFile } from "grammy";
import { board, publicBoard, sheet, warmFrames, warmVideo } from "./frames";
import { hasClaude, unifiedBilling } from "./providers";
import { MODELS, modelOf, type AskModel } from "../../shared/ask-models.mjs";
import { pid, seal } from "./privacy.mjs";
import { migratePrivacy } from "./privacy-migrate";
import { deleteData, exportData } from "./mydata";
import { photoFile, photoManifest, removePhoto, setPhoto } from "./photos";
import { MAX_BYTES } from "./photos.mjs";

type App = { Bindings: Env; Variables: { tma: InitData } };
const app = new Hono<App>();
// Public Bible Strong resource feed; independent of Telegram authentication.
app.route("/bs", bs);
app.route("/api/recordings", recordings);
app.on(["GET", "HEAD"], "/api/audio/*", (c) => recordingAudio(c.req.raw, c.env));
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
  // Reading reminders authenticate themselves: Telegram launch data, a browser's device credential, or (for the service worker) its push endpoint.
  if (c.req.path === "/api/reminders" || c.req.path.startsWith("/api/reminders/") || c.req.path.startsWith("/api/push/")) return next();
  // The photos an admin sets are public pictures like the app's own: readers fetch them without signing in.
  if (c.req.method === "GET" && (c.req.path === "/api/photos" || c.req.path.startsWith("/api/photos/file/"))) return next();
  if (c.req.path === "/api/verse-of-day" || c.req.path === "/api/health" || c.req.path.startsWith("/api/dictionary") || (c.req.method === "GET" && /^\/api\/frames\/[A-Za-z0-9_-]{11}$/.test(c.req.path))) return next();
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  // Thirty days: Telegram keeps a Mini App open in the background for weeks, and its launch
  // data is only made afresh when it is opened again, so a short window turned every Search
  // and Ask into "not answering" for a reader who never closed the app. The signature still
  // proves who is asking; the age check only bounds a replay.
  const data = m ? await validateInitData(m[1], c.env.BOT_TOKEN, LAUNCH_DATA_MAX_AGE) : null;
  if (!data?.user) {
    const stale = m ? !!(await validateInitData(m[1], c.env.BOT_TOKEN, 10 * 365 * 86400))?.user : false;
    return c.json({ error: "unauthorized", reason: stale ? "stale" : m ? "invalid" : "missing" }, 401);
  }
  c.set("tma", data);
  await next();
});

app.route("/api/reminders", reminders);
app.route("/api/push", push);

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
  return c.json({ ok: search.ok && teachings.ok, search, teachings, ask: { model: hasClaude(c.env) ? c.env.CLAUDE_MODEL : "workers-ai", billing: unifiedBilling(c.env) ? "cloudflare" : hasClaude(c.env) ? "anthropic" : "none" }, at: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
});
app.get("/api/me", async (c) => {
  const { user } = c.get("tma");
  const sub = await c.env.SUBS.get(`sub:${await pid(c.env, user!.id)}`);
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

// Photos an admin sets from the app (bot/src/photos.ts): the manifest, the files, and setting or removing one.
app.get("/api/photos", async (c) => c.json(await photoManifest(c.env), 200, { "cache-control": "public, max-age=30" }));
app.get("/api/photos/file/*", (c) => photoFile(c.env, c.req.path.slice("/api/photos/file/".length)));
app.put("/api/admin/photos", async (c) => {
  const { user } = c.get("tma");
  if (Number(c.req.header("content-length") ?? 0) > MAX_BYTES) return c.json({ ok: false, error: "That photo is too large." }, 413);
  const res = await setPhoto(c.env, user!, c.req.query("slot") ?? "", await c.req.arrayBuffer());
  return res.ok ? c.json(res) : c.json({ ok: false, error: res.error }, res.status);
});
app.delete("/api/admin/photos", async (c) => {
  const { user } = c.get("tma");
  const res = await removePhoto(c.env, user!, c.req.query("slot") ?? "");
  return res.ok ? c.json(res) : c.json({ ok: false, error: res.error }, res.status);
});

// The outside sources Ask may read (ask-tools.ts): an admin sees and sets the whitelist.
app.get("/api/admin/ask-sources", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false, error: "Only an admin can see this." }, 403);
  return c.json({ ok: true, hosts: await approvedSources(c.env), defaults: DEFAULT_SOURCES });
});
app.put("/api/admin/ask-sources", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false, error: "Only an admin can change this." }, 403);
  const body = await c.req.json<{ hosts?: unknown }>().catch(() => null);
  const hosts = Array.isArray(body?.hosts) ? [...new Set(body!.hosts.map((h) => String(h).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")))] : null;
  if (!hosts || hosts.length > 100 || !hosts.every((h) => HOST.test(h))) return c.json({ ok: false, error: "Give a list of up to 100 site names, like wikipedia.org." }, 400);
  await c.env.SUBS.put("ask:sources", JSON.stringify(hosts));
  return c.json({ ok: true, hosts });
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const only = c.req.query("only") || undefined;
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 8, 1), 100);
  const res = await runSearch(c.env.DB, q, only, limit, false, c.req.query("live") === "1");
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
app.get("/api/recent", async (c) => { const r = await recentVideos(c.env, c.executionCtx); return c.json({ videos: r.videos, feedOk: r.ok }); });
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
  const body = await c.req.json<{ q?: string; history?: { role?: string; content?: string }[]; stream?: boolean; chat?: string; retry?: boolean; model?: string; consent?: unknown; request?: string; caps?: Record<string, unknown> }>().catch(() => null);
  // The request's id (a retry of the same request holds once), and the most the reader accepted a
  // request may cost on each model (balance units, mc): the server takes the one for the model it resolves.
  const caps = body?.caps && typeof body.caps === "object" ? Object.fromEntries(Object.entries(body.caps).filter(([k, v]) => k.length < 120 && typeof v === "number" && Number.isFinite(v) && v > 0).slice(0, 200)) as Record<string, number> : undefined;
  const meterOpts = { request: typeof body?.request === "string" ? body.request : undefined, caps };
  // The AI providers this reader has agreed may receive their questions (docs/PRIVACY.md).
  const consent = Array.isArray(body?.consent) ? body.consent.filter((x): x is string => typeof x === "string").slice(0, 40) : [];
  // Always a well-formed conversation for the model, whatever the app sent (see normalizeHistory).
  const history = normalizeHistory(body?.history, 8);
  if (body?.stream) return askStream(c.env, String(body?.q ?? ""), c.get("tma").user!.id, c.executionCtx, history, typeof body?.chat === "string" && CHAT_ID.test(body.chat) ? body.chat : undefined, body?.retry === true, typeof body?.model === "string" ? body.model : undefined, consent, meterOpts);
  const res = await ask(c.env, String(body?.q ?? ""), c.get("tma").user!.id, c.executionCtx, history, consent);
  if (!res.ok && res.reason === "consent") return c.json(res, 428);
  return c.json(res, res.ok ? 200 : res.reason === "limit" ? 429 : res.reason === "credits" ? 402 : res.reason === "too-short" ? 400 : 503);
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

// Ask CyberJudah's pay-as-you-go balance: what is left (in dollars, by the app), the top-ups on sale
// in Stars, whether they are paused for a Sabbath, feast day or New Moon where the reader is, what
// each model typically and at most costs, the history, and buying (shared/credits.mjs, credits.ts,
// billing.ts, shared/holy-days.mjs).
/**
 * Now, for the top-up pause. In the end-to-end tests only (E2E_CLOCK "on", never set in
 * wrangler.jsonc), a request may name the moment it is asked at, so a Sabbath can be tested on any day.
 */
const clock = (c: { env: Env; req: { header: (n: string) => string | undefined } }) => {
  const t = c.env.E2E_CLOCK === "on" ? Date.parse(c.req.header("x-e2e-now") ?? "") : NaN;
  return Number.isFinite(t) ? t : Date.now();
};
const askModels = (env: Env) => MODELS.filter((m) => (m.format === "anthropic" ? hasClaude(env) : !!env.AI_GATEWAY));
async function modelCosts(env: Env, models: AskModel[]) {
  const cfg = creditsConfig(env);
  return Promise.all(models.map(async (m) => {
    const est = estimateMc(m, cfg, { claudeViaCloudflare: unifiedBilling(env) });
    return { id: m.id, name: m.name, provider: m.provider, what: m.what, typical_mc: (await typicalMc(env, m.id).catch(() => null)) ?? est.typicalMc, max_mc: est.maxMc, ...(m.id === freeModel(env).id ? { free: true } : {}) };
  }));
}
app.get("/api/ask/account", async (c) => {
  const uid = c.get("tma").user!.id;
  const cfg = creditsConfig(c.env);
  const owner = await ownerOfUser(c.env, uid);
  if (creditsOn(c.env)) await prepareCredits(c.env, owner, { uid });
  const tz = zoneOf(c.req.query("tz"));
  const pause = topupPause(clock(c), tz);
  return c.json({
    ok: true, metered: creditsOn(c.env), unlimited: isAdmin(c.env, uid),
    wallet: await creditWallet(c.env, owner),
    confirm_above_mc: cfg.confirmAboveMc,
    // Top-ups: each in dollars and the Stars it costs, at what a Star pays out (usd_per_star).
    sale: { open: !cfg.missing.length, usd_per_star: cfg.usdPerStar, topups: cfg.topups, pause: pause ? { kind: pause.kind, until: pause.until, message: pauseMessage(pause) } : null },
    remind: await getTopupReminder(c.env, uid).catch(() => ({ on: false, tz: null })),
    models: await modelCosts(c.env, askModels(c.env)),
    model: modelOf(defaultModelId(c.env, uid)).id,
  });
});
app.get("/api/ask/history", async (c) => c.json({ ok: true, items: await creditHistory(c.env, await ownerOfUser(c.env, c.get("tma").user!.id), 60) }));
app.post("/api/ask/buy", async (c) => {
  const b = (await c.req.json<{ item?: string; tz?: string }>().catch(() => null)) ?? {};
  const item = String(b.item ?? "");
  if (!/^pack:\d{1,6}$/.test(item)) return c.json({ ok: false, error: "Not an item." }, 400);
  if (!creditsOn(c.env)) return c.json({ ok: false, error: "Top-ups are not on sale yet." }, 409);
  try {
    const r = await invoiceFor(c.env, c.get("tma").user!.id, item, zoneOf(b.tz), clock(c));
    if (r.ok) return c.json({ ok: true, link: r.link });
    // A Sabbath, feast day or New Moon where the reader is: no invoice is made.
    if (r.reason === "pause") return c.json({ ok: false, error: "pause", reason: "pause", message: r.message, until: r.pause.until }, 423);
    console.error(JSON.stringify({ event: "ask_sale_closed", missing: r.missing.length }));
    return c.json({ ok: false, error: "Top-ups are not on sale just yet." }, 409);
  } catch (e) { console.error(JSON.stringify({ event: "ask_invoice_failed", message: (e as Error).message?.slice(0, 160) })); return c.json({ ok: false, error: "The invoice could not be made." }, 502); }
});
// "Remind me to top up before the Sabbath and feast days" (topup-remind.ts): on or off, with the reader's zone.
app.get("/api/ask/remind", async (c) => c.json({ ok: true, ...(await getTopupReminder(c.env, c.get("tma").user!.id)) }));
app.post("/api/ask/remind", async (c) => {
  const b = (await c.req.json<{ on?: boolean; tz?: string }>().catch(() => null)) ?? {};
  return c.json({ ok: true, ...(await setTopupReminder(c.env, c.get("tma").user!.id, b.on === true, b.tz)) });
});
// The admins' view: what Ask cost and was charged each day, and the pricing and what it still lacks.
app.get("/api/admin/usage", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  const cfg = creditsConfig(c.env);
  const days = await Promise.all(Array.from({ length: 14 }, (_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)).map(async (day) => ({ day, ...(await usageDayCredits(c.env, day)) })));
  const remindersByChannel = await reminderCounts(c.env).catch(() => null);
  return c.json({ ok: true, pricing: { usdPerStar: cfg.usdPerStar, margin: cfg.margin, topups: cfg.topups, unifiedFee: cfg.unifiedFee, confirmAboveMc: cfg.confirmAboveMc, maxRequestMc: cfg.maxRequestMc, research: cfg.research, missing: cfg.missing }, days, reminders: remindersByChannel });
});
// An admin's refund: the Stars back through Telegram, and what that payment added and is unspent taken back.
app.post("/api/admin/refund", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  const b = await c.req.json<{ user?: number; charge?: string }>().catch(() => null);
  if (!b || !Number.isSafeInteger(b.user) || typeof b.charge !== "string" || !b.charge) return c.json({ ok: false, error: "user and charge" }, 400);
  try { return c.json({ ok: true, result: await refundStars(c.env, b.user!, b.charge) }); }
  catch (e) { return c.json({ ok: false, error: (e as Error).message?.slice(0, 160) }, 502); }
});
// An admin's adjustment to a reader's balance, in dollars (a correction, or a gift): added, or
// taken (never below zero), once per `ref`, recorded in the reader's history.
app.post("/api/admin/adjust", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  const b = await c.req.json<{ user?: number; usd?: number; ref?: string; note?: string }>().catch(() => null);
  if (!b || !Number.isSafeInteger(b.user) || typeof b.usd !== "number" || !Number.isFinite(b.usd) || !b.usd || Math.abs(b.usd) > 1000 || typeof b.ref !== "string" || !/^[\w.:-]{1,64}$/.test(b.ref)) return c.json({ ok: false, error: "user, usd and ref" }, 400);
  const owner = await ownerOfUser(c.env, b.user!);
  await prepareCredits(c.env, owner, { uid: b.user! });
  const mc = Math.sign(b.usd) * mcOfUsd(Math.abs(b.usd));
  return c.json({ ok: true, moved_mc: await adjust(c.env, owner, mc, b.ref, String(b.note ?? "").slice(0, 200)), wallet: await creditWallet(c.env, owner) });
});

// The person's saved conversations with Ask CyberJudah: the list, one to reopen, one to delete.
// Requests for class notes: a reader asks for a class's notes (one vote each); the admins see the
// most asked for first and are told as a class gathers asks.
app.get("/api/requests", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  return c.json({ ok: true, requests: await listRequests(c.env) });
});
app.get("/api/requests/:video", async (c) => {
  const video = c.req.param("video");
  if (!validVideo(video)) return c.json({ ok: false, error: "bad-video" }, 400);
  const r = await getRequest(c.env, video);
  return c.json({ ok: true, count: r?.count ?? 0, mine: await askedBy(c.env, r, c.get("tma").user!.id) });
});
app.post("/api/requests/:video", async (c) => {
  const video = c.req.param("video");
  if (!validVideo(video)) return c.json({ ok: false, error: "bad-video" }, 400);
  const body = await c.req.json().catch(() => ({})) as { title?: unknown };
  const title = typeof body.title === "string" ? body.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) : "";
  const res = await requestNotes(c.env, video, c.get("tma").user!.id, title, new Date(), (r) => {
    c.executionCtx.waitUntil(tellAdmins(c.env, `Notes requested ${r.count === 1 ? "for the first time" : `${r.count} times`}: ${r.title || video}\nhttps://www.youtube.com/watch?v=${video}\nDraft them from the draft-notes workflow with this video id: ${video}`));
  });
  return c.json({ ok: true, ...res });
});
app.delete("/api/requests/:video", async (c) => {
  if (!isAdmin(c.env, c.get("tma").user!.id)) return c.json({ ok: false }, 403);
  return c.json({ ok: await closeRequest(c.env, c.req.param("video")) });
});
app.get("/api/chats", async (c) => c.json({ ok: true, chats: await listChats(c.env, c.get("tma").user!.id) }));
// A conversation, and the question it is still answering if there is one (a refresh or another device waits for it).
app.get("/api/chats/:id", async (c) => {
  const uid = c.get("tma").user!.id, id = c.req.param("id");
  const [chat, pending] = await Promise.all([getChat(c.env, uid, id), getPending(c.env, uid, id)]);
  if (!chat && !pending) return c.json({ ok: false, error: "not-found" }, 404);
  return c.json({ ok: true, chat, pending });
});
// The reader applied or cancelled a change the assistant proposed (the change itself is made through its own API).
app.post("/api/chats/:id/actions/:action", async (c) => {
  const body = await c.req.json<{ state?: string }>().catch(() => null);
  const state = body?.state === "applied" || body?.state === "cancelled" ? body.state : null;
  const action = c.req.param("action");
  if (!state || !/^[0-9a-f]{16}$/.test(action)) return c.json({ ok: false }, 400);
  const ok = await setActionState(c.env, c.get("tma").user!.id, c.req.param("id"), action, state);
  return c.json({ ok }, ok ? 200 : 404);
});
app.delete("/api/chats/:id", async (c) => {
  const ok = await deleteChat(c.env, c.get("tma").user!.id, c.req.param("id"));
  return c.json({ ok }, ok ? 200 : 400);
});
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

// Privacy (docs/PRIVACY.md): a copy of everything kept about the reader, and deletion of all of it.
app.get("/api/privacy/export", async (c) => c.json(await exportData(c.env, c.get("tma").user!.id)));
app.post("/api/privacy/export/send", async (c) => {
  const uid = c.get("tma").user!.id;
  const data = await exportData(c.env, uid);
  const date = data.generated.slice(0, 10);
  try { await new Api(c.env.BOT_TOKEN).sendDocument(uid, new InputFile(new TextEncoder().encode(JSON.stringify(data, null, 2)), `cyberjudah-my-data-${date}.json`), { caption: `Everything CyberJudah keeps about you, ${date}.` }); }
  catch { return c.json({ ok: false, error: "The bot could not send you the file. Open a chat with the bot, press Start, and try again." }, 400); }
  return c.json({ ok: true });
});
app.post("/api/privacy/delete", async (c) => {
  const body = await c.req.json<{ confirm?: unknown }>().catch(() => null);
  if (body?.confirm !== "delete") return c.json({ ok: false, error: "Confirm with { confirm: \"delete\" }." }, 400);
  const d = await deleteData(c.env, c.get("tma").user!.id);
  return c.json({ ok: true, deleted: d, summary: deletedSummary(d) });
});

app.post("/api/subscribe", async (c) => {
  const { user } = c.get("tma");
  const body = await c.req.json<{ on?: boolean; hour?: number; tz?: number }>().catch(() => null);
  if (!body) return c.json({ error: "bad-json" }, 400);
  const key = `sub:${await pid(c.env, user!.id)}`;
  if (!body.on) { await c.env.SUBS.delete(key); return c.json({ subscribed: false }); }
  const hour = Number.isInteger(body.hour) && body.hour! >= 0 && body.hour! <= 23 ? body.hour! : 8;
  const tz = Number.isInteger(body.tz) && Math.abs(body.tz!) <= 14 * 60 ? body.tz! : 0;
  // Private chat id equals the user id; the daily message goes there.
  const sub: Sub = { chatId: user!.id, hour, tz };
  // Sealed at rest (privacy.mjs): the chat ID is read only to send the verse.
  await c.env.SUBS.put(key, await seal(c.env, key, sub));
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

// The Bible Strong fork, staged at /app/strong: a real file is served as is; any other path
// under it is one of its screens, so it gets the fork's index.html (the asset fallback would
// give the current app's).
// The reader's inline class videos for one chapter, public and same-origin with the fork.
app.get("/app/strong/_media/:book/:chapter", async (c) => {
  const book = Number(c.req.param("book")), chapter = Number(c.req.param("chapter"));
  if (!Number.isInteger(book) || !Number.isInteger(chapter)) return c.notFound();
  const slug = SLUGS[book - 1];
  const ok = slug && chapter >= 1 && chapter <= 200;
  const data = ok ? await dataJson<{ moments?: PassageMediaMoment[] }>(c.env, `/api/concordance/${slug}/${chapter}.json`, c.executionCtx) : null;
  const catalog = ok ? buildCatalog(book, chapter, data?.moments ?? []) : emptyCatalog();
  return c.json(catalog, 200, { "cache-control": "public, max-age=3600" });
});
app.get("/app/strong/*", async (c) => {
  const url = new URL(c.req.url);
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return c.env.ASSETS.fetch(c.req.raw);
  return c.env.ASSETS.fetch(new Request(new URL("/app/strong/", url), c.req.raw));
});
app.get("/app/strong", (c) => c.redirect("/app/strong/" + new URL(c.req.url).search, 301));

// Anything else is the Mini App (run_worker_first only routes the paths above here).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  scheduled(event, env, ctx) {
    // Reading reminders every quarter hour, so each reader's own time is reached in every time zone (remind.ts).
    ctx.waitUntil(sendReminders(env, new Date(event.scheduledTime)).catch((e) => console.error(JSON.stringify({ event: "reminders_failed", message: (e as Error).message?.slice(0, 120) }))));
    // The opt-in reminder to top up before a Sabbath, feast day or New Moon, at midday where each reader is (topup-remind.ts).
    ctx.waitUntil(sendTopupReminders(env, event.scheduledTime).then((r) => { if (r.checked) console.log(JSON.stringify({ event: "topup_reminders", ...r })); }).catch((e) => console.error(JSON.stringify({ event: "topup_reminders_failed", message: (e as Error).message?.slice(0, 120) }))));
    // Everything else runs on the hour only.
    if (event.cron !== "0 * * * *") return;
    ctx.waitUntil(sendDaily(env, new Date(event.scheduledTime)));
    // The hourly self-check pages the admins over Telegram when something breaks.
    ctx.waitUntil(selfCheck(env).then((r) => reportHealth(env, r)));
    // Old usage rows are pruned; the tables stay small.
    ctx.waitUntil(pruneBilling(env).catch((e) => console.error(JSON.stringify({ event: "prune_failed", message: (e as Error).message?.slice(0, 120) }))));
    // Records still filed under Telegram IDs move to pseudonymous IDs (docs/PRIVACY.md), a bounded amount each hour.
    ctx.waitUntil(migratePrivacy(env, moveLegacy).then((r) => { if (r.moved) console.log(JSON.stringify({ event: "privacy_migrated", moved: r.moved, done: r.done })); }).catch((e) => console.error(JSON.stringify({ event: "privacy_migrate_failed", message: (e as Error).message?.slice(0, 120) }))));
    // A few recordings' frames an hour, until the whole archive is in the bucket.
    ctx.waitUntil(warmFrames(env).then((r) => console.log(`frames: warmed ${r.warmed.length}, failed ${r.failed.length}`)));
  },
} satisfies ExportedHandler<Env>;
