# The contract between the Mini App and the bot worker

One Cloudflare Worker (`bot/`) serves the app's static build (`app/dist`) and these routes.
Every `/api/*` call from the app sends `Authorization: tma <initData>`; the worker validates
the HMAC with the bot token (see `bot/src/initdata.ts`) and refuses anything older than 24h.

| Route | Auth | Body / query | Response |
|---|---|---|---|
| `POST /webhook` | `X-Telegram-Bot-Api-Secret-Token` | Telegram Update | 200 |
| `GET /api/me` | tma | | `{ user: {id, first_name, username?}, subscribed: boolean, premium: boolean }` |
| `GET /api/search` | tma | `q`, `only?` (verse\|law\|precept\|case\|study\|class\|captains\|history\|encyclopedia), `limit?` | `{ ok, q, mode, counts: {kind: n}, hits: [{kind,title,url,sub,snippet}] }` |
| `POST /api/share` | tma | `{ kind: "verse"\|"note"\|"app", title, text, url, startapp }` | `{ id }` – a prepared inline message id for `WebApp.shareMessage(id)` (allow_user_chats, group_chats, channel_chats) |
| `POST /api/subscribe` | tma | `{ on: boolean, hour?: 0-23, tz?: minutes offset }` | `{ subscribed }` – daily verse, sent by the cron at that local hour; call after `requestWriteAccess` |
| `POST /api/invoice` | tma | `{ stars: 50\|100\|500 }` | `{ link }` – Telegram Stars invoice link for `WebApp.openInvoice` |
| `GET /api/dictionary` | none | `q?`, `letter?`, `page?` | `{ count, page, pages, rows: [{slug, term}], related: [...] }` – Easton's Bible Dictionary |
| `GET /api/dictionary/lookup` | none | `word` | the entry a word in the text means, or 404 |
| `GET /api/dictionary/:slug` | none | | `{ slug, term, definitions: string[] }` |
| `GET /api/verse-of-day` | none | | `{ ref, slug, chapter, verse, text, startapp }` |
| `GET /card/:slug/:chapter/:verse.svg` | none | | an SVG verse card (for previews) |

Data comes from `DATA_ORIGIN` (https://data.cyberjudah.io; contract in the cyberjudah repo,
engine/README.md). The worker's D1 holds `search_docs`, loaded from `search.sql.gz` by
`bot/scripts/load-search.mjs` (the deploy workflow runs it on every deploy).

Deep links: `https://t.me/<bot>/<app>?startapp=<param>`; `shared/links.mjs` is the codec
(`john_3_16` → `/read/john/3?v=16`, `classes_2026_<slug>` → `/note/classes/2026/<slug>`).
The bot's `/start <param>` replies with a button that opens the app at that param.
Inline mode: `@<bot> john 3:16` or `@<bot> passover` answers with verse cards.
