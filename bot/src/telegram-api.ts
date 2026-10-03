import { Api } from "grammy";
import type { Env } from "./env";
import { loopbackOrigin } from "./webpush.mjs";

/** The Bot API, or in end-to-end tests the loopback stand-in for it (TELEGRAM_API_ROOT; nothing but http://127.0.0.1 or localhost is honoured). */
/** The same, as a grammY Bot's client options. */
export const telegramClient = (env: Env) => { const root = loopbackOrigin(env.TELEGRAM_API_ROOT); return root ? { apiRoot: root } : undefined; };
export const telegramApi = (env: Env) => {
  const root = loopbackOrigin(env.TELEGRAM_API_ROOT);
  return new Api(env.BOT_TOKEN, root ? { apiRoot: root } : undefined);
};
