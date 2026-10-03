import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import type { InlineQueryResultArticle, UserFromGetMe } from "grammy/types";
import { tellAdmins } from "./health";
import type { Env, Exec, Sub } from "./env";
import { books, chapter, openLink, verseLink, verseMessage, escapeHtml } from "./data";
import { runSearch } from "./search";
import { parseReference } from "./refs.mjs";
import { verseOfDay } from "./verse-of-day.mjs";
import { pathToStartParam, startParamToPath } from "../../shared/links.mjs";
import { applyPayment, checkout, SUPPORT_STARS } from "./billing";
import { linkDevice, reminderButton, reminderKeyboard, stopFor, telegramReturned } from "./remind";
import { pid, seal } from "./privacy.mjs";
import { deleteData, deletionToken, exportData, useDeletionToken, type Deleted } from "./mydata";

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
  "/stop — stop reading reminders",
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
    // A reader who blocked the bot and starts it again gets their reading reminders back.
    if (ctx.chat.type === "private" && ctx.from) await telegramReturned(env, ctx.from.id).catch(() => undefined);
    // A browser asking for reading reminders in this chat (Settings → Reading reminders → Start the bot).
    const link = /^remind_([0-9a-f]{32})$/.exec(param);
    if (link && ctx.chat.type === "private" && ctx.from) {
      const ok = await linkDevice(env, link[1], ctx.from.id);
      return ctx.reply(ok ? "Your reading reminders will come to this chat. Change them in Settings → Reading reminders." : "That link has expired. Open Settings → Reading reminders and press Start the bot again.", { reply_markup: open(ctx, "settings_reminders", "Reading reminders") });
    }
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
  bot.command("verse", async (ctx) => {
    const v = await todaysVerse(env, exec);
    if (!v.text) return ctx.reply("The verse is not available right now; try again in a moment.");
    await ctx.reply(v.html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: open(ctx, v.param, "Read the chapter") });
  });

  bot.command("daily", async (ctx) => {
    if (ctx.chat.type !== "private") return ctx.reply("The daily verse is sent in a private chat: message me directly and send /daily there.");
    const key = `sub:${await pid(env, ctx.from!.id)}`;
    const had = await env.SUBS.get(key);
    if (had) {
      await env.SUBS.delete(key);
      return ctx.reply("The daily verse is off. Send /daily to turn it back on.");
    }
    // The bot cannot know the person's time zone: 08:00 UTC until the app sets their hour.
    const sub: Sub = { chatId: ctx.chat.id, hour: 8, tz: 0 };
    await env.SUBS.put(key, await seal(env, key, sub));
    await ctx.reply("The daily verse is on, every day at 08:00 UTC. Pick your own hour in the app's settings, or send /daily to stop.", { reply_markup: open(ctx, "settings", "Open settings") });
  });

  // One command to stop reading reminders from the chat itself.
  bot.command("stop", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return;
    const was = await stopFor(env, ctx.from.id);
    await ctx.reply(was ? "Reading reminders are off. Turn them on again in Settings → Reading reminders." : "Reading reminders are not on.", { reply_markup: open(ctx, "settings_reminders", "Reading reminders") });
  });
  // Unblocking the bot (Telegram sends my_chat_member) also brings reminders back.
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type === "private" && ctx.myChatMember.new_chat_member.status === "member") await telegramReturned(env, ctx.from.id).catch(() => undefined);
  });

  // Privacy (docs/PRIVACY.md): read the policy, get a copy of what is kept, or delete it all.
  bot.command("privacy", (ctx) =>
    ctx.reply("What CyberJudah keeps about you, why, for how long, and who else sees it: read the privacy policy. Send /mydata for a copy of everything kept, or /deletemydata to delete it all.", { reply_markup: open(ctx, "privacy", "Privacy policy") }));
  bot.command("mydata", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return ctx.reply("Send /mydata in a private chat with me.");
    const data = await exportData(env, ctx.from.id);
    const date = data.generated.slice(0, 10);
    await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(JSON.stringify(data, null, 2)), `cyberjudah-my-data-${date}.json`), { caption: `Everything CyberJudah keeps about you, ${date}.` });
  });
  bot.command("deletemydata", async (ctx) => {
    if (ctx.chat.type !== "private" || !ctx.from) return ctx.reply("Send /deletemydata in a private chat with me.");
    const token = await deletionToken(env, ctx.from.id);
    await ctx.reply("This deletes everything CyberJudah keeps about you: your saved Ask chats, your reading reminder, the daily verse, your Ask allowance (any Stars credit or plan left is lost) and your class-note requests. It cannot be undone. Your highlights and notes on your device are not touched.", {
      reply_markup: new InlineKeyboard().text("Delete everything", `privacydel:${token}`).text("Cancel", "privacydel:no"),
    });
  });
  bot.callbackQuery(/^privacydel:([a-f0-9]{16}|no)$/, async (ctx) => {
    if (ctx.match[1] === "no" || !ctx.from) { await ctx.answerCallbackQuery({ text: "Nothing was deleted." }); return ctx.editMessageText("Nothing was deleted."); }
    if (!(await useDeletionToken(env, ctx.match[1], ctx.from.id))) return ctx.answerCallbackQuery({ text: "That button has expired. Send /deletemydata again." });
    const d = await deleteData(env, ctx.from.id);
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(deletedSummary(d));
  });
  // Required for Stars sales (Telegram Bot Developer Terms 6.2.1): payment problems reach the admins.
  bot.command("paysupport", async (ctx) => {
    if (!ctx.from) return;
    await tellAdmins(env, `Payment support asked for by ${ctx.from.first_name}${ctx.from.username ? ` (@${ctx.from.username})` : ""}, Telegram ID ${ctx.from.id}: "${(ctx.match || "").slice(0, 500)}"`).catch(() => undefined);
    await ctx.reply("Your request has reached the CyberJudah admins, who will reply to you here in Telegram. If something you paid for in Stars did not arrive, say what you bought and when (send /paysupport followed by the details).");
  });

  bot.command("support", (ctx) =>
    ctx.reply("Support CyberJudah with Telegram Stars — keep the library free and the classes online. Thank you.\n\nPick an amount:", {
      reply_markup: new InlineKeyboard().text("50 ⭐", "support:50").text("100 ⭐", "support:100").text("500 ⭐", "support:500"),
    }));

  // A support tier picked from /support: the invoice for that many Stars.
  bot.callbackQuery(/^support:(\d+)$/, async (ctx) => {
    const stars = Number(ctx.match[1]);
    if (!SUPPORT_STARS.includes(stars)) return ctx.answerCallbackQuery({ text: "That amount is not on offer." });
    await ctx.replyWithInvoice("Support CyberJudah", "Keep the library free and the classes online. Thank you.", `support:${ctx.from?.id ?? 0}:${stars}`, "XTR", [{ label: "Support CyberJudah", amount: stars }]);
    return ctx.answerCallbackQuery();
  });

  // The Done / Pause / Stop buttons under a reading reminder.
  bot.callbackQuery(/^rd:(done|stop|pause|back)(?::(\d))?$/, async (ctx) => {
    const action = ctx.match[1], n = ctx.match[2] ? Number(ctx.match[2]) : undefined;
    // rd:pause:0 is "until I resume".
    const until = n === 0 ? "forever" as const : n;
    // Pause asks how long first; Cancel puts the usual buttons back.
    if ((action === "pause" && until === undefined) || action === "back") {
      const kb = await reminderKeyboard(env, ctx.from.id, action === "pause");
      if (kb) await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => undefined);
      return ctx.answerCallbackQuery();
    }
    const text = await reminderButton(env, ctx.from.id, action as "done" | "pause" | "stop", until);
    if (action !== "done") await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    return ctx.answerCallbackQuery({ text });
  });

  // Stars are taken only for a real item at its real price, bought by the person paying.
  bot.on("pre_checkout_query", (ctx) => {
    const q = ctx.preCheckoutQuery;
    return checkout(env, q.invoice_payload, q.currency, q.total_amount, q.from.id) ? ctx.answerPreCheckoutQuery(true) : ctx.answerPreCheckoutQuery(false, { error_message: "This item or price has changed. Open Ask CyberJudah and try again." });
  });
  bot.on("message:successful_payment", async (ctx) => {
    const pay = ctx.message.successful_payment;
    const got = await applyPayment(env, ctx.from.id, pay);
    if (got === "plan") return ctx.reply(`Thank you, ${escapeHtml(ctx.from.first_name)}. Your month of Ask CyberJudah is on; it renews itself each month until you cancel it in Telegram's settings.`, { parse_mode: "HTML", reply_markup: open(ctx, "ask", "Ask CyberJudah") });
    if (got === "pack") return ctx.reply(`Thank you, ${escapeHtml(ctx.from.first_name)}. ${pay.total_amount} Stars of Ask CyberJudah added; the credit does not expire.`, { parse_mode: "HTML", reply_markup: open(ctx, "ask", "Ask CyberJudah") });
    return ctx.reply(`Thank you, ${escapeHtml(ctx.from.first_name)}: ${pay.total_amount} Stars received. Study to shew thyself approved.`, { parse_mode: "HTML" });
  });

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

/** What Delete my data removed, said plainly. */
export function deletedSummary(d: Deleted): string {
  const parts = [
    `${d.savedChats} saved Ask ${d.savedChats === 1 ? "chat" : "chats"}`,
    d.readingReminder ? "your reading reminder" : "",
    d.dailyVerse ? "the daily verse" : "",
    d.classNoteRequests ? `${d.classNoteRequests} class-note ${d.classNoteRequests === 1 ? "request" : "requests"}` : "",
    "your Ask allowance",
  ].filter(Boolean);
  return `Done. Deleted: ${parts.join(", ")}.${d.askPlanUntil ? " Your monthly plan's renewal is managed by Telegram: cancel it in Telegram's Stars settings so you are not charged again." : ""} Payment records keep only Telegram's charge reference, not who paid.`;
}
