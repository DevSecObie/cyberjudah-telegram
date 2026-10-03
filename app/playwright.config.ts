import { defineConfig } from "@playwright/test";
import crypto from "node:crypto";
import { STAND_IN } from "./e2e/stand-ins";

const liveBaseURL = process.env.PLAYWRIGHT_BASE_URL;

/**
 * The local Worker's own credentials for these tests, never a real bot's: a bot token the
 * specs sign Telegram launch data with (so the Worker's real initData check runs), and a
 * VAPID key pair made for this run (so push is offered and signed as it is in production).
 */
const vapid = () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const b64u = (b: Buffer) => b.toString("base64url");
  return { pub: b64u(ecdh.getPublicKey()), priv: b64u(ecdh.getPrivateKey()) };
};
if (!liveBaseURL) {
  process.env.BOT_TOKEN = "100000001:E2E-local-worker-only";
  if (!process.env.E2E_VAPID_PUBLIC) { const k = vapid(); process.env.E2E_VAPID_PUBLIC = k.pub; process.env.E2E_VAPID_PRIVATE = k.priv; }
}
const vars = [
  `BOT_TOKEN:${process.env.BOT_TOKEN}`,
  `VAPID_PUBLIC_KEY:${process.env.E2E_VAPID_PUBLIC}`,
  `VAPID_PRIVATE_KEY:${process.env.E2E_VAPID_PRIVATE}`,
  "VAPID_SUBJECT:mailto:e2e@cyberjudah.invalid",
  `TELEGRAM_API_ROOT:${STAND_IN}`,
  `PUSH_TEST_ORIGIN:${STAND_IN}`,
  "ADMIN_IDS:100000002",
  // Ask runs its real agent loop against a scripted stand-in of the Claude Messages API (e2e/claude.ts).
  "ANTHROPIC_API_KEY:e2e-not-a-real-key",
  `ANTHROPIC_BASE_URL:${STAND_IN}/anthropic`,
  // Ask's balance is on, as it is meant to run (readers are given a balance by the admins in the
  // specs); the specs may name the moment a request is made (x-e2e-now) to test the Sabbath pause.
  "ASK_BILLING:on",
  "E2E_CLOCK:on",
  // The bot's webhook, for payments and refunds as Telegram delivers them (credits.spec.ts).
  "WEBHOOK_SECRET:e2e-webhook-secret",
  // Records are filed under pseudonymous IDs (bot/src/privacy.mjs); the tests derive the same ones.
  "PRIVACY_KEY:e2e-privacy-key-not-secret",
].map((v) => `--var '${v}'`).join(" ");

/**
 * Pull requests use the local Worker; the scheduled live smoke suite uses production. The
 * local Worker starts from empty storage each run (--persist-to a fresh folder), and its cron
 * can be run on demand (--test-scheduled: GET /__scheduled).
 *
 * The browser is full Chromium in its new headless mode (channel "chromium"), not the
 * headless shell: the shell has no notifications at all (Notification.permission is always
 * "denied"), so the permission states the reminder tests need would not be real there.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  globalSetup: liveBaseURL ? undefined : "./e2e/stand-ins.ts",
  use: { baseURL: liveBaseURL || "http://127.0.0.1:8787", trace: "retain-on-failure", screenshot: "only-on-failure", viewport: { width: 390, height: 780 } },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: "chromium", ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}) } },
    // The glass material and pointer behavior must also work in the engine used by Safari/iOS.
    { name: "webkit", testMatch: ["glass.spec.ts", "contrast.spec.ts", "search-placement.spec.ts", "icons.spec.ts", "material-budget.spec.ts"], use: { browserName: "webkit" } },
    { name: "firefox", testMatch: ["glass.spec.ts", "material-budget.spec.ts", "search-placement.spec.ts", "icons.spec.ts"], use: { browserName: "firefox" } },
  ],
  webServer: liveBaseURL ? undefined : {
    command: `npm run build && bash ../bot/scripts/prepare-assets.sh && cd ../bot && rm -rf .wrangler/e2e && npx wrangler dev --local --port 8787 --persist-to .wrangler/e2e --test-scheduled ${vars}`,
    url: "http://127.0.0.1:8787/api/verse-of-day",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
