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

**Search first.** Home opens on the search of the teachings: a field that rotates prompts
("What was taught on the Passover?", "Who was Melchizedek?") and, from the second letter,
lists what matches, grouped teaching first (Sabbath classes, the Captains, Our Hidden
History, study notes, then the law, precepts, cases and encyclopedia) with the words lit.
Enter opens the full results, the classes first and scripture folded behind "Show the
verses that say this"; a reference like `Matthew 15:24` opens the chapter. Under the search:
where you left off (the class you were watching, the chapter you were reading), this
week's class, and the feed of everything taught with the topics as filters. A class page
shows the books it teaches from, jumps to the section a search hit named, and offers the
next and previous class.

**Spoken, word for word.** The second search goes through the captions of every recording
(about 8,500: the Sabbath classes, the Captains, Our Hidden History) for exactly what was
typed: the words in that order, side by side, case and punctuation aside, with no stemming
and no "any of these words". A Scripture reference is the one allowance the captions force:
`Matthew 15:24` also finds "Matthew 15 verse 24" and "Matthew chapter 15 and 24". A hit
carries the second it was said; it opens the class notes at that moment when the class is
written up, or the recording page with the captions around the moment and a "Watch from"
button into the video. The captions live in D1 (`transcript_chunks`, chunks of about 45
seconds, with an FTS5 index over them, unicode61 tokenizer); `bot/scripts/load-transcripts.mjs`
loads them from the cyberjudah repository incrementally, by git blob sha, nightly and on
demand (run the deploy workflow with "Also load the transcripts" ticked for the first, full
load). The full set is a few hundred MB, beyond the free D1 plan's 500 MB database and
100,000 rows-written-per-day (a run that hits the limit keeps what it loaded and stops for
the day); on Workers Paid (Cloudflare dashboard → Workers & Pages → Plans) it fits with room
and the first run loads everything.

**Ask the teachings.** A question, answered from the closest passages of the library and
the transcripts only, every claim cited and every citation a tap into its source. The
passages are embedded with Workers AI (bge-m3) into a Vectorize index by
`bot/scripts/embed.mjs`, nightly and on demand from the deploy workflow ("Also embed");
`/api/ask` retrieves the closest ones and has llama 3.3 70b answer from them, with the rule
that what is not in the passages is said to be not found. Forty questions a day per person.
The same index gives the Search screen its "By meaning" mode.

**Reading voices.** The Bible tab's Voice sheet lists Workers AI's Deepgram Aura voices
beside the device's own; a verse is generated once and kept in R2 (`cyberjudah-audio`), so
a chapter costs its first listener only.

**Drafts of unwritten classes.** The `draft-notes` workflow reads a class's captions in
parts, lists the Scripture opened (with the second it was read), the points made and the
announcements, then writes a note in the house format with the verses quoted from the KJV
text, and opens one pull request to the cyberjudah repository for review. It needs a
`CYBERJUDAH_TOKEN` repository secret (a fine-grained token with contents and pull-request
write on that repository); without it the drafts land as a workflow artifact.

**Telegram's own components.** Everything outside the Bible tab is built on
[TelegramUI](https://github.com/telegram-mini-apps-dev/TelegramUI), Telegram's React kit
for Mini Apps (its tab bar, cells and sections, segmented controls, chips, inputs, buttons,
placeholders and skeletons), themed to the site's palette and the reader's theme. The search
field and results follow two 21st.dev patterns: the rotating-placeholder input and the
grouped command palette.

**Read, as Bible Strong reads.** The Bible tab is a port of [Bible Strong](https://github.com/smontlouis/bible-strong)'s
Bible screen, behaviour for behaviour: its header (the book and chapter pill joined to the
version pill, the chevrons that jump to a verse, the ⋮ menu), its verse rendering (the
numbers, the 19 px text, the eight themes, the text size, line height, alignment and verse
mode settings), its gestures (tap to select, long press for the verse's resources, swipe for
the next chapter, a fast scroll that hides the header), its selected-verses sheet (the colour
bar with the five highlight colours and your own, then Annotate, Study and Share pages of
actions under a sliding tab bar), its focus mode for a shared passage ("Read whole chapter",
"Back to passage"), its book selector (list or grid, classical or alphabetical, with or
without verses), its footer (previous and next chapter, the audio pill and its card), and
its "Font and settings" sheet with every row. Its Lexicon, Compare and parallel features
need Strong's numbers and a second version, which this library does not carry, so those
are the only parts left out.

**Study.** Highlights in six colours (each editable: hex, name, and whether it washes the
background, colours the text or underlines), tags on highlights, notes and links attached to
verses as relations (they show under the verse as Bible Strong's tags, or as a count beside
the number), bookmarks on a verse or a chapter (eight, coloured, movable), study relations
between passages, notes, classes, laws, dictionary entries and links, and a resource sheet
per verse: Easton's dictionary for its words, the laws and precepts that cite it, its cross
references, and the classes that teach from it. Copy and share in Bible Strong's format, with
its share options; export a passage or a chapter with its notes.

**Plan.** The whole library in order at two, four or six chapters a day, with today's
chapters to tick off, a streak, and how far along you are. The app ticks a chapter as you
read it. A history of the last thirty chapters opened.

**Listen.** The chapter read aloud (the device's own voice), verse by verse, from any verse,
at 0.5× to 2×, on repeat if you like, from the footer's audio card.

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
for `/`; `bible_` may be left off a chapter. `matthew_15_24`, `psalms_23`, `matthew_15_24-26x28`
(verses 16–18 and 20), `classes`, `classes_2026_<slug>`, `law`, `precepts_usury`. The codec is
`shared/links.mjs`. `/start matthew_15_24` in the bot chat does the same with a button.

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
   `/setinline` on the bot (placeholder like `matthew 15:24 or a word`) so `@bot …` works in chats.
2. **Cloudflare.** *My Profile → API Tokens → Create Token*, template "Edit Cloudflare
   Workers", and add **D1 Edit** and **Workers KV Storage Edit** to its permissions. The account
   ID is on the Workers & Pages overview page.
3. **GitHub → Settings → Secrets and variables → Actions → Repository secrets** (the *Secrets* tab, not *Variables*, and not under an environment): `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, `BOT_TOKEN`, and `WEBHOOK_SECRET` (any long random string).
4. Run the **deploy** workflow (Actions → deploy → Run workflow). It creates the D1 database and
   the KV namespace, deploys the Worker, loads the search index, stores the secrets on the
   Worker, and registers the webhook, the commands and the menu button. The run's log prints
   the Worker's URL.
5. The Mini App is registered in @BotFather as `https://t.me/CyberJudah_bot/cybr` (`/newapp`,
   with the Worker URL); the app and the bot use that link for shares and buttons. A fork
   sets its own in `bot/wrangler.jsonc` (`APP_URL`) and `app/src/lib/share.ts`.

A nightly run reloads the search index so it follows the library. Optional variable
`WORKER_URL` overrides the URL the workflow reads from wrangler (for a custom domain).

The bot's own README (`bot/README.md`) covers the API, the inline mode and the cron.

## Licence

The Bible tab ports code and design from Bible Strong, which is released under the GNU
General Public License v3, so this repository is under the GPL-3.0 too (see `LICENSE`). The
library's text and notes remain CyberJudah's, published from the cyberjudah repository.
