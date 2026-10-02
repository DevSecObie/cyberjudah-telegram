export type Env = {
  DB: D1Database;
  /** The site's own D1 database (cyberjudah): teaching_passages and teaching_refs, filled by the cyberjudah repository. */
  TEACH: D1Database;
  SUBS: KVNamespace;
  /** The YouTube channel whose live stream is the class on the air (a UC… id). */
  LIVE_CHANNEL?: string;
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
  ANTHROPIC_BASE_URL?: string;
  /** The Claude model Ask CyberJudah answers with (claude-opus-5 when unset). */
  CLAUDE_MODEL?: string;
  /** Ask's pricing (wrangler.jsonc vars): see billing.mjs. */
  ASK_USD_PER_MTOK?: string; ASK_USD_PER_STAR?: string; ASK_MARGIN?: string; ASK_FREE_DAILY?: string; ASK_PLAN_STARS?: string; ASK_PACKS?: string; ASK_BILLING?: string;
  /** Telegram user ids (comma-separated) allowed to edit notes from the app. They also receive the hourly health-check pages. */
  ADMIN_IDS?: string;
  /** D1 storage alert threshold in bytes (default 8 GB); the hourly self-check pages when the search database passes it. */
  D1_SIZE_ALERT_BYTES?: string;
  /** Set as a Worker secret from the CYBERJUDAH_TOKEN repository secret: a fine-grained GitHub token with contents write on the cyberjudah repository, for edits made in the app. */
  CYBERJUDAH_TOKEN?: string;
  /** Web Push for reading reminders (Worker secrets, base64url): the P-256 public key the browser subscribes with, its private key, and the contact (mailto: or https:) push services are given. Without them push is offered as unavailable. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  /** End-to-end tests only: a loopback Bot API and push service (http://127.0.0.1:…). Ignored unless loopback. */
  TELEGRAM_API_ROOT?: string;
  /** The name of a Cloudflare AI Gateway to send Claude and Workers AI calls through (logs, analytics, rate limits). Not a secret; unset means direct. */
  AI_GATEWAY?: string;
  /** Worker secret, added by the owner only: an AI Gateway token (Run permission), so Claude's calls can go through an authenticated gateway. Without it Claude is called directly. */
  CF_AIG_TOKEN?: string;
  PUSH_TEST_ORIGIN?: string;
  /** Workers Rate Limiting binding for the reading-reminder endpoints (wrangler.jsonc "ratelimits"). */
  REMIND_LIMIT?: RateLimit;
};

/** A daily-verse subscription, KV key sub:<userId>. hour is local, tz the offset in minutes. */
/** Only waitUntil is needed; Hono and workers-types disagree on the full ExecutionContext shape. */
export type Exec = { waitUntil(p: Promise<unknown>): void };

export type Sub = { chatId: number; hour: number; tz: number };
