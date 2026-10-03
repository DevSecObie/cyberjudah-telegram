# The Final Captivity

The Timeline's last age: the captivity, displacement, persecution, resistance and achievements
of the peoples the assembly identifies as the Israelites today (the so-called Blacks, Hispanics
and Native Americans), and the founding and growth of Israel United in Christ. It follows the
Reformation period and is the final top-level age on the Timeline.

These files are the source of truth. `app/scripts/timeline-data.mjs` builds the Timeline's bars
from them, and `check.mjs` must pass before anything here is published.

| File | What it holds |
| --- | --- |
| `periods.json` | The subperiods, in order: id, title, years, interval, colour. |
| `events.json` | Published events. Every one passes `check.mjs`. |
| `drafts.json` | The draft queue: events that are not yet supported (no teaching moment found, no historical source read, or a date or claim unresolved). Never shown in the app. |
| `ledger.json` | The research ledger: every source, whether it was reviewed, is unreviewed or could not be reached, which events it supports, the gaps, and the date sources were reviewed through. |
| `COVERAGE.md` | The coverage inventory by period, region, people and subject. |

## An event

```jsonc
{
  "slug": "portuguese-captives-1441",           // unique, stable; it is the link (?event=<slug>)
  "title": "…",
  "start": 1441, "end": 1444,                    // years; the bar
  "date": { "text": "1441–1444", "precision": "year" },  // day | month | year | circa | range | decade
  "period": "into-the-ships",                    // a periods.json id; the years fall inside it
  "group": "Transatlantic trade",                // one of GROUPS in check.mjs
  "place": "…", "region": "…",
  "peoples": ["Black"],                          // Black | Hispanic | Native (the assembly's terms)
  "people": ["…"],                               // named people, as the sources name them
  "summary": "…",                                // one or two sentences of documented history
  "account": ["…"],                              // documented history, paragraph by paragraph
  "teaching": [{                                 // the assembly's teaching, attributed
    "points": ["…"],                             // what the class taught, in the class's own sense
    "quote": "…",                                // optional: words spoken, exactly as in the recording
    "teacher": "…",                              // only when the recording names the teacher
    "source": { "kind": "class", "id": "<video id>", "title": "…", "date": "YYYY-MM-DD", "ts": "1:07:27", "url": "https://youtu.be/<id>?t=4047" }
  }],
  "scriptures": [{ "ref": "Deuteronomy 28:68", "why": "how the assembly applies it" }],
  "sources": [{ "title": "…", "author": "…", "publisher": "…", "year": "…", "url": "…", "via": "<Wayback snapshot, when read there>", "accessed": "YYYY-MM-DD", "supports": "which statements" }],
  "uncertainty": "…",                            // date precision, anything not settled
  "disagreements": [{ "point": "…", "views": ["…", "…"] }],
  "image": { "src": "…", "kind": "archival", "caption": "…", "credit": "…", "license": "…", "sourceUrl": "…" },
  "status": "published"
}
```

`source.kind` is `class` (a class recording, `blog/transcripts` in the cyberjudah repository),
`history` (an *Our Hidden History* episode, `history/transcripts`), `site` (israelunite.org) or
`note` (a written class note). An image is `archival` (a licensed or public-domain original,
with its rights) or `generated` (a reconstruction, labelled as generated on screen; never a
documentary photograph of an atrocity, never presented as evidence). See docs/AVATARS.md.

## Editorial rules

- Three kinds of statement, never mixed: **documented history** (`summary`, `account`: only what
  the cited sources say), **the assembly's interpretation** (`teaching`: attributed to the exact
  recording and moment), and **scriptural application** (`scriptures`: the verses the assembly
  reads with it, and how it applies them).
- Nothing is invented: no quotation, casualty figure, date, citation or connection that is not
  in a source that was read. A number appears only as its source gives it.
- Where sources disagree (with each other, or with the teaching), both are kept in
  `disagreements`, each said plainly. Neither is corrected silently.
- The teacher's meaning is kept. Quotes are word for word from the recording; strong language
  stays as said; a bleeped word is left out.
- An event without a teaching moment, or without a documented source, stays in `drafts.json`.
