# Privacy and data handling

CyberJudah for Telegram is designed to minimize server-side personal data.

## Data used

Telegram supplies signed Mini App launch data that identifies the current Telegram user. The Worker validates this data to authorize personal API actions. It does not intentionally persist the complete launch payload.

Reading preferences, bookmarks, highlights, notes, progress, recent searches, and related study state are stored through Telegram CloudStorage or on the user's device, depending on client capability.

If a user enables the daily verse, the Worker stores the Telegram chat identifier, delivery hour, and timezone offset in Cloudflare KV. Turning the feature off deletes that subscription record.

If a user turns on reading reminders, the Worker stores in Cloudflare KV: whether they are on, the hour and the IANA time zone (for example "America/Chicago"), the channels chosen (Telegram, push or both), the Telegram chat identifier when Telegram is used, and, when push is used, the browser's push subscription (its endpoint URL and the two public keys the browser gives with it). To say what to read, it also keeps the reading plan's day and pace and the last chapter read (book and chapter only), the dates a reminder was sent, marked done or paused, and the chapters marked done from a reminder until the app has recorded them. A browser that is not opened inside Telegram is given a random device credential, kept in that browser's local storage; the Worker keeps only its hash. The push endpoint is given to the browser's push service (Google, Mozilla, Apple or Microsoft) to deliver the reminder; no reading or personal content is sent in a push.

Search and transcript queries are processed to return results. Application logs should contain operational error information only and must not contain bot tokens, raw `initData`, note contents, or complete user profiles.

Optional location access is used to calculate local Sabbath times. The application should not persist precise coordinates on the server.

Ask CyberJudah conversations are saved to the user's account in Cloudflare KV, keyed by their Telegram user id: each question, the answer, the sources cited, the suggested follow-ups and the research steps. A user sees only their own conversations and can delete any of them from the Your chats list; at most 300 are kept, the oldest dropped first. Questions are sent to Anthropic (Claude) to be answered, under Anthropic's commercial terms, which do not use API data to train its models by default.

Ask CyberJudah's allowance is kept in Cloudflare KV per Telegram user id: the day's free use, the monthly plan's renewal date and use, and any top-up credit. The day's totals of questions and usage (with the ids of the people who asked, for counting) are kept for 120 days so the operator can price the service.

Telegram Stars payments are processed by Telegram. The bot checks each purchase before accepting it, records the Telegram charge id so a payment is applied once, and grants the plan or credit bought.

## Service providers

The application depends on Telegram, Cloudflare Workers/D1/KV, GitHub Actions for deployment, and the CyberJudah data service. Their respective policies govern data processed by those services.

## Retention and deletion

Daily-verse subscription data remains until the user disables the feature or the operator removes it. A reading reminder that is turned off keeps its settings so it can be turned on again; a push subscription is deleted when push is turned off or the push service reports it expired, and the operator can remove a reminder record on request. Saved conversations remain until the user deletes them; allowance records remain while the account is in use. Device and Telegram CloudStorage data can be removed through the applicable client or future in-app reset controls.

## Security and contact

Never send credentials or private launch data in a public issue. See [SECURITY.md](SECURITY.md) for private reporting instructions.

This document describes the repository's intended behavior and should be reviewed before a public production launch.
