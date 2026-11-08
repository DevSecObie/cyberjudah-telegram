# Ask stream lines stay under the Mini App's 256 KiB frame

- On `/api/ask` NDJSON lines that carry sources (the final `done`, the approved-answer line, replies, the backup `passages` line and the agent's `passages`/`passages_delta`), a source's `text` or `excerpt` longer than 1,000 characters is cut to its first 1,000. Such a source also carries `text_chars` (the length it had) and `truncated: true`. Sources that fit, labels, links, ids, images and the answer are sent as before.
- If a line would still pass 200 KiB, the previews shrink to 300 characters, then to none. Every source and the answer are always kept.
- Before this, an answer citing several long notes (read_note parts run to about 40,000 characters) made a final line of about 288k characters. The Mini App drops any line over 256 KiB, so the finished answer showed as interrupted.
- The full text stays on the server: the saved conversation, the answer receipt and the one-piece JSON response still get it, and each source's link opens the whole passage.
- New tests: a contract test with seven 40,000-character cited notes (every line under 256 KiB, previews and lengths right), and unit tests for the cutting and shrinking.
