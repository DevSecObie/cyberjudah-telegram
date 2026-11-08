# Auto routing: lookups are quick, turns are exchanges, the answer names its model

- Auto treats asking to read a passage as quick, as the Mini App did: "read John 3:16", "show me Genesis 1:1-3", "what does John 8:32 say?", "quote Isaiah 45:7" (also give, pull up, open, with an optional "please" or "me"). These go to a free fast model, like a bare reference. Asking what a passage means is not a lookup.
- Auto counts earlier exchanges (a question and its answer) as turns, not messages, as the Mini App did. The "long follow-up deep in a conversation" rule now starts at the fifth question, not the third.
- A finished `/api/ask` stream line (`done`) written by a model carries `model`: the resolved model for a research answer, the Workers AI answer model for a backup answer. An Auto answer can now name its model. Fixed sentences written by no model ("nothing found", "not in the classes") and approved answers carry none. `docs/ASK-MODEL-ROUTING.md` says the same.
