import { Bot, InlineKeyboard, type Context } from "grammy";
import type { InlineQueryResultArticle, UserFromGetMe } from "grammy/types";
import type { Env, Exec, Sub } from "./env";
import { books, chapter, openLink, verseLink, verseMessage, escapeHtml } from "./data";
import { runSearch } from "./search";
import { parseReference } from "./refs.mjs";
import { verseOfDay } from "./verse-of-day.mjs";
import { pathToStartParam, startParamToPath } from "../../shared/links.mjs";

const SAFE_PARAM = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_INLINE = 50;

/** getMe once per isolate: the webhook handler otherwise asks Telegram on every update. */
let botInfo: UserFromGetMe | undefined;

/**
 * A button that opens the app. Private chats may open a Mini App straight from a keyboard
 * (web_app, at this Worker's own URL with the start param in the query, where the app reads
 * it); groups and channels get the t.me deep link, or the site until the app is registered.
 */
export function openButton(env: Env, origin: string, chatType: string | undefined, param: string, text = "Open in CyberJudah"): InlineKeyboard {
  const kb = new InlineKeyboard();
  const base = origin || env.WORKER_URL;
  if (chatType === "private" && base) return kb.webApp(text, `${base}/${param ? `?tgWebAppStartParam=${param}` : ""}`);
  return kb.url(text, openLink(env, param));
}

/** Today's verse, as a Telegram HTML message plus the start param that opens it. */
export async function todaysVerse(env: Env, ctx?: Exec) {
  const v = verseOfDay();
  const ch = await chapter(env, v.slug, v.chapter, ctx);
  const text = ch?.verses.find((x) => x.verse === v.verse)?.text ?? "";
  const param = pathToStartParam(`/bible/${v.slug}/${v.chapter}`, String(v.verse));
  return { ...v, text, param, html: verseMessage(env, v.ref, text, v.slug, v.chapter, String(v.verse)) };
}

const HELP = [
  "<b>CyberJudah</b> — the KJV with the Apocrypha, the classes, the law, the precepts and the cases.",
  "",
  "/verse — today's verse",
  "/daily — the daily verse, on or off",
  "/reading — your four-chapter reading tracker",
  "/stopreading — pause reading reminders and recaps",
  "/support — support the work with Telegram Stars",
  "/help — this",
  "",
  "In any chat, type <code>@BOT matthew 15:24</code> or <code>@BOT passover</code> to send a verse or a search hit.",
].join("\n");

