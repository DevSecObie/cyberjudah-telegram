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
  /** The Claude model Ask CyberJudah answers every reader with by default (claude-sonnet-5 when unset). */
  CLAUDE_MODEL?: string;
  /** The default model for an admin account. */
  CLAUDE_MODEL_ADMIN?: string;
  /** Ask's pay-as-you-go balance (shared/credits.mjs creditConfig documents each). */
  ASK_USD_PER_STAR?: string; ASK_MARGIN?: string; ASK_TOPUPS_USD?: string; ASK_UNIFIED_BILLING_FEE?: string; ASK_CONFIRM_ABOVE_USD?: string; ASK_MAX_REQUEST_USD?: string;
  ASK_EMBED_USD_PER_MTOK?: string; ASK_RERANK_USD_PER_MTOK?: string; ASK_VECTOR_USD_PER_MDIMS?: string;
  ASK_BILLING?: string; ASK_FREE_MODEL?: string; ASK_FREE_MODELS?: string;
  /** The free tier's per-answer guardrails: research rounds (3), hard per-answer ceiling in dollars (0.05), and the owner's global daily cap in dollars (0.11 = the 10k free neurons/day) past which free answers pause. */
  ASK_FREE_MAX_ROUNDS?: string; ASK_FREE_MAX_USD?: string; ASK_FREE_DAILY_USD_CAP?: string;
  /** Sybil backstop: Ask requests per IP per day (1000); per-request telemetry retention in days (180); daily D1 write-contention events before the health check pages (50). */
  ASK_IP_DAILY_LIMIT?: string; CREDIT_USAGE_RETENTION_DAYS?: string; CREDITS_CONTENTION_ALERT?: string;
  /** Search AI answers per reader per day (20), counted under the pseudonymous ID. */
  SEARCH_AI_DAILY_LIMIT?: string;
  /** End-to-end tests only: "on" lets a request name its moment (x-e2e-now), to test the Sabbath pause on any day. Never set in wrangler.jsonc. */
  E2E_CLOCK?: string;
  /** Telegram user ids (comma-separated) allowed to edit notes from the app. They also receive the hourly health-check pages. */
  ADMIN_IDS?: string;
  /** Donations ("Support CyberJudah", billing.ts donationsConfig): "off" turns off the feature without a deploy (on when unset). The owner's own HTTPS donation link; empty until the owner sets it. */
  DONATIONS_ON?: string; DONATION_URL?: string;
  /** The Stars a giver may name for a donation, besides the presets: at least 1 (default 1); optionally capped (unset means no app-imposed ceiling beyond Telegram's own). */
  DONATE_MIN_STARS?: string; DONATE_MAX_STARS?: string;
  /** Fine-grained token scoped only to the app repository. */
  APP_REPO_TOKEN?: string;
  /** Loopback GitHub stand-in, used only with E2E_CLOCK=on. */
  CMS_GITHUB_API_ROOT?: string;
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
  /** Worker secret, set once and never changed: the key behind pseudonymous record IDs and sealed conversations (privacy.ts). */
  PRIVACY_KEY?: string;
  /** Who pays for Claude: "cloudflare" (Unified Billing, from the account's AI Gateway credits; needs AI_GATEWAY and CF_AIG_TOKEN, sends no Anthropic key) or anything else for the ANTHROPIC_API_KEY secret. Not a secret. */
  CLAUDE_BILLING?: string;
  PUSH_TEST_ORIGIN?: string;
  /** Workers Rate Limiting binding for the reading-reminder endpoints (wrangler.jsonc "ratelimits"). */
  REMIND_LIMIT?: RateLimit;
};

/** A daily-verse subscription, KV key sub:<userId>. hour is local, tz the offset in minutes. */
/** Only waitUntil is needed; Hono and workers-types disagree on the full ExecutionContext shape. */
export type Exec = { waitUntil(p: Promise<unknown>): void };

export type Sub = { chatId: number; hour: number; tz: number };
