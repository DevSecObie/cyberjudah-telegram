# Published studies: report by email, admin takedown, Bible Strong's publishing terms

- Every published study page (/app/published/<id>) has a "Report this study" link. It is a plain mailto to privacy@cyberjudah.io carrying only the study's public link and title, as the Terms describe. The reader's own mail app sends it. The page runs no script, and nothing is recorded about the click. Bible Strong's study page has no report line, so no footer line was added.
- Admins can take a study down: `/takedown <id or link>` in a private chat with the bot, or `DELETE /api/published-studies/<id>/admin` with Telegram launch data. Both check ADMIN_IDS. Only that study's row is removed, its page then shows "Study not found", and the writer keeps their own copy in the app.
- cyberjudah.io/terms: item 3 ("Your content") is replaced by Bible Strong's three publishing paragraphs, word for word with Le Studio 316 → CyberJudah, from the owner-approved text. "Last updated" is set to November 10, 2026.
