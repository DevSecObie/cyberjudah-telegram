# CyberJudah for Telegram

The [CyberJudah](https://cyberjudah.io) library as a Telegram Mini App: the King James Bible
with the Apocrypha, the Sabbath classes, 15 Minutes w/ The Captains, Our Hidden History, the
handbook of law, the precepts and the case studies, in an app built on Telegram's Mini App
platform end to end, with its own bot.

```
app/      the Mini App: React, Vite, TypeScript          (npm run dev)
bot/      the bot and the API: a Cloudflare Worker      (serves app/dist too)
shared/   the deep-link codec both sides use, and the app/bot contract
```

The library itself comes from the cyberjudah repository's data set at
`data.cyberjudah.io` (contract: `engine/README.md` there). This repository holds only the
app and its bot; the text and the notes live where they are written.

## What the app does

**Read.** Every book by testament, a chapter grid that shows what you have read, a reader with
three text sizes, cross references per verse, and under every chapter the classes, laws and
precepts that cite it. Tap verses to share them, highlight them, bookmark them, post them to a story or send them
through the bot's inline mode.

**Watch and listen.** The Sabbath classes, the Captains, Our Hidden History and the Truth
series, newest first, filtered by topic, book or teacher. A class opens with its recording on
top and the write-up below; an episode carries its transcript, each turn a tap from that
moment in the recording.

**Search.** One box for the whole library: verses, classes, study notes, laws, precepts, cases
and the encyclopedia, grouped by kind. A reference like `John 3:16` opens the chapter. Scan a
QR code from a flyer, or paste a link, and it opens the page.

**The law.** The handbook by part and section, each law with its scripture quoted; the
precepts A to Z with every reference; the case studies by era, judgment or blessing, with the
laws and precepts each one turns on; the topics.

**Sabbath.** Share your location once and the app counts down to sunset, and tells you when
the Sabbath ends.

**Study.** Six highlight colours, a note on any verse, bookmarks with tags, and a dictionary
(Easton's, 3,963 entries: names, places, words) that opens straight from a verse with the
entries for the words in it. Copy a passage with its reference; find every class and note
that cites it.

**Relations.** Bible Strong's study relations, as they are there: connect verses to another
passage, a note, a class or a law, a dictionary entry or a link, with a kind (linked to,
refers to, explains, contrasts with, mentions), a direction and a label. They show under the
verse as tags (or as a count beside the verse number), a tap opens the target, and a
relations screen lists, edits and deletes them. Bible Strong's inline cross references
(the related verse unfolding under the reference) are here too.

**Plan.** The whole library in order at two, four or six chapters a day, with today's
chapters to tick off, a streak, and how far along you are. The app ticks a chapter as you
read it. A history of the last thirty chapters opened.

**Listen.** The chapter read aloud (the device's own voice), verse by verse with the verse
being read lit, at 0.8× to 1.5×, from any verse.

**Offline.** Save a book to the device and read it without a connection.

**Yours, on every device.** Bookmarks, highlights, notes, reading progress, the plan, text
size, theme, recent searches and your location are kept in Telegram's cloud storage, so a
phone and a desktop show the same things. Dark, sepia or light; a book face or the system
face; three line spacings. A verse every morning from the bot, at the hour you choose.
Optionally lock the app behind your fingerprint or face.

## Every Mini App feature, and where it is used

| Feature | Min. version | Where |
|---|---|---|
| `ready`, `expand`, header / background / bottom-bar colours | 6.0 / 6.1 / 7.10 | boot: the app fills the screen in its own colours |
| `BackButton` | 6.1 | walks the app's history; Close on a tab root |
| `MainButton`, `SecondaryButton` | 6.1 / 7.10 | every screen's action: next chapter, Share, Watch, Use my location |
| `SettingsButton` | 6.10 | the ··· menu opens Settings |
| `HapticFeedback` | 6.1 | taps, selections, success and warnings |
| `showPopup`, `showAlert`, `showConfirm` | 6.2 | confirmations (the verse menu is the app's own sheet: Telegram's popups take three buttons) |
| `showScanQrPopup` | 6.4 | Search: scan a link on a flyer |
| `readTextFromClipboard` | 6.4 | Search: paste a link or a reference |
| `switchInlineQuery` | 6.7 | a verse into any chat via `@bot` |
| `CloudStorage` | 6.9 | bookmarks, highlights, progress, preferences, location |
| `requestWriteAccess` | 6.9 | the daily verse subscription |
| `requestContact` | 6.9 | available (not required by any feature) |
| `enableClosingConfirmation` | 6.2 | while reading a long note |
| `BiometricManager` | 7.2 | lock the app |
| `disableVerticalSwipes` | 7.7 | a downward swipe scrolls instead of closing |
| `shareToStory` | 7.8 | a verse to a story, with a link back |
| `openInvoice` (Telegram Stars) | 6.1 | Support CyberJudah |
| `requestFullscreen`, `lockOrientation` | 8.0 | Settings: full-screen reading, lock portrait |
| `addToHomeScreen`, `checkHomeScreenStatus` | 8.0 | More: Add to Home Screen |
| `LocationManager` | 8.0 | Sabbath: sunset where you are |
| `shareMessage` + `savePreparedInlineMessage` | 8.0 | Share: a rich card with an Open button |
| `downloadFile` | 8.0 | More: the vault as a file |
| `safeAreaInset`, `contentSafeAreaInset`, `activated` / `deactivated` | 8.0 | layout under Telegram's chrome; refresh on return |
| `DeviceStorage`, `SecureStorage` | 9.0 | the local cache; the lock preference |
| `hideKeyboard` | 9.1 | after a search |
| `Accelerometer`, `Gyroscope`, `DeviceOrientation`, `setEmojiStatus`, `sendData` | 8.0 | typed and available in `app/src/tg/`; not used by a screen |
| Bot: `/start` deep links, inline mode, `web_app` buttons, prepared messages, Stars payments, daily push | | `bot/` |

Everything degrades: on an older client the feature is simply absent, and in a plain browser
the app runs as a mobile web app with web fallbacks (share sheet, geolocation, localStorage).

## Deep links

`https://t.me/<bot>/<app>?startapp=<page>` opens a screen. `<page>` is the site path with `_`
for `/`; `bible_` may be left off a chapter. `john_3_16`, `psalms_23`, `john_3_16-18x20`
(verses 16–18 and 20), `classes`, `classes_2026_<slug>`, `law`, `precepts_usury`. The codec is
`shared/links.mjs`. `/start john_3_16` in the bot chat does the same with a button.

## Running it

```
npm ci
node bot/scripts/fetch-dictionary.mjs   # Easton's dictionary, from the cyberjudah repo
npm run dev            # the app at http://localhost:5173 (browser mode, web fallbacks)
npm run typecheck && npm test
npm run build          # app/dist, which the worker serves
cd bot && npx wrangler dev   # the worker with the app, /api and /webhook, locally
```

To try it inside Telegram during development, expose the worker (for example with
`cloudflared tunnel`) and point the Mini App's URL at it in @BotFather.

## Setting it up

Four secrets and the deploy workflow do the rest.

1. **The bot.** In [@BotFather](https://t.me/BotFather): `/newbot` gives the token. Then
   `/setinline` on the bot (placeholder like `john 3:16 or a word`) so `@bot …` works in chats.
2. **Cloudflare.** *My Profile → API Tokens → Create Token*, template "Edit Cloudflare
   Workers", and add **D1 Edit** and **Workers KV Storage Edit** to its permissions. The account
   ID is on the Workers & Pages overview page.
3. **GitHub → Settings → Secrets and variables → Actions → Secrets:** `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, and `WEBHOOK_SECRET` (any long random string).
4. Run the **deploy** workflow (Actions → deploy → Run workflow). It creates the D1 database and
   the KV namespace, deploys the Worker, loads the search index, stores the secrets on the
   Worker, and registers the webhook, the commands and the menu button. The run's log prints
   the Worker's URL.
5. **BotFather again:** `/newapp` for the bot with that Worker URL and a short name (e.g.
   `read`). Set the GitHub **variable** `TELEGRAM_APP_URL` to `https://t.me/<bot>/<name>` and
   run the workflow once more, so shared links open inside the app.

A nightly run reloads the search index so it follows the library. Optional variable
`WORKER_URL` overrides the URL the workflow reads from wrangler (for a custom domain).

The bot's own README (`bot/README.md`) covers the API, the inline mode and the cron.
