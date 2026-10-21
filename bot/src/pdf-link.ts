import { sameHex } from "./initdata.mjs";

/**
 * A note's PDF link: the note's path and an expiry, signed with the bot token, so the app can hand
 * Telegram's downloader a link that works for a short while without the reader's launch data.
 */
export async function pdfSig(botToken: string, path: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`pdf:${botToken}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${path}|${exp}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/** Whether a link's signature holds and it has not expired, compared in constant time. */
export async function pdfLinkOk(botToken: string, path: string, exp: number, sig: string, now = Date.now()): Promise<boolean> {
  if (!(exp > now / 1000)) return false;
  return sameHex(sig, await pdfSig(botToken, path, exp));
}
