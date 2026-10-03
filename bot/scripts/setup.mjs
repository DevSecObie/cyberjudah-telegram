#!/usr/bin/env node
/**
 * Points the bot at the deployed Worker: the webhook (with the secret token and only the
 * updates the bot handles), the command list and the menu button that opens the Mini App.
 * Run once after the first deploy, and again if the Worker URL or the secret changes.
 *
 *   BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://cyberjudah-telegram.<account>.workers.dev node scripts/setup.mjs
 */
const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL, WEB_APP_URL } = process.env;
if (!BOT_TOKEN || !WORKER_URL) {
  console.error("BOT_TOKEN and WORKER_URL are required; WEBHOOK_SECRET should match the Worker's secret.");
  process.exit(1);
}
const origin = WORKER_URL.replace(/\/+$/, "");
// The menu button opens the Mini App at a web address (a web_app button needs one): WEB_APP_URL
// (cyberjudah.io/app), or the Worker's own root when unset (local and staging setups serve the SPA
// at /). Not APP_URL: that is the t.me link the bot's link buttons use (wrangler.jsonc).
const appUrl = (WEB_APP_URL || `${origin}/`).replace(/\/+$/, "") || `${origin}/`;
if (/^https:\/\/t\.me\//.test(appUrl)) { console.error("WEB_APP_URL must be the app's web address, not a t.me link."); process.exit(1); }

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
    { command: "privacy", description: "Privacy policy" },
    { command: "mydata", description: "A copy of what is kept about you" },
    { command: "deletemydata", description: "Delete everything kept about you" },
    { command: "paysupport", description: "Help with a Stars payment" },
    { command: "help", description: "What this bot does" },
  ],
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Open", web_app: { url: appUrl } } });
const me = await call("getMe", {});
console.log(`@${me.username} is set up at ${origin}. Inline mode: /setinline in @BotFather if not yet enabled.`);
