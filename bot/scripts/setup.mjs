#!/usr/bin/env node
/**
 * Points the bot at the deployed Worker: the webhook (with the secret token and only the
 * updates the bot handles), the command list and the menu button that opens the Mini App.
 * Run once after the first deploy, and again if the Worker URL or the secret changes.
 *
 *   BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://cyberjudah-telegram.<account>.workers.dev node scripts/setup.mjs
 */
const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL, APP_URL } = process.env;
if (!BOT_TOKEN || !WORKER_URL) {
  console.error("BOT_TOKEN and WORKER_URL are required; WEBHOOK_SECRET should match the Worker's secret.");
  process.exit(1);
}
const origin = WORKER_URL.replace(/\/+$/, "");
// The menu button opens the Mini App: cyberjudah.io/app in production (APP_URL), or the
// Worker's own root when APP_URL is unset (local/staging setups that serve the SPA at /).
const appUrl = (APP_URL || `${origin}/`).replace(/\/+$/, "") || `${origin}/`;

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  console.log(`${method}: ok`);
  return json.result;
}

await call("setWebhook", {
  url: `${origin}/webhook`,
  secret_token: WEBHOOK_SECRET || undefined,
  allowed_updates: ["message", "inline_query", "chosen_inline_result", "pre_checkout_query", "callback_query", "my_chat_member"],
  drop_pending_updates: false,
});
await call("setMyCommands", {
  commands: [
    { command: "start", description: "Open CyberJudah" },
    { command: "verse", description: "Today's verse" },
    { command: "daily", description: "The daily verse, on or off" },
    { command: "stop", description: "Stop reading reminders" },
    { command: "support", description: "Support the work with Stars" },
    { command: "help", description: "What this bot does" },
  ],
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Open", web_app: { url: appUrl } } });
const me = await call("getMe", {});
console.log(`@${me.username} is set up at ${origin}. Inline mode: /setinline in @BotFather if not yet enabled.`);
