# Site legal text

`privacy.md` and `terms.md` are exact copies of the owner-approved text, the part between the two `---` lines of the Data Security files in the vault (Projects/cyberjudah-app/clean-app-privacy-policy-rebuilt-2026-11-07.md and clean-app-terms-draft-2026-11-07.md). They are served at cyberjudah.io/privacy and /terms through `bot/src/site-legal.ts`, and `bot/tests/site-legal.test.mjs` checks the served pages against them. To change the text, replace both the copy here and the constant in `site-legal.ts` with newly approved text; never edit the wording here.
