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
| Apple 5.1.1(v), account deletion | Deletion in the app, confirmation when done, subscriptions explained | Delete my data and `/deletemydata` list what is deleted (saved chats, reading reminder, daily verse, Ask balance, top-up reminder, class-note requests, cloud study backup, synced marks when account sync is on, browser sign-ins) and confirm with a summary when done. Plans were withdrawn, so there is no subscription to cancel; a legacy plan that renews is cancelled with Telegram then (`billing.ts` `applyPayment`). `/mydata`'s note says highlights, notes and reading history stay on the device unless account sync is on |
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
| Reading reminder | KV `remind:tg:<pid>` / `remind:dev:<id>`, sealed; readable metadata: on, hour, minute, zone, channels, pause date | Time, zone, chat ID or push subscriptions, plan position, the ids of browsers linked to a Telegram record (`devices`, up to 20) | Until deleted (Settings → Reading reminders → Delete my reading reminder) or Delete my data; turning it off (Settings, `/stop`, the Stop button) keeps the record so it can be turned back on; a browser not linked to Telegram 180 days unused | Settings → Reading reminders → Delete my reading reminder, Delete my data (both also remove the `remdev:` credentials of linked browsers) |
| Push lookup | KV `pushep:<sha256(endpoint)>` | The reminder's ID | 180 days | With the reminder |
| Browser reminder credential | KV `remdev:<id>` (`remind.ts`) | SHA-256 of the browser's secret, the reminder's ID, last day used | 180 days from last use (`IDLE_TTL`) | Forget this browser; deleting a Telegram reminder or Delete my data removes the linked browsers' credentials; a linked browser whose Telegram reminder is gone is refused and its credential removed |
| Browser link code | KV `remlink:<code>` | The browser's credential id | 15 minutes (`LINK_TTL`) | Used once by `/start remind_<code>` |
| Daily verse | KV `sub:<pid>`, sealed | Hour, offset, chat ID | Until `/daily` again | `/daily`, Delete my data, Telegram blocking the bot |
| Ask balance | D1 `credit_lots`, `credit_ledger`, `credit_holds`, `credit_meta` (`user_id` = pid); the old `accounts` row it was carried over from | Balance, each top-up, refund and adjustment, and what each paid answer was charged | Until Delete my data | Delete my data |
| Per-answer usage | D1 `credit_usage` (`user_id` = pid) | Each paid answer's model, steps, cost and charge (never the question) | 180 days (`CREDIT_USAGE_RETENTION_DAYS`, `pruneBilling` hourly) | Delete my data, or the prune |
| Top-up reminder | D1 `topup_reminders` (`user_id` = pid) | Time zone, the chat to write to (sealed), the last eve handled | Until turned off | Delete my data |
| Stars payments | D1 `payments` | Telegram charge ID, kind, Stars, date; pid | Kept for refunds and accounts | Delete my data unlinks it (`user_id = 'deleted'`) |
| Stars donations | D1 `donations` | Telegram charge ID, Stars, date; pid | Kept for refunds and accounts; included in Download my data | Delete my data unlinks it (`user_id = 'deleted'`) |
| Telegram delivery claims | D1 `webhook_updates` | Update sequence id, random processing claim, state and time; no reader id or message | Seven days, swept hourly | Expires on its own |
| Free-answer reservations | D1 `free_spend_holds` | Server-generated random id, UTC day, amount, state; no reader id or question | Seven days, swept hourly | Expires on its own |
| Aggregate free-answer spend | D1 `free_spend_daily` | UTC day and total estimated cost; no reader id or question | Aggregate operational history | Not linked to a reader |
| Who asked on a day (legacy) | D1 `usage_people` (pid) | pid, day; nothing writes it any more, old rows only | Pruned after 30 days (`billing.ts`) | Delete my data |
| Daily limits | D1 `rate_counts` (`name:pid:day`: `ask`, `search_ai`, `ttsg`, `share`, `report`) | A count | Swept daily | Delete my data |
| Ask limit per network | D1 `rate_counts` (`ask_ip:<IP address>:day`) | The IP address the question came from, and a count, never linked to a pid | Swept daily (kept up to two days) | Expires on its own |
| New reminder browsers per network | KV `remcreate:<HMAC of IP address>:day` (`remind.ts`; `privacy.mjs` `keyedHash`, keyed from `PRIVACY_KEY`) | A count of new browser credentials from that address | Two days (`expirationTtl`) | Expires on its own |
| Class-note requests | KV `notereq:<video>` | Count, pids (once each) | Until the notes are written | Delete my data (the reader's pid and vote) |
| Cloud study backup | D1 `study_backups` (`owner` = pid; `study-backup.ts`) | The personal-study archive, sealed; revision, last update | Until replaced or deleted | The reader, Delete my data |
| Browser sign-in | D1 `browser_sessions` (`owner` = pid, `token_hash` = keyed hash of the cookie; `browser-auth.ts`) | Name, @username and Telegram ID, sealed; expiry | 1 day (`expires`; expired rows removed at the next sign-in) | Sign out, Delete my data |
| Deleted-chat marker | KV `chatgone:<pid>:<id>` (`chats.ts`) | `1`, so an answer still being written is not saved into a deleted chat | 1 day (`expirationTtl`) | Expires on its own |
| Deletion confirmation | KV `privacydel:<token>` (`mydata.ts`) | The Telegram ID, sealed, for `/deletemydata`'s button | 10 minutes (`expirationTtl`) | Used once, or expires |
| Telegram update seen | KV `webhook:<update_id>` (`bot.ts`) | `1`, so a redelivered update is handled once; no reader id or message | 1 day (`expirationTtl`) | Expires on its own |

The rows below exist only for a reader signed in to account sync (`VITE_ACCOUNT_SYNC`; off in
production until [docs/PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md) §2 is done). Each is
filed by the Telegram ID directly (`tg_<id>`, `bot/src/firebase-auth.ts`), not the keyed `pid`
above, because Firestore's own rules (`app/firebase/firestore.rules`), not `privacy.mjs`, keep
one reader's documents from another's.

| Record | Where | Holds | Kept | Deleted by |
|---|---|---|---|---|
| Highlights | Firestore `users/tg_<id>/highlights` | A highlighted verse's colour, by key and verse, with its revision history as sibling documents | Until replaced or Delete my data | Delete my data |
| Notes | Firestore `users/tg_<id>/notes`, revision history in `users/tg_<id>/notes/<id>/revisions` | A verse note's text, with its earlier versions | Until replaced or Delete my data | Delete my data |
| Links | Firestore `users/tg_<id>/links` | Links a reader drew from a verse to another passage | Until replaced or Delete my data | Delete my data |
| Bookmarks | Firestore `users/tg_<id>/bookmarks` | The reader's saved bookmarks | Until replaced or Delete my data | Delete my data |
| Tags | Firestore `users/tg_<id>/tags` | The reader's tag labels | Until replaced or Delete my data | Delete my data |
| Relations | Firestore `users/tg_<id>/relations` | Typed links a reader drew between scripture, notes and library entries | Until replaced or Delete my data | Delete my data |
| Personal studies | Firestore `users/tg_<id>/studies`, revision history in `users/tg_<id>/studies/<id>/revisions` | A study's title, writing and blocks, with its earlier versions | Until replaced or Delete my data | Delete my data |
| Word annotations | Firestore `users/tg_<id>/wordAnnotations` | Per-word marks made while reading | Until replaced or Delete my data | Delete my data |

Signed out of account sync, or before it is turned on, highlights, notes, bookmarks, tags,
history, the plan and settings stay only on the device and in Telegram's CloudStorage for the
Mini App, and nothing else about people is stored on the server. So is the Sabbath screen's
location (`loc`, rounded to three decimal places, `Sabbath.tsx`), used on the device to work out
sunset and removed with Forget; like every CloudStorage key it is part of a backup sent through
`/api/backup` to the reader's chat, which the Worker does not keep.

The reminder endpoints also pass the caller's IP address to Cloudflare's rate limiter
(`REMIND_LIMIT`, per minute), which the app does not store.

Records from before this change (under Telegram IDs, unsealed) are moved by `privacy-migrate.ts`,
a bounded amount each hour, until none are left. Chats also move the first time they are read.

## The iPhone and Android app

The phone app is the Bible Strong port in `DevSecObie/cyberjudah-app` (`apps/expo`, resource
profile `cyberjudah`). Reading and study work without an account; signed out, everything stays on
the device. The Privacy screen's section "The CyberJudah App for iPhone and Android" is the
readers' side of this table.

| Record | Where | Holds | Kept | Deleted by |
|---|---|---|---|---|
| Sign-in | Firebase Authentication, project `cyberjudah-app` | Email address, the name Google or Apple shares, provider, Firebase UID | Until the account is deleted | Delete account in the app (`DeleteAccountModal.tsx`), or a request by email |
| Synced study data | Firestore `users/<uid>` and its subcollections (highlights, notes, links, bookmarks, tags, relations, studies, word annotations and the rest listed in `firebase/cyberjudah/firestore.rules`), `studies` (field `user.id`), `users-status/<uid>`; staging builds use the `staging_` copies of these collections | What the reader wrote and marked, with note and study revisions | Until replaced, deleted, or the account is deleted | Delete account in the app, or a request by email |

Firestore rules give each document to its owner only. App Check (App Attest on iPhone, Play
Integrity on Android) is asked for before protected downloads; it carries no reader identity.
Dictionary and Nave entries come through `bot/src/bs/upstream-reference.ts`, which sends
`api.bible-strong.app` only the path and query of the lookup, with no reader identity, cookies
or credentials, and refuses redirects. Analytics, crash reporting and the study assistant are off
in this build (empty `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`, `EXPO_PUBLIC_SENTRY_DSN` and
`EXPO_PUBLIC_AI_API_URL`).

**Known gap, 28 October 2026:** the app's Delete account removes only the Firebase sign-in
(`deleteCurrentAuthUser`). The function that removes a user's Firestore data
(`apps/api/functions/src/users.ts`) deploys to the upstream project, not `cyberjudah-app`. Until
the deletion fix lands, a request to privacy@cyberjudah.io is completed by hand: delete
`users/<uid>` with its subcollections, every `studies` document whose `user.id` is the UID, and
`users-status/<uid>`, then remove the account in Firebase Authentication. A linked Telegram
account's records go with `deleteData` (`bot/src/mydata.ts`). The page for requests without the
app is `/delete-account` (`app/src/screens/DeleteAccount.tsx`), the link given in Google Play's
Data safety form.

## Who else handles it

- **Telegram:** platform, sign-in, messages, Stars.
- **Cloudflare:** hosting (Workers, KV, D1, R2), Workers AI, AI Gateway. Invocation logs are off;
  service log messages are kept up to seven days. AI calls are logged without content, or not at all.
- **The AI provider of the model the reader chooses** (Anthropic, OpenAI, Google, xAI, DeepSeek,
  Alibaba, Moonshot AI, MiniMax, Thinking Machines, Unbiased, or Cloudflare for the hosted models):
  the question, the earlier questions in the chat, library passages. Never the name or Telegram ID.
  An external provider is used only after the reader agrees to it (`lib/ai-consent.ts`; the server
  answers 428 otherwise, including before Search cache lookups). Search's model, when hosted on
  Cloudflare (`@cf/`), needs no agreement, because Cloudflare is the host; an external Search model
  without the reader's agreement is refused with 428 (`search-answer.ts`, `ai.ts` `answerSearch`). Search sends only the current query and
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
- **Wikipedia and approved reference sites:** Ask's outside-source tool (`ask-tools.ts`) may send
  search words drawn from the reader's question to Wikipedia's search API, or fetch a page on an
  approved host (`source-policy.ts`: `data/ask-sources.json`, or the reviewed list in KV
  `ask:sources`). The request comes from CyberJudah's server with no reader identity.
- **Typefaces:** self-hosted with the app (`app/src/fonts`); loading them does not contact Google Fonts.
- **YouTube:** class thumbnails (`img.youtube.com`) when classes are listed, and the player
  (`youtube-nocookie.com`) when a class is played.
- **The admins** (the Telegram IDs in `ADMIN_IDS`), through `tellAdmins`: `/paysupport`
  forwards the sender's first name, @username, Telegram ID and message (`bot.ts`); a reported
  answer (`POST /api/report`, `report.mjs`) carries only Ask's chat id and the answer's place in
  it, or the search answer's model, and the reason, never the question, the answer or who reported
  it. Ten reports a day per reader.
- **Browser push services** (Apple, Google, Mozilla), only for push reminders.
- **Google Firebase:** once a reader is signed in to account sync, the eight record types above
  (highlights, notes, links, bookmarks, tags, relations, personal studies, word annotations),
  under the reader's Telegram ID, so the same marks follow them to another device. Delete my
  data removes them (`bot/src/firestore-admin.ts`). For the phone app, the sign-in and the synced
  study data in the table above.
- **Apple and Google:** Sign in with Apple, Google sign-in, and the App Check device check of the
  phone app.
- **The Bible Strong reference service** (`api.bible-strong.app`): the path and query of a
  dictionary or Nave lookup, from CyberJudah's server, with no reader identity.

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
