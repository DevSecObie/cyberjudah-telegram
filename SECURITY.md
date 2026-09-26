# Security policy

## Supported version

Security fixes are applied to the latest code on `main`. Until tagged releases begin, no older revision is supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** button in the repository Security tab when private vulnerability reporting is enabled. If that option is unavailable, contact the repository owner privately through the contact method published on [cyberjudah.io](https://cyberjudah.io).

Include the affected route or component, reproduction steps, impact, and any suggested mitigation. Do not include real bot tokens, Telegram launch data, user records, or Cloudflare credentials.

We aim to acknowledge reports within 3 business days, provide an initial assessment within 7 business days, and coordinate disclosure after a fix is available.

## Security boundaries

- Telegram Mini App `initData` is untrusted until its HMAC and freshness are verified.
- Webhook traffic is untrusted unless the Telegram secret-token header matches.
- Search, transcript, dictionary, and upstream content are untrusted input and must be escaped before rendering.
- Bot tokens, webhook secrets, Cloudflare credentials, and production identifiers must never be committed.
- Changes to authentication, payments, sharing, subscriptions, or database migrations require focused tests and review.
