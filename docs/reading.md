# Four chapters a day

Open **Home → 4 chapters a day** or send `/reading` to the bot. Readers explicitly mark chapters finished in the Bible reader or tracker; simply leaving a chapter open does not count. Reading in a paper Bible counts too. Undo removes today's completion only. A reread on another date counts for that day's goal but does not inflate unique library progress.

Daily reminders and Monday recaps are off until the reader enables them and grants Telegram message permission. Choose an IANA timezone and a time in 15-minute steps. The quarter-hour cron follows daylight saving time. The existing daily-verse delivery and frame warmup still run hourly. Monday recaps count the seven previous local dates, excluding the current day. A recap and reminder share one message when both are due.

Completed daily goals suppress reminders. Pausing in the app, `/stopreading`, or the message's pause button disables both reading message types. A Telegram 403 also disables delivery. Progress stays saved. Readers can re-enable delivery in the tracker.

The default encouragement is **“Study, Pray, Apply!” — Bishop Nathanyel**, supplied by the project owner in this task. No recording URL is asserted for that phrase. Admins listed in `ADMIN_IDS` can add exact quotes with a YouTube or CyberJudah source link and explicitly confirm the wording and speaker. Quotes rotate by local calendar date; these are curated text, never AI-generated quotations.

## Storage and deployment

`bot/reading.sql` creates three additive D1 tables on the existing app database. Deploy applies this idempotent schema before uploading the Worker. Data is keyed by the authenticated Telegram user, never a user ID in a request body. Existing CloudStorage reading-plan history remains accessible in **Previous reading plan**; it is not silently reclassified as new dated completion history.

`reading_deliveries` claims each user's local date atomically to avoid duplicates from overlapping cron invocations or repeated DST hours. Ambiguous delivery failures keep their claim and are logged as `reading_delivery_failed`: a missed message is preferred to an accidental repeat. Claims expire after 35 days. User reading history persists; pause does not delete it. An opt-out concurrent with a send may not retract a message already in flight.

Rollback can restore the prior Worker; the additive tables do not interfere with prior versions. Do not drop user progress tables on rollback. A local environment needs `npx wrangler d1 execute cyberjudah-telegram --local --file reading.sql` from `bot`; Playwright does this automatically.

## Verification

Tests cover local dates, DST, quarter-hour zones, daily goals, streaks, undo, rereads, invalid preferences, authenticated ownership, duplicate delivery claims, completed-day suppression, weekly windows, and browser persistence/opt-in/pause. Scheduled test sends use a fake Telegram API; no real recipients are contacted.
