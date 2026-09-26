import { appLink, pathToStartParam } from "@shared/links.mjs";
import { SITE_URL } from "@/api/data";
import { api, features, shareMessage, shareToStory, shareUrl, switchInline } from "@/tg/sdk";

/** The Mini App's direct link from @BotFather; VITE_APP_URL overrides it for a fork. */
export const APP_URL: string = (import.meta.env.VITE_APP_URL as string | undefined) || "https://t.me/CyberJudah_bot/cybr";

/**
 * Sharing, best first: a prepared inline message through the bot (a rich card with an
 * Open button, 8.0), else Telegram's share sheet with a deep link that opens this app.
 */
export async function share(p: { kind: "verse" | "note" | "app"; title: string; text: string; sitePath: string; verses?: string }): Promise<boolean> {
  const startapp = pathToStartParam(p.sitePath, p.verses);
  const url = appLink(APP_URL, SITE_URL, p.sitePath, p.verses);
  if (features.shareMessage) {
    try {
      const { id } = await api<{ id: string }>("/api/share", { method: "POST", json: { kind: p.kind, title: p.title, text: p.text, url, startapp } });
      return await shareMessage(id);
    } catch { /* fall through to the share sheet */ }
  }
  shareUrl(url, p.title === p.text ? p.title : `${p.title}\n${p.text}`);
  return true;
}

/** A verse card to a story (7.8), with a link back into the app for premium users. */
export function storyVerse(slug: string, chapter: number, verse: number, ref: string) {
  // Stories take a JPG or PNG; the site's social card is the picture, the caption carries the verse.
  const media = `${SITE_URL}/og.jpg`;
  shareToStory(media, `${ref} · CyberJudah`, { url: appLink(APP_URL, SITE_URL, `/bible/${slug}/${chapter}`, String(verse)), name: "Read in CyberJudah" });
}

/** Paste a verse lookup into a chat through the bot's inline mode. */
export const inlineVerse = (ref: string) => switchInline(ref);
