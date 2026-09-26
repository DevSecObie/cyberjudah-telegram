# Privacy and data handling

CyberJudah for Telegram is designed to minimize server-side personal data.

## Data used

Telegram supplies signed Mini App launch data that identifies the current Telegram user. The Worker validates this data to authorize personal API actions. It does not intentionally persist the complete launch payload.

Reading preferences, bookmarks, highlights, notes, progress, recent searches, and related study state are stored through Telegram CloudStorage or on the user's device, depending on client capability.

If a user enables the daily verse, the Worker stores the Telegram chat identifier, delivery hour, and timezone offset in Cloudflare KV. Turning the feature off deletes that subscription record.

Search and transcript queries are processed to return results. Application logs should contain operational error information only and must not contain bot tokens, raw `initData`, note contents, or complete user profiles.

Optional location access is used to calculate local Sabbath times. The application should not persist precise coordinates on the server.

Telegram Stars payments are processed by Telegram. The bot receives Telegram's successful-payment event to acknowledge the payment.

## Service providers

The application depends on Telegram, Cloudflare Workers/D1/KV, GitHub Actions for deployment, and the CyberJudah data service. Their respective policies govern data processed by those services.

## Retention and deletion

Daily-verse subscription data remains until the user disables the feature or the operator removes it. Device and Telegram CloudStorage data can be removed through the applicable client or future in-app reset controls.

## Security and contact

Never send credentials or private launch data in a public issue. See [SECURITY.md](SECURITY.md) for private reporting instructions.

This document describes the repository's intended behavior and should be reviewed before a public production launch.
