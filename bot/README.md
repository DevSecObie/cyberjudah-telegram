# cyberjudah-bot

One Cloudflare Worker: it serves the Mini App (`app/dist`), answers the bot's webhook, and
provides the app's API (search over D1, prepared share messages, the daily verse, Stars).
The routes are the contract in `shared/contract.md`.

```
src/index.ts        Hono: /api/*, /webhook, /card/*, then the static app
src/bot.ts          grammY: /start /help /verse /daily /support /privacy /terms /paysupport, inline mode, payments
src/daily.ts        the hourly cron: today's verse to subscribers at their local hour
src/search.ts       FTS5 search over search_docs in D1 (a port of the site's search)
src/initdata.mjs    Mini App initData validation (HMAC-SHA256; 30 days, a day for privacy and invoices)
src/refs.mjs        "john 3:16", "1 kings 8:22-27", "ps 23" -> a reference
src/verse-of-day.mjs  the curated list, chosen by the UTC date
src/card.ts         the 1200x630 SVG verse card
scripts/setup.mjs   setWebhook, setMyCommands, setChatMenuButton
scripts/load-search.mjs  search.sql.gz -> D1
scripts/d1-id.sh    finds or creates the D1 database, prints its id
```

## Secrets and vars

| Name | Where | Meaning |
|---|---|---|
| `BOT_TOKEN` | secret | from @BotFather |
| `WEBHOOK_SECRET` | secret | any random string; sent by Telegram as `X-Telegram-Bot-Api-Secret-Token` |
| `DATA_ORIGIN` | var | the data set, `https://data.cyberjudah.io` |
| `SITE_URL` | var | the website, for source links |
| `APP_URL` | var | the Mini App's direct link, `https://t.me/CyberJudah_bot/cybr` (in wrangler.jsonc) |
| `WORKER_URL` | var | this Worker's public URL, so the cron can send `web_app` buttons (the webhook derives it from the request) |
| `DONATIONS_ON` | var | "off" turns off donations ("Support CyberJudah") without a deploy; on when unset |
| `DONATE_MIN_STARS` | var | the fewest Stars a giver may name besides the presets (`1` when unset) |
| `DONATE_MAX_STARS` | var, optional | the most Stars a giver may name; unset means no app-imposed ceiling beyond Telegram's own |
| `DONATION_URL` | var, optional | the owner's own HTTPS giving link, shown alongside the Stars presets; not set anywhere yet — `GET /api/donations` reports `donationUrl: null` until it is added |

```
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
```

Locally, put both in `bot/.dev.vars` (ignored by git).

## Setting up the bot

1. @BotFather: `/newbot` → the token. `/setinline` on the bot, with a placeholder like
   `john 3:16 or a word`, so `@bot …` works in any chat. `/setinlinefeedback` is optional
   (the bot ignores `chosen_inline_result`).
2. Deploy once (below) and note the Worker URL.
3. @BotFather: `/newapp` → choose the bot, give the Worker URL as the Web App URL and a short
   name; the direct link `https://t.me/<bot>/<name>` goes into `APP_URL` in `wrangler.jsonc`.
4. `BOT_TOKEN=… WEBHOOK_SECRET=… WORKER_URL=https://… npm run setup --workspace bot`
   sets the webhook (secret token, allowed updates), the command list and the menu button.

## Deploy

```
npm run build                      # the app, into app/dist
bash bot/scripts/d1-id.sh          # prints the D1 id; the workflow writes it into wrangler.jsonc
npm run load-search --workspace bot   # search.sql.gz -> D1 (add --local for wrangler dev)
npm run deploy --workspace bot
```

The KV namespace for subscriptions is created with `wrangler kv namespace create SUBS`; put
its id in `wrangler.jsonc`. The cron (`0 * * * *`) is declared there too.

## Develop

```
npm run dev --workspace bot        # wrangler dev on :8787, serving ../app/dist
npm test --workspace bot           # node:test: initData, the reference parser, the verse of the day
npm run typecheck --workspace bot
```

`node scripts/load-search.mjs /path/to/search.sql.gz --local` fills the local D1 for search.

## Bible Strong resource feed

Public `/bs/v1/*` routes serve CyberJudah content in the Bible Strong resource
contracts. See [BS-FEED.md](BS-FEED.md) for all routes, sources, compatibility gaps,
contract tests, and the KJV/Strong index refresh procedure.
