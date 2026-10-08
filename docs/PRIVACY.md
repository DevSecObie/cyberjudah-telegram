# Privacy

Deletion succeeds only after every store has confirmed cleanup. If a store fails, the app and bot report incomplete deletion and invite a retry; some earlier steps may already have finished. Repeating deletion completes the remaining work. Data exports also fail rather than silently omit unavailable billing or top-up reminder records.

What CyberJudah keeps about people, why, for how long, who else handles it, and where the code
enforces each of these. The policy readers see is the Privacy screen (`app/src/screens/Privacy.tsx`,
`/privacy`, `/privacy` in the bot); this document is the operator's side of it. A change to one is
a change to the other.

## The standards this follows

| Source | What it requires | Where it is met |
|---|---|---|
| Telegram Bot Developer Terms, 4 | A privacy policy that is easy to reach, saying what is stored, how and why; set in @BotFather when the standard policy does not fit | The Privacy screen; `/privacy`; **owner action:** set the Privacy Policy in @BotFather (below) |
| Telegram Bot Developer Terms, 4.2 | Delete data on request, and when it is no longer needed | Delete my data; retention below |
| Telegram Bot Developer Terms, 4.3 | Use what people send only with "individual, explicit, active and revocable consent" after being told its use | The AI agreement in Ask and Search, checked by the server (428), withdrawn in Privacy |
| Telegram Bot Developer Terms, 4.4(a) | "user data is always encrypted at rest and stored separately from its encryption key" | `privacy.mjs` seal/open (AES-GCM), key from the `PRIVACY_KEY` Worker secret, data in KV/D1 |
| Telegram Bot Developer Terms, 4.4(e)/(d) | The security checks the platform documents (launch data) | `initdata.mjs` validates every request's launch data |
| Telegram Bot Developer Terms, 6.2.1 | Stars sellers answer `/paysupport` | `/paysupport` reaches the admins |
| Telegram Standard Bot Privacy Policy, 5.1 | Only what features need | The inventory below; nothing else is stored |
| Telegram Standard Bot Privacy Policy, 6.2, 5.3 | No sharing with third parties without explicit authorisation | AI agreement per provider |
| Telegram Standard Bot Privacy Policy, 7.3 | A copy of the data, deletion, revoking consent; answered within 30 days | Download my data, Delete my data, withdraw: in the app at once, and `/mydata`, `/deletemydata` |
| Apple App Review Guidelines 5.1.1(i) | Privacy policy in the app: what, how, uses, third parties, retention, how to delete or revoke | The Privacy screen |
| Apple 5.1.1(ii), 5.1.2(i) | Consent before collection; explicit permission before sharing with third-party AI | The AI agreement |
| Apple 5.1.1(iii) | Data minimisation | The inventory below |
| Apple 5.1.1(v), account deletion | Deletion in the app, confirmation when done, subscriptions explained | Delete my data (confirmation shown; the plan's renewal is cancelled in Telegram, as the summary says) |
| Cloudflare AI Gateway logging | Logs keep prompts and responses unless told not to | Claude: `cf-aig-collect-log-payload: false`; binding calls with a reader's words: `collectLog: false` (`providers.ts`, `agent-open.ts`) |
| Cloudflare Workers Logs | Requests and `console.log` kept 3–7 days | Invocation logs are off (`wrangler.jsonc` `observability.logs.invocation_logs: false`), so request URLs, which carry search words (`/api/search?q=`, `/api/search/answer?q=`, `/api/similar?q=`), are not logged; `console` logs carry event names and counts, never a person's ID or words |
| MDN Push API | A subscription endpoint is a capability URL | Endpoints are kept only inside the sealed reminder record; the lookup index holds their SHA-256 |

## What is kept, for how long

Every record is filed under `pid`: a keyed hash (HKDF-SHA-256) of the Telegram ID, never the ID. A
record holding anything personal is sealed for its owner (AES-GCM, a key derived for that record).

| Record | Where | Holds | Kept | Deleted by |
|---|---|---|---|---|
| Saved Ask chats | KV `chats:<pid>`, `chat:<pid>:<id>`, sealed | Questions, answers, source links | 180 days from last use (`CHAT_TTL`) | The reader (one chat, or all), Delete my data |
| Answer in progress | KV `chatpending:<pid>:<id>`, sealed | The question | 10 minutes | Itself |
| Reading reminder | KV `remind:tg:<pid>` / `remind:dev:<id>`, sealed; readable metadata: on, hour, minute, zone, channels, pause date | Time, zone, chat ID or push subscriptions, plan position | Until turned off; a browser not linked to Telegram 180 days unused | Settings → Reading reminders, `/stop`, Delete my data |
| Push lookup | KV `pushep:<sha256(endpoint)>` | The reminder's ID | 180 days | With the reminder |
| Daily verse | KV `sub:<pid>`, sealed | Hour, offset, chat ID | Until `/daily` again | `/daily`, Delete my data, Telegram blocking the bot |
| Ask balance | D1 `credit_lots`, `credit_ledger`, `credit_holds`, `credit_meta` (`user_id` = pid); the old `accounts` row it was carried over from | Balance, each top-up, refund and adjustment, and what each paid answer was charged | Until Delete my data | Delete my data |
| Per-answer usage | D1 `credit_usage` (`user_id` = pid) | Each paid answer's model, steps, cost and charge (never the question) | 180 days (`CREDIT_USAGE_RETENTION_DAYS`, `pruneBilling` hourly) | Delete my data, or the prune |
| Top-up reminder | D1 `topup_reminders` (`user_id` = pid) | Time zone, the chat to write to (sealed), the last eve handled | Until turned off | Delete my data |
| Stars payments | D1 `payments` | Telegram charge ID, kind, Stars, date; pid | Kept for refunds and accounts | Delete my data unlinks it (`user_id = 'deleted'`) |
| Stars donations | D1 `donations` | Telegram charge ID, Stars, date; pid | Kept for refunds and accounts; included in Download my data | Delete my data unlinks it (`user_id = 'deleted'`) |
| Telegram delivery claims | D1 `webhook_updates` | Update sequence id, random processing claim, state and time; no reader id or message | Seven days, swept hourly | Expires on its own |
| Free-answer reservations | D1 `free_spend_holds` | Server-generated random id, UTC day, amount, state; no reader id or question | Seven days, swept hourly | Expires on its own |
| Aggregate free-answer spend | D1 `free_spend_daily` | UTC day and total estimated cost; no reader id or question | Aggregate operational history | Not linked to a reader |
| Who asked on a day | D1 `usage_people` (pid) | pid, day | 30 days | Delete my data |
| Daily limits | D1 `rate_counts` (`name:pid:day`: `ask`, `search_ai`, `ttsg`, `share`, `report`) | A count | Swept daily | Delete my data |
| Ask limit per network | D1 `rate_counts` (`ask_ip:<IP address>:day`) | The IP address the question came from, and a count, never linked to a pid | Swept daily (kept up to two days) | Expires on its own |
| New reminder browsers per network | KV `remcreate:<HMAC of IP address>:day` (`remind.ts`; `privacy.mjs` `keyedHash`, keyed from `PRIVACY_KEY`) | A count of new browser credentials from that address | Two days (`expirationTtl`) | Expires on its own |
| Class-note requests | KV `notereq:<video>` | Count, pids (once each) | Until the notes are written | Delete my data (the reader's pid and vote) |

Nothing else about people is stored on the server. Highlights, notes, bookmarks, tags, history,
the plan and settings are kept on the device and in Telegram's CloudStorage for the Mini App. So
is the Sabbath screen's location (`loc`, rounded to three decimal places, `Sabbath.tsx`), used on
the device to work out sunset and removed with Forget; like every CloudStorage key it is part of a
backup sent through `/api/backup` to the reader's chat, which the Worker does not keep.

The reminder endpoints also pass the caller's IP address to Cloudflare's rate limiter
(`REMIND_LIMIT`, per minute), which the app does not store.

Records from before this change (under Telegram IDs, unsealed) are moved by `privacy-migrate.ts`,
a bounded amount each hour, until none are left. Chats also move the first time they are read.

## Who else handles it

- **Telegram:** platform, sign-in, messages, Stars.
- **Cloudflare:** hosting (Workers, KV, D1, R2), Workers AI, AI Gateway. Workers Logs keep requests
  3–7 days; AI calls are logged without content, or not at all.
- **The AI provider of the model the reader chooses** (Anthropic, OpenAI, Google, xAI, DeepSeek,
  Alibaba, Moonshot AI, MiniMax, Thinking Machines, Unbiased, or Cloudflare for the hosted models):
  the question, the earlier questions in the chat, library passages. Never the name or Telegram ID.
  Only after the reader agrees to that provider (`lib/ai-consent.ts`; the server answers 428
  otherwise, including before Search cache lookups). Search sends only the current query and
  matching library passages; answers are cached for two minutes, keyed by question and model,
  with no reader identity. Search is not saved as an Ask conversation. Ask also discloses the
  provider's home country when `shared/ask-models.mjs` `PROVIDER_COUNTRY`
  knows it. When the reader asks about them, the chosen model also receives the reader's own
  records through two tools (`agent.ts`): `my_saved_chats` sends the titles of their other saved
  chats, each with its number of questions, the date of its last question and its link; `my_reminder`
  sends the reading reminder's settings: on or off, time, time zone, channel (Telegram or push), any
  pause date and the reading-plan day, or whether it follows the last chapter read. The AI agreement
  in Ask says so before the first question. When Claude is unavailable, the backup answer
  is written by Workers AI on Cloudflare, the host.
- **Google Fonts:** the app's typefaces (`app/index.html`), so Google receives the reader's IP
  address and browser details when the app loads.
- **YouTube:** class thumbnails (`img.youtube.com`) when classes are listed, and the player
  (`youtube-nocookie.com`) when a class is played.
- **The admins** (the Telegram IDs in `ADMIN_IDS`), through `tellAdmins`: `/paysupport`
  forwards the sender's first name, @username, Telegram ID and message (`bot.ts`); a reported
  answer (`POST /api/report`, `report.mjs`) carries only Ask's chat id and the answer's place in
  it, or the search answer's model, and the reason, never the question, the answer or who reported
  it. Ten reports a day per reader.
- **Browser push services** (Apple, Google, Mozilla), only for push reminders.

## Children

CyberJudah is not directed to children under 13 (16 in the EEA). The Privacy screen says so.

## Owner actions

1. **Add the `PRIVACY_KEY` repository secret before the first deploy of this change.** Generate it
   locally, never in chat: `openssl rand -base64 32`. The deploy refuses to run without it. Never
   change it: records made under one key cannot be found or opened under another.
2. **Set the bot's privacy policy in @BotFather** (Bot Settings → Privacy Policy) to
   `https://cyberjudah.io/app/privacy`, as the Bot Developer Terms require when the standard policy
   does not fit (CyberJudah sends questions to AI providers).
3. **Contact:** privacy questions and requests go to **privacy@cyberjudah.io** (a SimpleLogin alias), shown on the Privacy screen and in `/privacy`. Answer within 30 days (Standard Bot Privacy Policy 7.3(c)).
4. **Breach response** (Bot Developer Terms 4.4(b), (d)): if the `PRIVACY_KEY`, the bot token or the
   Cloudflare account is exposed, rotate what was exposed, tell readers through the bot, and record
   it in `docs/INCIDENTS.md`. Rotating `PRIVACY_KEY` makes stored chats and reminders unreadable:
   tell readers to set reminders again.
5. **Requests by message:** the app and the bot answer data requests at once. Anything sent to the
   admins (for example through `/paysupport`) is answered within 30 days.
