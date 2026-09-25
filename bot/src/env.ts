export type Env = {
  DB: D1Database;
  SUBS: KVNamespace;
  ASSETS: Fetcher;
  DATA_ORIGIN: string;
  SITE_URL: string;
  /** The Mini App's direct link from @BotFather (https://t.me/<bot>/<app>); empty until /newapp. */
  APP_URL: string;
  /** This Worker's public URL (https://cyberjudah-telegram.<account>.workers.dev), for web_app buttons sent by the cron. */
  WORKER_URL: string;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
};

/** A daily-verse subscription, KV key sub:<userId>. hour is local, tz the offset in minutes. */
/** Only waitUntil is needed; Hono and workers-types disagree on the full ExecutionContext shape. */
export type Exec = { waitUntil(p: Promise<unknown>): void };

export type Sub = { chatId: number; hour: number; tz: number };
