export type Env = {
  DB: D1Database;
  /** The site's own D1 database (cyberjudah): teaching_passages and teaching_refs, filled by the cyberjudah repository. */
  TEACH: D1Database;
  SUBS: KVNamespace;
  ASSETS: Fetcher;
  AI: Ai;
  VEC: Vectorize;
  AUDIO: R2Bucket;
  DATA_ORIGIN: string;
  SITE_URL: string;
  /** The Mini App's direct link from @BotFather (https://t.me/<bot>/<app>); empty until /newapp. */
  APP_URL: string;
  /** This Worker's public URL (https://cyberjudah-telegram.<account>.workers.dev), for web_app buttons sent by the cron. */
  WORKER_URL: string;
  /** The repository the transcripts are read from (owner/name); DevSecObie/cyberjudah when unset. */
  TRANSCRIPTS_REPO?: string;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  /** Set as a Worker secret from the ANTHROPIC_API_KEY repository secret: Ask CyberJudah answers with Claude; without it, with Llama on Workers AI. */
  ANTHROPIC_API_KEY?: string;
  /** The Claude model Ask CyberJudah answers with (claude-opus-5 when unset). */
  CLAUDE_MODEL?: string;
};

/** A daily-verse subscription, KV key sub:<userId>. hour is local, tz the offset in minutes. */
/** Only waitUntil is needed; Hono and workers-types disagree on the full ExecutionContext shape. */
export type Exec = { waitUntil(p: Promise<unknown>): void };

export type Sub = { chatId: number; hour: number; tz: number };