export async function createBot(env: Env, origin: string, exec?: Exec): Promise<Bot> {
  const bot = new Bot(env.BOT_TOKEN, { botInfo });
  const open = (ctx: Context, param: string, text?: string) => openButton(env, origin, ctx.chat?.type, param, text);

  bot.command("start", async (ctx) => {
    const param = SAFE_PARAM.test(ctx.match) ? ctx.match : "";
    if (param) {
      const path = startParamToPath(param);
      const label = path === "/" ? "CyberJudah" : path.replace(/[?#].*$/, "").split("/").filter(Boolean).map((p) => p.replace(/-/g, " ")).join(" › ");
      return ctx.reply(`Open <b>${escapeHtml(label)}</b> in CyberJudah:`, { parse_mode: "HTML", reply_markup: open(ctx, param, "Open") });
    }
    await ctx.reply(`Welcome, ${escapeHtml(ctx.from?.first_name ?? "friend")}.\n\n${HELP.replace(/@BOT/g, `@${bot.botInfo.username}`)}`, {
      parse_mode: "HTML",
      reply_markup: open(ctx, "", "Open CyberJudah"),
    });
  });

  bot.command("help", (ctx) => ctx.reply(HELP.replace(/@BOT/g, `@${bot.botInfo.username}`), { parse_mode: "HTML", reply_markup: open(ctx, "", "Open CyberJudah") }));
  bot.command('reading', ctx => ctx.reply('Four chapters a day. Set your reminder time and track your reading in the app.', { reply_markup: open(ctx, 'plan', 'Open Bible tracker') }));
  bot.command('stopreading', async ctx => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    await env.DB.prepare('UPDATE reading_settings SET enabled=0,weekly=0 WHERE user_id=?').bind(ctx.from.id).run();
    await ctx.reply('Reading reminders and weekly recaps are paused. Your progress is saved.', { reply_markup: open(ctx, 'plan', 'Manage reading') });
  });
  bot.callbackQuery('reading:pause', async ctx => {
    await env.DB.prepare('UPDATE reading_settings SET enabled=0,weekly=0 WHERE user_id=?').bind(ctx.from.id).run();
    await ctx.answerCallbackQuery({ text: 'Reading messages paused. Your progress is saved.' });
  });

  bot.command("verse", async (ctx) => {
    const v = await todaysVerse(env, exec);
    if (!v.text) return ctx.reply("The verse is not available right now; try again in a moment.");
    await ctx.reply(v.html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: open(ctx, v.param, "Read the chapter") });
  });

  bot.command("daily", async (ctx) => {
    if (ctx.chat.type !== "private") return ctx.reply("The daily verse is sent in a private chat: message me directly and send /daily there.");
    const key = `sub:${ctx.from!.id}`;
    const had = await env.SUBS.get(key);
    if (had) {
      await env.SUBS.delete(key);
      return ctx.reply("The daily verse is off. Send /daily to turn it back on.");
    }
    // The bot cannot know the person's time zone: 08:00 UTC until the app sets their hour.
    const sub: Sub = { chatId: ctx.chat.id, hour: 8, tz: 0 };
    await env.SUBS.put(key, JSON.stringify(sub));
    await ctx.reply("The daily verse is on, every day at 08:00 UTC. Pick your own hour in the app's settings, or send /daily to stop.", { reply_markup: open(ctx, "settings", "Open settings") });
  });

  bot.command("support", (ctx) =>
    ctx.replyWithInvoice("Support CyberJudah", "Keep the library free and the classes online. Thank you.", `support:${ctx.from?.id ?? 0}:100`, "XTR", [{ label: "Support CyberJudah", amount: 100 }]));

  bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
  bot.on("message:successful_payment", (ctx) =>
    ctx.reply(`Thank you, ${escapeHtml(ctx.from.first_name)}: ${ctx.message.successful_payment.total_amount} Stars received. Study to shew thyself approved.`, { parse_mode: "HTML" }));

  // A keyboard-button launch (sendData) lands here: say what arrived so the person sees it worked.
  bot.on("message:web_app_data", (ctx) => ctx.reply(`Received from the app: ${escapeHtml(ctx.message.web_app_data.data).slice(0, 1000)}`));

  bot.on("inline_query", async (ctx) => {
    const q = ctx.inlineQuery.query.trim().slice(0, 200);
    const offset = Number(ctx.inlineQuery.offset) || 0;
    let results: InlineQueryResultArticle[] = [];
    let next_offset = "";
    if (!q) {
      const v = await todaysVerse(env, exec);
      if (v.text) results = [article("today", `Verse of the day · ${v.ref}`, v.text, v.html, verseLink(env, v.slug, v.chapter, String(v.verse)))];
    } else {
      const list = (await books(env, exec)) ?? [];
      const ref = parseReference(q, list);
      if (ref) {
        const ch = await chapter(env, ref.slug, ref.chapter, exec);
        if (ch) {
          if (ref.verse && ref.verseEnd) {
            const span = ch.verses.filter((v) => v.verse >= ref.verse! && v.verse <= ref.verseEnd!).slice(0, 40);
            if (span.length) {
              const text = span.map((v) => `${v.verse} ${v.text}`).join(" ");
              const verses = `${span[0].verse}-${span[span.length - 1].verse}`;
              const label = `${ref.book} ${ref.chapter}:${verses}`;
              results = [article(`${ref.slug}-${ref.chapter}-${verses}`, label, text, verseMessage(env, label, text, ref.slug, ref.chapter, verses), verseLink(env, ref.slug, ref.chapter, verses))];
            }
          } else {
            const all = ref.verse ? ch.verses.filter((v) => v.verse === ref.verse) : ch.verses;
            const page = all.slice(offset, offset + MAX_INLINE);
            results = page.map((v) => {
              const label = `${ref.book} ${ref.chapter}:${v.verse}`;
              return article(`${ref.slug}-${ref.chapter}-${v.verse}`, label, v.text, verseMessage(env, label, v.text, ref.slug, ref.chapter, String(v.verse)), verseLink(env, ref.slug, ref.chapter, String(v.verse)));
            });
            if (all.length > offset + MAX_INLINE) next_offset = String(offset + MAX_INLINE);
          }
        }
      } else if (q.length >= 3) {
        const found = await runSearch(env.DB, q, ["verse", "class"], 10, true);
        if (found.ok) {
          results = found.hits.slice(0, MAX_INLINE).map((h, i) => {
            const [path, hash = ""] = h.url.split("#");
            const verses = hash.match(/^v(\d+(?:-\d+)?)$/)?.[1];
            const link = appLinkFor(env, path, verses);
            const site = `${env.SITE_URL}${h.url}`;
            // A verse is sent whole; a class piece as its snippet under the title.
            const html = h.kind === "verse"
              ? verseMessage(env, h.title, h.text ?? h.snippet, path.split("/")[2] ?? "", Number(path.split("/")[3]) || 0, verses)
              : `<b>${escapeHtml(h.title)}</b>${h.sub ? ` · ${escapeHtml(h.sub)}` : ""}\n${escapeHtml(h.snippet)}\n\n<a href="${site}">cyberjudah.io</a>`;
            return article(`s${i}-${hashOf(h.url)}`, h.title, h.snippet, html, link, h.kind === "verse" ? "" : h.kind);
          });
        }
      }
    }
    await ctx.answerInlineQuery(results, {
      cache_time: 300,
      is_personal: false,
      next_offset,
      button: origin || env.WORKER_URL ? { text: "Open CyberJudah", web_app: { url: `${origin || env.WORKER_URL}/` } } : undefined,
    });
  });

  bot.on("chosen_inline_result", () => {});

  bot.catch((err) => console.error(JSON.stringify({ event: "bot_error", update: err.ctx.update.update_id, message: err.message })));

  if (!botInfo) {
    await bot.init();
    botInfo = bot.botInfo;
  }
  return bot;
}

function appLinkFor(env: Env, path: string, verses?: string): string {
  const m = path.match(/^\/bible\/([a-z0-9-]+)\/(\d+)$/);
  if (m) return verseLink(env, m[1], Number(m[2]), verses);
  return openLink(env, pathToStartParam(path));
}

/** An inline article: the description is the plain text, the message the HTML, the button the deep link. */
function article(id: string, title: string, description: string, html: string, link: string, sub = ""): InlineQueryResultArticle {
  return {
    type: "article",
    id: id.slice(0, 64),
    title: sub ? `${title} · ${sub}` : title,
    description: description.slice(0, 200),
    input_message_content: { message_text: html.slice(0, 4096), parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    reply_markup: new InlineKeyboard().url("Open in CyberJudah", link),
  };
}

/** Inline result ids are limited to 64 bytes; a short stable digest keeps long note urls under it. */
function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
