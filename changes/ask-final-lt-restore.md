# Ask final step: a "<" that starts no tag stays as written

- After #607, a "<" that started no tag was left as "&lt;", and readers saw it literally ("a < b" showed as "a &lt; b"). The final step now holds each "<" as one private-use character while it removes markup, and gives back every one left. No entity or neighbouring text can spell that character, so a removal can't form a new tag or comment, and one pass is enough.
- A run of "<" before a tag character, or right before a kept picture, is removed whole. An image formed by removing a tag ("!<b>[x](…)") becomes its alt text, and a run of "!" before "[" is removed whole. A kept picture's caption keeps no tags.
- The stream guard holds runs of "<" and "!" from their first character, so text already sent can't join what the held text becomes.
- OWASP LLM05. FINAL_STEP stays 3.
